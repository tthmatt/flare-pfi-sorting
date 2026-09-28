# Flare PFI Sorting

[Open the browser app](https://flare-pfi-sorting.vercel.app/)

Flare PFI Sorting organizes drone inspection photos into inspection-pass folders.
Select your photos, review the proposed boundaries, correct any missed markers,
and download the sorted folders as a ZIP. The application runs in your browser;
there is no command-line sorter or local file-moving service to install.

## Review and export an inspection

1. Choose a photo folder or individual files, then select **Analyze images**.
2. Review the **Folder plan** and photo previews. Search by filename or path,
   filter the review, or open a JPG/PNG in the larger image viewer.
3. Correct a photo's **Folder decision** when needed. Use **Start folder here
   (marker)** for a missed downward marker, or **Start folder here (keep photo)**
   for the first inspection photo of a new pass.
4. Optionally run **Visual pass suggestions** to review possible missed
   boundaries. A suggestion changes folders only after you accept it.
5. Choose whether to skip marker photos, retain source subfolder paths, and
   include a CSV report, then download the ZIP. If you enable smaller ZIPs,
   download every part shown.

The app copies the selected image bytes into the download. It does not move,
rename, or modify the original files. Review filters affect the displayed photos;
they do not exclude photos from the planned export.

## Save and resume a review

The latest analyzed review is saved automatically in this browser after changes.
Use **Save review file** to download a separate JSON copy. Photos are not stored
with the review.

To resume, select the same original files using the same folder or individual
file selection method, then choose **Resume saved review**. For a downloaded
review, use **Load review file** first. The app checks paths, sizes, modification
times, and fingerprints covering every image byte before restoring settings and photo
decisions, including accepted pass boundaries.

Starting an analysis on a new selection replaces the latest local saved review.
Dismissed suggestions and experimental calibration decisions are not saved.
If browser storage is unavailable, the app displays a notice; downloading a
review file still works. See [saved reviews](web-app/README.md#saved-reviews)
for the checks and limitations.

## ZIP downloads

Exports use a single ZIP by default. Enable **Split large exports into smaller
ZIPs** to create parts with about 250 MiB of input photos each. Download each
part using its button and extract all parts into the same destination folder.
Output names are allocated across the whole export so duplicate names remain
distinct and consistent between parts.

Export progress is shown, and **Cancel export** stops the worker without changing
your review. When splitting is enabled, a photo larger than 250 MiB receives its
own larger part. The part size is not a cap on total browser memory use.

## How boundaries are found

Pitched-down photos are the primary marker. By default, a pitch within 2° of
either −90° or +90° qualifies. Consecutive automatic markers form one boundary.
Manual marker corrections are available when recorded gimbal pitch is wrong.

The optional **Infer missed altitude turns** setting starts off. It looks for
sustained altitude reversals and confirmed level traverses between opposing
vertical passes. It only joins continuous readings from the same known altitude
source, with valid increasing capture times no more than 60 seconds apart.
Visual suggestions check altitude independently and can remain enabled as a
review workflow while automatic altitude inference is off.

Experimental visual suggestions combine capture order, GPS movement, camera
direction, altitude, and local image comparisons. They can miss boundaries or
suggest an incorrect one; check the surrounding photos before accepting. The
separate experimental GPS proposal view is for calibration and does not change
folder membership.

Suggestions also cover sustained camera pans between vertical runs, including
new sections viewed from almost the same position. Large pans can start another
section while the drone continues upwards or downwards. Camera turns without
comparable views remain explicitly inconclusive in the image check. Gaps over
60 seconds still need manual review.

See the [browser workspace guide](web-app/README.md) for correction controls,
visual-pass patterns, telemetry interpretation, and current limitations.

## Images and metadata

- Supported input extensions: JPG/JPEG, PNG, TIFF/TIF, and DNG.
- JPG/JPEG and PNG support browser previews and visual image comparisons.
- Metadata analysis reads up to the first 2 MiB of each file, using embedded
  EXIF/XMP information where available.
- Original EXIF capture dates take precedence over placeholder XMP dates.
  Timestamps without a timezone use UTC for ordering.
- Relative altitude is preferred over absolute or GPS altitude. Missing or
  incompatible telemetry is shown explicitly; it is not treated as zero.

## Privacy

Photo metadata analysis, previews, and visual comparisons happen locally in the
browser. The app does not upload selected images for processing. The hosted app
includes Vercel Web Analytics for site usage. Downloaded photos retain their
original embedded metadata, which can include locations and capture times.
Saved reviews contain file inventory, content fingerprints, settings, and review
decisions; treat them as inspection data when sharing or using a shared browser.

## Development

Use Node.js 22 and npm. From the repository root:

```bash
npm ci --prefix web-app
npm run dev --prefix web-app
```

Run the browser tests and production build:

```bash
npm test --prefix web-app
npm run build --prefix web-app
```

Run the browser workflow checks after installing Chromium for Playwright:

```bash
cd web-app
npx playwright install chromium
npm run test:e2e
```

Regression fixtures live in `web-app/test-support/`, including the golden
metadata, grouping, and GPS vectors in `web-app/test-support/golden/`.
The metadata benchmark is available with
`npm run benchmark:metadata --prefix web-app`.
For real-flight evaluation, use the [validation guide](docs/validation.md).
Regression tests do not establish measured field accuracy.

## Deployment

The production build is a static site in `web-app/dist`. For Vercel, set the
project root to `web-app`, use the Vite framework preset, install with `npm ci`,
build with `npm run build`, and publish `dist`. Other static hosts can serve the
same built directory.

For sensitive vulnerability reports, see [SECURITY.md](SECURITY.md).
