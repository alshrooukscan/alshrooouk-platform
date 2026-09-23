// A CBCT export is a folder of individual DICOM slices, not one file. The
// machine normally writes a .zip and staff upload that single file, which is
// how all 90-odd scans on the platform arrived. Once, a folder was uploaded
// unzipped instead: 326 files named image_001.DCM to image_326.DCM, all on one
// visit. The patient page renders each file twice - once under its visit, once
// in the all-files grid - so that visit produced 652 cards, every one of them
// labelled identically, and the page stopped opening.
//
// Rather than police what staff may select, the listing folds a machine-written
// sequence back into the one thing it actually is: a single scan. The files
// themselves are untouched in Drive and every member is still reachable through
// the returned `series` array.
//
// Deliberately conservative. Staff upload real batches of photos they need to
// see and act on individually - the largest genuine batch on the platform is
// ten - so the threshold sits above that. Anything smaller renders as it always
// has, one card per file.
const SERIES_MIN = 12;

// image_001.DCM -> { stem: "image_", ext: ".DCM", n: 1 }
// Requires at least two digits so a genuine "scan 1.jpg" / "scan 2.jpg" pair is
// never treated as a machine sequence, and anchors on the LAST run of digits so
// names carrying their own numbers (2026_scan_004.dcm) still group correctly.
function parseMember(name) {
  const m = String(name || "").match(/^(.*?)(\d{2,})(\.[^.]+)$/);
  if (!m) return null;
  return { stem: m[1], ext: m[3].toLowerCase(), n: Number(m[2]) };
}

// Groups by visit, then by file type, then by name shape, so two different
// scans on two different visits never merge into one entry.
function keyOf(f, p) {
  return [f.visitId ?? "", f.fileType ?? "", p.stem, p.ext].join("\u0000");
}

/**
 * Folds machine-written file sequences into one entry each.
 *
 * A collapsed entry keeps the shape of a normal file - it IS the first file of
 * the sequence, so anything already rendering a file keeps working - plus:
 *   seriesCount  how many files it stands for
 *   series       every member, in sequence order, each a normal file entry
 *
 * Order is preserved: a collapsed entry sits where its first member sat.
 * Anything that is not part of a long sequence is returned untouched.
 */
export function collapseSeries(files) {
  const list = Array.isArray(files) ? files : [];
  const groups = new Map();

  for (const f of list) {
    const p = parseMember(f?.name);
    if (!p) continue;
    const k = keyOf(f, p);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push({ file: f, n: p.n });
  }

  // Only sequences past the threshold collapse; the rest are left alone.
  const collapsing = new Map();
  for (const [k, members] of groups) {
    if (members.length < SERIES_MIN) continue;
    members.sort((a, b) => a.n - b.n);
    collapsing.set(k, members.map((m) => m.file));
  }
  if (!collapsing.size) return list;

  const emitted = new Set();
  const out = [];

  for (const f of list) {
    const p = parseMember(f?.name);
    const k = p ? keyOf(f, p) : null;
    const members = k ? collapsing.get(k) : null;

    if (!members) {
      out.push(f);
      continue;
    }
    // One entry per sequence, at the position of its first member.
    if (emitted.has(k)) continue;
    emitted.add(k);

    const first = members[0];
    out.push({
      ...first,
      seriesCount: members.length,
      series: members,
      // Named for what it is rather than what its first slice is called, so the
      // card does not read "image_001.DCM" when it stands for 326 files.
      displayName: first.displayName || first.name,
    });
  }

  return out;
}

export const SERIES_THRESHOLD = SERIES_MIN;
