// A CBCT export is a folder of individual DICOM slices, not one file. The
// machine normally writes a .zip and staff upload that single file, which is
// how every other scan on the platform arrived. Once, a folder went up
// unzipped: 326 slices on one visit. The patient page renders each file twice -
// once under its visit, once in the all-files grid - so that visit produced 652
// cards and the page stopped opening.
//
// Detection is by COUNT within a visit, not by filename. Uploads are renamed on
// the way into Drive ("Nagat Fathy - Raw Data - 2026-09-21 - vn0b.DCM"), so the
// slice numbering the camera gave them survives only in patient_files and never
// reaches this listing. Matching on a numeric sequence looks right and silently
// matches nothing.
//
// The files themselves are untouched in Drive, and every member is still
// reachable through the returned `series` array.
//
// Threshold sits above the largest genuine batch staff upload by hand (ten
// photos off one scan), so ordinary uploads render exactly as they always have,
// one card per file.
const SERIES_MIN = 12;

// A "set" is files of one kind attached to one visit. Falls back to the Drive
// folder label when a file has no visit recorded, so unattributed files still
// group instead of each becoming its own card.
function keyOf(f) {
  const scope = f?.visitId ?? f?.groupLabel ?? "";
  const kind = f?.fileType ?? f?.typeLabel ?? "";
  return `${scope}\u0000${kind}`;
}

/**
 * Folds a large set of same-kind files on one visit into a single entry.
 *
 * A collapsed entry keeps the shape of a normal file - it IS the first file of
 * the set, so anything already rendering a file keeps working - plus:
 *   seriesCount  how many files it stands for
 *   series       every member, in the order given
 *
 * Order is preserved: a collapsed entry sits where its first member sat.
 * Anything below the threshold is returned untouched.
 */
export function collapseSeries(files) {
  const list = Array.isArray(files) ? files : [];
  if (list.length < SERIES_MIN) return list;

  const groups = new Map();
  for (const f of list) {
    const k = keyOf(f);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(f);
  }

  const collapsing = new Map();
  for (const [k, members] of groups) {
    // An empty key means we could not tell which visit or kind these belong to.
    // Folding those together would merge unrelated files into one fake set.
    if (k === "\u0000") continue;
    if (members.length >= SERIES_MIN) collapsing.set(k, members);
  }
  if (!collapsing.size) return list;

  const emitted = new Set();
  const out = [];

  for (const f of list) {
    const k = keyOf(f);
    const members = collapsing.get(k);
    if (!members) {
      out.push(f);
      continue;
    }
    if (emitted.has(k)) continue;
    emitted.add(k);
    out.push({ ...members[0], seriesCount: members.length, series: members });
  }

  return out;
}

export const SERIES_THRESHOLD = SERIES_MIN;
