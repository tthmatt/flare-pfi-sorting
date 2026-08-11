# Drone Image Sorter Web App

**Current version:** 0.3.3

Browser-based version of the PFI drone inspection image sorter for deployment on Vercel or any static hosting provider.

## What this app does

- Runs fully in the user's browser.
- Lets the user select a folder or individual image files.
- Reads DJI-style pitch metadata from the first part of each image file.
- Starts a new output folder whenever an image pitch is near `-90` degrees by default.
- Places the marker image at the beginning of the new folder.
- Generates a ZIP download containing the sorted folder structure and a `sort_report.csv` audit file.

Images are not uploaded to a server by this app.

## Local development

```bash
cd web-app
npm install
npm run dev
```

## Production build

```bash
cd web-app
npm run build
```

The built static site is written to `web-app/dist`.

## Vercel deployment

Import this GitHub repository into Vercel and use these settings:

- Root Directory: `web-app`
- Framework Preset: `Vite`
- Install Command: `npm install`
- Build Command: `npm run build`
- Output Directory: `dist`


## Changelog

### 0.3.3 - 2026-08-11

- Added normalized telemetry parsing and deterministic metadata warnings.
- Added local-only telemetry coverage for GPS, pitch, time, altitude sources, and yaw.


### 0.3.2 - 2026-08-11

- Refactor image metadata, ordering, grouping, telemetry, file helpers, and report generation out of `App.jsx`.
- Read metadata from a consistent 2 MiB window in both the browser and Python sorter.
- Share JSON golden grouping vectors between the JavaScript and Python test suites.
- Preserve v0.3.1 grouping behavior, including pitched-down marker priority and consecutive duplicate-marker suppression.

### 0.3.1 - 2026-08-03

- Start a new folder after the first photo of a confirmed horizontal traverse between opposite vertical facade passes.
- Require two near-level, near-0° pitch photos plus sustained vertical movement on both sides.
- Keep pitched-down markers primary and avoid duplicate inferred folders around them.
- Record `horizontal-traverse` as a distinct folder start reason in previews and CSV reports.

### 0.3.0 - 2026-07-10

- Add optional altitude-reversal fallback splitting for missed pitched-down marker photos.
- Require sustained altitude turns and suppress inferred splits around real marker photos.
- Preserve folder start reasons in browser previews and CSV reports.
- Treat both `+90°` and `-90°` as pitched-down markers.

### 0.2.0 - 2026-07-10

Based on merged pull requests #3 through #11, this release includes:

- Avoid creating extra empty folders when duplicate pitched-down marker photos appear in a row.
- Add an option to remove the CSV report from the downloaded sorted ZIP.
- Add browser-console status logging for troubleshooting.
- Add browser and local UI controls for skipping pitched-down marker photos while still using them as split points.
- Add CLI support for skipping pitched-down marker photos with `--skip-markers`.
- Expand browser previews so all grouped photos can be reviewed with thumbnails when supported.
- Brand the web app with Flare Dynamics naming and logo treatment.
- Document Vercel deployment and project/security information.

### 0.1.0 - Initial release

Based on merged pull requests #1 and #2, the initial release added:

- Python CLI and local web GUI for sorting drone inspection images by pitch metadata.
- Browser-only Vercel web app with folder/file selection, local image processing, ZIP export, and CSV audit reporting.

## Notes

Browser folder selection uses `webkitdirectory`, which is supported by Chromium-based browsers and Safari. Users can still use the Files button if folder selection is unavailable.
