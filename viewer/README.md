# Online CBCT viewer (shscan.com/viewer)

Our build of Kitware VolView (Apache-2.0), commit 66543cf, with
`volview-shscan.patch` applied. Hosted on the Vercel project
`shscan-viewer-test` and served at shscan.com/viewer through the rewrites
in next.config.js.

What the patch adds:
- Correct orientation for single multi-frame (Romexis Enhanced CT) files,
  real mm spacing, crop/camera refit after load.
- CBCT-Dental 3D preset (default), Al Shrooouk branding, skips .txt/.xml.
- "Panoramic & Nerve" workspace (src/components/DentalWorkspace.vue):
  arch drawing on axial, panoramic with slab/MIP, three cross-sections,
  right/left nerve tracing, mm measurement, sharpen/denoise/invert/W-L,
  save panoramic as PNG, cross-section tilt (drag the green line on the
  panoramic left/right; the cross-sections follow it).
- Default layout "Four Up (tilt)": axial, coronal, sagittal with tiltable
  axis lines, plus the 3D volume. The original Oblique layout is still there.
- Ruler works in the tilt views (src/components/tools/ObliqueRuler.vue);
  "Tilt axes: ON/OFF" in the top bar switches to the normal views where every
  VolView tool works.

Redesign (11 Nov 2026, "Clinical Midnight"): dark theme in brand navy/gold,
IBM Plex fonts, new top bar (patient, tabs MPR / Panoramic & Implant / 3D,
Tilt on/off, Image menu). Window/level: right-drag with the W/L tool
(up/down brightness, left/right contrast), all views or only the dragged
one (src/shscan/state.ts). Sharpen applies to every 2D view and the
panoramic tab (SVG convolution filter on the view canvases).

Rebuild:
    git clone https://github.com/Kitware/VolView && cd VolView && git checkout 66543cf
    git apply ../volview-shscan.patch && cp ../shscan-logo.png src/assets/
    npm ci && npx vite build --base=/viewer/
    # upload dist/ as /viewer/ of the shscan-viewer-test project
