#!/usr/bin/env python3
"""Turn a CBCT series of single-slice DICOM files into a Romexis-style export.

Input : a folder of single-frame CT slices (what Romexis sends to Orthanc).
Output: <out>/<Name> ROMEXIS/<Name>.dcm  one Enhanced CT multi-frame file
                              <Name>.txt  Romexis patient/image info
                              <Name>.xml  Romexis view state (from a template)

The .dcm follows the layout Romexis 6.4 writes on Export: Enhanced CT Image
Storage, frames ordered from the top slice down, pixel spacing in the Shared
Functional Groups, one Plane Position item per frame.

usage: romexis_bundle.py <slices_dir> <out_dir> <name> [template.xml]
       romexis_bundle.py --zip <in.zip> <out.zip>      (used by the sync agent)

Pure pydicom, no numpy, so the gateway image stays small. Verified on
4 Nov 2026 against two real scans: pixel-identical to the source slices, and
Mohamed Said opened both in Romexis Viewer.
"""
import array, copy, datetime, hashlib, os, re, shutil, sys, tempfile, zipfile
import pydicom
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.sequence import Sequence
from pydicom.uid import ExplicitVRLittleEndian, generate_uid

ENHANCED_CT = "1.2.840.10008.5.1.4.1.1.2.1"

# Per-slice attributes that move into the functional groups of a multi-frame file.
DROP = ["ImagePositionPatient", "ImageOrientationPatient", "PixelSpacing", "SliceLocation",
        "InstanceNumber", "PixelData", "WindowCenterWidthExplanation", "LargestImagePixelValue",
        "SmallestImagePixelValue"]


def item(**kw):
    d = Dataset()
    for k, v in kw.items():
        setattr(d, k, v)
    return d


def load_slices(folder):
    out = []
    for root, _, files in os.walk(folder):
        for f in files:
            p = os.path.join(root, f)
            try:
                d = pydicom.dcmread(p)
            except Exception:
                continue
            if "PixelData" in d and "ImagePositionPatient" in d and int(getattr(d, "NumberOfFrames", 1) or 1) == 1:
                out.append(d)
    if not out:
        raise SystemExit("no single-frame slices found")
    series = {d.SeriesInstanceUID for d in out}
    if len(series) > 1:  # keep the largest series (the volume)
        biggest = max(series, key=lambda s: sum(1 for d in out if d.SeriesInstanceUID == s))
        out = [d for d in out if d.SeriesInstanceUID == biggest]
    # Romexis orders frames from the top slice down
    out.sort(key=lambda d: float(d.ImagePositionPatient[2]), reverse=True)
    return out


