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
  save panoramic as PNG, panoramic tilt (buccal/lingual, front/back, left/right).
- Opens in the Oblique layout so every 2D view can be tilted.

Rebuild:
    git clone https://github.com/Kitware/VolView && cd VolView && git checkout 66543cf
    git apply ../volview-shscan.patch && cp ../shscan-logo.png src/assets/
    npm ci && npx vite build --base=/viewer/
    # upload dist/ as /viewer/ of the shscan-viewer-test project
