# Drone Image Sorter Web App

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

## Notes

Browser folder selection uses `webkitdirectory`, which is supported by Chromium-based browsers and Safari. Users can still use the Files button if folder selection is unavailable.