def build_dcm(slices):
    src = slices[0]
    ds = copy.deepcopy(src)
    for k in DROP:
        if k in ds:
            delattr(ds, k)
    now = datetime.datetime.now()
    # Romexis names its exported volume after the series' Frame of Reference
    # UID (every slice is that UID + ".n"), under Planmeca's own root
    # 2.16.840.1.113669. Romexis Viewer refuses a file whose UIDs and
    # implementation come from another organisation ("DICOM Media ... is from
    # unsupported organization"), so the export is labelled exactly as
    # Romexis labels its own.
    uid = getattr(src, "FrameOfReferenceUID", None) or src.SOPInstanceUID.rsplit(".", 1)[0]
    # Volumes exported by other software (e.g. the X-Line viewer's own
    # EXAM_3D_000 export) carry UIDs from another root; give those a fresh
    # UID in the Romexis form so Romexis Viewer accepts the file.
    if not uid.startswith("2.16.840.1.113669."):
        h = int(hashlib.sha1(src.SeriesInstanceUID.encode()).hexdigest(), 16)
        uid = f"2.16.840.1.113669.632.10.{now:%Y%m%d}.{now:%H%M%S}{now.microsecond // 1000:03d}.{h % 100000}.{h % 97}"
    ds.SOPClassUID = ENHANCED_CT
    ds.SOPInstanceUID = uid
    ds.ImageType = ["ORIGINAL", "PRIMARY"]
    ds.InstanceCreationDate = now.strftime("%Y%m%d")
    ds.InstanceCreationTime = now.strftime("%H%M%S")
    ds.PixelPresentation = "MONOCHROME"
    ds.VolumetricProperties = "VOLUME"
    ds.VolumeBasedCalculationTechnique = "NONE"
    ds.ContentQualification = "PRODUCT"
    ds.BurnedInAnnotation = "NO"
    ds.PresentationLUTShape = "IDENTITY"
    ds.NumberOfFrames = str(len(slices))
    if "AcquisitionDateTime" not in ds and "StudyDate" in ds:
        ds.AcquisitionDateTime = f"{ds.StudyDate}{getattr(ds, 'StudyTime', '000000').split('.')[0]}.000000"
    ds.DimensionOrganizationSequence = Sequence([item(DimensionOrganizationUID=generate_uid())])
    ds.DimensionIndexSequence = Sequence([])

    spacing = src.PixelSpacing
    thick = getattr(src, "SliceThickness", spacing[0])
    ds.SharedFunctionalGroupsSequence = Sequence([item(
        PixelMeasuresSequence=Sequence([item(SliceThickness=thick, PixelSpacing=spacing)]),
    )])

    orient = list(getattr(src, "ImageOrientationPatient", [1, 0, 0, 0, 1, 0]))
    slope = getattr(src, "RescaleSlope", 1)
    intercept = getattr(src, "RescaleIntercept", 0)
    kvp = getattr(src, "KVP", None)
    per_frame = []
    frames = bytearray()
    lo, hi = None, None
    expect = len(src.PixelData)
    for i, d in enumerate(slices):
        pf = Dataset()
        pf.CTImageFrameTypeSequence = Sequence([item(FrameType="ORIGINAL", PixelPresentation="MONOCHROME",
                                                     VolumetricProperties="VOLUME", VolumeBasedCalculationTechnique="NONE")])
        if kvp is not None:
            pf.CTXRayDetailsSequence = Sequence([item(KVP=kvp)])
        pf.FrameContentSequence = Sequence([item(InStackPositionNumber=i + 1)])
        pf.PlanePositionSequence = Sequence([item(ImagePositionPatient=list(d.ImagePositionPatient))])
        pf.PlaneOrientationSequence = Sequence([item(ImageOrientationPatient=orient)])
        pf.PixelValueTransformationSequence = Sequence([item(RescaleIntercept=getattr(d, "RescaleIntercept", intercept),
                                                             RescaleSlope=getattr(d, "RescaleSlope", slope), RescaleType="HU")])
        per_frame.append(pf)
        if len(d.PixelData) != expect or d.Rows != src.Rows or d.Columns != src.Columns:
            raise SystemExit(f"slice {i + 1} has a different size; refusing to merge")
        arr = array.array("H" if d.PixelRepresentation == 0 else "h")
        arr.frombytes(d.PixelData[: len(d.PixelData) // 2 * 2])
        if sys.byteorder != "little":
            arr.byteswap()
        lo = min(arr) if lo is None else min(lo, min(arr))
        hi = max(arr) if hi is None else max(hi, max(arr))
        frames += d.PixelData
    ds.PerFrameFunctionalGroupsSequence = Sequence(per_frame)
    ds.SmallestImagePixelValue = lo
    ds.LargestImagePixelValue = hi
    ds["SmallestImagePixelValue"].VR = "US" if src.PixelRepresentation == 0 else "SS"
    ds["LargestImagePixelValue"].VR = "US" if src.PixelRepresentation == 0 else "SS"
    ds.PixelData = bytes(frames)
    ds["PixelData"].VR = "OW"

    meta = FileMetaDataset()
    meta.MediaStorageSOPClassUID = ENHANCED_CT
    meta.MediaStorageSOPInstanceUID = uid
    meta.TransferSyntaxUID = ExplicitVRLittleEndian
    meta.ImplementationClassUID = "2.16.840.1.113669.632.10.99.2"
    meta.ImplementationVersionName = "ROMEXIS_6_4_1_R"
    meta.SourceApplicationEntityTitle = "ROMEXIS_1"
    ds.file_meta = meta
    return ds


def image_number(ds):
    return str(int(hashlib.sha1(ds.StudyInstanceUID.encode()).hexdigest(), 16) % 90000 + 10000)


def build_txt(ds, img_no):
    pn = ds.PatientName
    t = getattr(ds, "StudyTime", "000000").split(".")[0].lstrip("0") or "0"
    px = float(ds.SharedFunctionalGroupsSequence[0].PixelMeasuresSequence[0].PixelSpacing[0])
    return "\r\n".join([
        "[PATIENT]", "PATIENT_ID=", f"FIRST_NAME={pn.given_name}", f"FAMILYNAME={pn.family_name}",
        f"BIRTH_DATE={getattr(ds, 'PatientBirthDate', '')}", f"SEX={getattr(ds, 'PatientSex', '')}",
        f"EXTERNAL_ID={getattr(ds, 'PatientID', '')}", "", "[TREATMENT]", "DOCTOR=Default Provider", "",
        "[IMAGE]", f"IMAGENUMBER={img_no}", f"DATE={getattr(ds, 'StudyDate', '')}", f"TIME={t}",
        f"PIXELSIZE={round(px * 1000)}", f"BIT_DEPTH={ds.BitsAllocated}", f"CALIBRATED_SCALE={px:.6f}",
        "ROTATION_ANGLE=0", "HORZ_MIRROR=0", "IMAGE_TYPE=5", "IMAGE_SUB_TYPE=1", "IMAGE_FORMAT=dcm",
        "TOOTH_MASK=0", "REMARK=", "", "",
    ])


def build_xml(template, ds, img_no, dcm_name):
    n, r, c = int(ds.NumberOfFrames), int(ds.Rows), int(ds.Columns)
    now = datetime.datetime.now()
    rep = {
        "{{STUDY_UID}}": ds.StudyInstanceUID, "{{SOP_UID}}": ds.SOPInstanceUID, "{{DCM_PATH}}": dcm_name, "{{IMAGE_ID}}": img_no,
        "{{VIEW_ID}}": img_no, "{{DATE}}": now.strftime("%Y%m%d"), "{{TIME}}": now.strftime("%H%M%S") + "000",
        "{{CX}}": f"{c / 2:.1f}", "{{CY}}": f"{r / 2:.1f}", "{{CZ}}": f"{n / 2:.1f}",
        "{{SX}}": str(c // 2), "{{SY}}": str(r // 2), "{{SZ}}": str(n // 2),
    }
    for k, v in rep.items():
        template = template.replace(k, v)
    return template


def safe_name(ds):
    pn = ds.PatientName
    raw = pn.given_name or pn.family_name or "Patient"
    return re.sub(r"[^A-Za-z0-9 _-]", "", str(raw)).strip() or "Patient"


def bundle(slices_dir, out_dir, name, tpl):
    slices = load_slices(slices_dir)
    if name is None:
        name = safe_name(slices[0])
    ds = build_dcm(slices)
    img_no = image_number(ds)
    folder = os.path.join(out_dir, f"{name} ROMEXIS")
    os.makedirs(folder, exist_ok=True)
    ds.save_as(os.path.join(folder, f"{name}.dcm"), enforce_file_format=True)
    with open(os.path.join(folder, f"{name}.txt"), "w", encoding="latin-1", errors="replace", newline="") as f:
        f.write(build_txt(ds, img_no))
    with open(tpl, encoding="utf-8") as f:
        xml = build_xml(f.read(), ds, img_no, f"{name}.dcm")
    with open(os.path.join(folder, f"{name}.xml"), "w", encoding="utf-8") as f:
        f.write(xml)
    print(f"{folder}: {len(slices)} frames")
    return folder


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    tpl_default = os.path.join(here, "romexis_template.xml")
    if sys.argv[1] == "--zip":
        in_zip, out_zip = sys.argv[2], sys.argv[3]
        work = tempfile.mkdtemp(prefix="romexis-")
        try:
            src_dir, dst_dir = os.path.join(work, "in"), os.path.join(work, "out")
            with zipfile.ZipFile(in_zip) as z:
                z.extractall(src_dir)
            folder = bundle(src_dir, dst_dir, None, tpl_default)
            with zipfile.ZipFile(out_zip, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
                for f in sorted(os.listdir(folder)):
                    z.write(os.path.join(folder, f), os.path.join(os.path.basename(folder), f))
        finally:
            shutil.rmtree(work, ignore_errors=True)
        return
    bundle(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4] if len(sys.argv) > 4 else tpl_default)


if __name__ == "__main__":
    main()
