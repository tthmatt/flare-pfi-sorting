# Drone Image Sorter Web App

**Current version:** 0.6.0

The browser application for PFI drone inspection image sorting, deployable on Vercel or any static hosting provider.

## What this app does

- Runs fully in the user's browser.
- Lets the user select a folder or individual image files.
- Reads DJI-style pitch metadata from the first part of each image file.
- Starts a new output folder whenever an image pitch is near either `-90` or `+90` degrees by default.
- Places the marker image at the beginning of the new folder.
- Generates a ZIP download containing the sorted folder structure, with an optional `sort_report.csv` audit file.

Images are not uploaded to a server by this app. The hosted page includes Vercel
Web Analytics for usage measurement. Downloaded images retain their original
embedded metadata.

## Desktop review workspace

Version 0.5.0 organizes the browser app around adding photos, reviewing the
folder plan, and exporting a ZIP. The compact settings sidebar and fixed export
bar remain accessible while scrolling through a large photo selection.

- Click a folder in **Folder plan** to jump to its photos.
- Combine filename/path search with the folder dropdown and the **Folder starts**,
  **Corrected**, **Skipped markers**, or **Unknown pitch** review filters.
- Click a JPG/PNG thumbnail to open the larger viewer. Use its buttons or the
  left/right arrow keys to browse the filtered sequence; Escape closes it.
- Read recorded pitch, altitude, sideways movement and folder decisions directly
  on each card. Folder starts and skipped markers have explicit text labels.
- Expand **Advanced settings** for pitch thresholds, altitude fallback and
  experimental GPS proposals. Telemetry, detailed help and version history are
  also collapsible.
- Clear **Remove CSV report from sorted ZIP** to include the report; reports are
  excluded by default. **Skip marker photos** controls whether marker images are exported.

Review filters only change what is displayed. The complete export plan still
includes every output folder. Original photo bytes remain unchanged.

## Saved reviews

The latest analyzed review is automatically saved in local storage after changes
settle. Saving starts after a short delay of about 400 ms; initial content
fingerprinting can take longer for a full flight. Fingerprints are cached for
the selected files during the session. **Save review file** downloads a separate
JSON copy for backup or transfer. Neither method stores the original photos.

To recover a local review after reloading, select the same originals and choose
**Resume saved review**. To use a downloaded review, choose **Load review file**,
select the originals, and then resume. Use the same selection method as before:
folder selection records paths that may differ from individual file selection.

Before restoring, the app checks each file's path, size, modification time, and
a content fingerprint covering every byte. Files are read in bounded 4 MiB
chunks; the app hashes each chunk with SHA-256, then hashes the ordered chunk
digests. This is a content fingerprint, not a conventional whole-file SHA-256
checksum. A mismatch prevents the saved decisions from being applied.

Resume restores sorting settings and per-photo overrides, including accepted
**Start folder here (keep photo)** boundaries. It does not restore dismissed
suggestions or experimental GPS calibration decisions. Run visual suggestions
again when needed. The original photos must remain available to re-analyze and
export.

Starting analysis on a new selection replaces the latest local saved review.
Download a review file first if you need to retain it. Browser storage is tied
to this site's browser profile and can be cleared by the browser. If storage is
unavailable, the app shows an explicit notice; review-file download still works.
Local saving is capped at 4 MiB before browser quotas are applied. Downloaded
review files support up to 32 MiB and 50,000 photos; larger reviews must be split
into smaller selections.

## ZIP exports

**Split large exports into smaller ZIPs** is enabled by default. Parts contain
about 250 MiB of input photo bytes each. Use each **Download part** button
separately, then extract all parts into the same destination folder. A part can
contain pieces of multiple inspection folders. Naming is allocated once across
the full export, so duplicate or sanitized filenames stay distinct across parts.
When enabled, each part includes the same complete `sort_report.csv`, with an
`output_path` column for every exported photo. Extracting a later part therefore
retains the complete audit report.

Clear that option for a single ZIP. Export runs in a worker with progress and a
**Cancel export** control. Cancellation terminates the active worker and keeps
the review decisions intact; it does not remove any part already downloaded.

A photo larger than 250 MiB is placed in its own larger part. The part limit is
based on input bytes, not ZIP overhead, final download size, or total browser
memory. Smaller parts reduce the amount generated at once, but very large
individual images or limited-memory devices may still need a smaller selection.

## Sideways movement in image previews

After **Analyze images**, each photo preview shows its sideways GPS displacement
in metres, with left/right relative to the preceding photo's camera heading.
The reference filename is displayed below the value. This is a GPS estimate,
not a measurement of movement of building details within the image.

Comparisons use consecutive photos with valid capture times across the complete
selection, including skipped markers. Search, pagination, display sort order
and folder corrections do not change the reference photo. Photos without valid
capture times are excluded from comparisons; tied timestamps, missing GPS and
missing reference camera direction show an explicit unavailable state. The first
timed photo is labelled rather than displaying a false zero.

Values also appear on visual-pass and experimental GPS-proposal preview cards.
This display does not change pass detection, folder decisions, CSV or ZIP output.

## Advanced settings

**Infer missed altitude turns** and **Altitude tolerance (metres)** are
inside **Advanced settings** in the sidebar. The section starts collapsed and
altitude inference remains off by default. Enable it when you want automatic
altitude-based fallback splitting, including when GPS or camera-direction data
is unavailable. Evidence must stay within a continuous sequence of the same
known altitude source and valid, strictly increasing capture times with gaps no
greater than 60 seconds. Missing values, source changes, duplicate timestamps,
and longer gaps break the evidence sequence. An **Altitude fallback on** label remains visible in the section
summary if you enable the fallback and collapse the section.

Leave the fallback off for the visual review workflow. **Visual pass suggestions**
checks altitude independently of this option. Collapsing Advanced settings keeps
your current choices. Resume a saved review to recover its settings after reload.

## Visual pass suggestions (experimental)

For one folder per inspection column, including vertical flights and camera tilt
sweeps at steady height, a missed pitch marker can be reviewed using ordinary photos:

1. Select the original photos and click **Analyze images**.
2. Under **Visual pass suggestions**, click **Find pass boundaries**.
3. Review the suggested boundary and its neighbouring photos. Use the dropdown
   to move the first photo if necessary, then **Accept boundary · keep photo**,
   or dismiss the suggestion. Suggestions alone do not change any folder.
4. Review the full flight, then download the ZIP. Accepted starts retain the
   inspection photo even with **Skip marker photos** enabled.

**Start folder here (keep photo)** is also available on every photo for boundaries
the detector misses. **Keep in current folder (inspection photo)** prevents a
split at that photo. Accepted starts use capture-time order, are recorded as
`manual-split` with `marker_override=split` in the CSV, and can be undone. Like
other corrections, they survive re-analysis of the same selection and can be
restored through a saved review after reselecting the originals. Undo in the
current suggestion session restores any prior decision on that photo.

The detector first checks consecutive capture-time records for predominantly
sideways displacement relative to **gimbal yaw**, compatible relative/absolute
altitude, stable camera heading, and vertical-pass or reversed camera-sweep evidence
around the move.
Missing metadata is not treated as zero. It rejects forward approaches, tilting
without sideways movement, inconsistent altitude sources, GPS jumps that do not
persist, and nearby existing markers. Thresholds are experimental, not calibrated
confidence scores.

Camera pitch can change while moving into the next column. If the adjacent
photos have different camera angles, the detector looks within four photos on
each side for a pair with similar pitch and height. The comparison photos are
named in the suggestion, and the proposed folder start remains the first photo
after the sideways move. If no compatible pair exists, the visual check is
explicitly inconclusive; it does not compare incompatible views as if aligned.

Short excerpts and level detail photos can hide the preceding ascent/descent.
These can produce a **Limited altitude evidence** suggestion when GPS shows a
persistent sideways move and at least three following photos show vertical
movement in the new column. A missing preceding direction is never invented.
These weaker suggestions still require operator acceptance and can be wrong.

**Camera sweep at steady height** covers a different pattern: the drone stays at
one height while the camera tilts down a column, moves sideways, then tilts up the
next column (or the reverse). Each side needs at least three photos with two
deliberate tilt steps of at least 5° and a pitch span of at least 20°. The combined
height range must stay within 0.75 m. The sideways move must be at least 1 m and
twice the forward movement; horizontal drift within either sweep must stay below
one sixth of that sideways move. Ordinary altitude-pass suggestions still need
at least 2 m sideways movement.

Camera sweeps compare the closest matching camera angles and **require supporting
image matches** before a suggestion appears. An inconclusive image check omits
that suggestion and reports the count for manual review. This stricter image
requirement keeps small GPS shifts and camera tilts alone from creating proposals.
Suggestions still require acceptance before any folder changes.

**Tilted return pass** covers an established ascent/descent followed by a sideways
move and camera tilts in the opposite vertical direction at steady height. It
retains the 2 m sideways minimum and requires a stable position in the new column.
Normally, at least three inspection photos must show two deliberate tilt steps
spanning 20°. A short pass of two inspection photos can qualify when their tilt
changes by at least 10° and the next record is a separate marker at the same
position, heading and height within 60 seconds. The marker does not supply a tilt
step and remains its own folder boundary. A cropped two-photo ending without a
marker, a small tilt adjustment, and an unestablished prior flight do not qualify.
As with altitude-based suggestions, incompatible camera views leave the image
check explicitly inconclusive; review the photos before accepting this metadata
suggestion.

**Vertical passes at separate positions** can qualify even when the camera turns
or the drone changes height while moving between columns. This stricter path
allows a heading change up to 45° and a boundary height change up to 5 m, only
when each side has at least three photos with two significant altitude steps
(over 0.75 m), at least 3 m vertical span, consistent opposing directions and at
least 3 m of overlapping height range. Headings must be stable within 8° inside
each pass; a turn within a pass can truncate its evidence.

The move must project at least 4 m sideways in **both** camera headings and remain
more lateral than forward in each. In the midpoint heading, sideways movement
must be at least twice the forward movement and twice the height change. Full
horizontal drift within either pass must not exceed one sixth of the smaller
sideways projection. This keeps stationary turns, forward approaches, unstable
GPS and unrelated altitude changes from qualifying. The UI reports the heading
change. A metadata suggestion still needs operator acceptance, and incompatible
views remain an inconclusive image check rather than a claimed match.

Candidate JPG/PNG pairs are decoded sequentially in a Web Worker into thumbnails
no larger than 480 pixels. Distinct normalised patches in the lower image region
are matched against densely sampled target positions, including odd pixel
offsets, and checked for consistent sideways movement. Excluding the upper
region reduces distant-building/sky matches, but is only a heuristic: this is
not semantic facade recognition. No ML model, network request or paid API is
used for the visual check. The main thread remains available for cancellation.
The worker is terminated on completion, cancellation, timeout or error.

Suggestions need capture times, GPS, gimbal yaw, pitch, consistent altitude and
surrounding movement evidence. Image support needs overlapping views at similar
camera angles. The detector can still
miss very short excerpts, same-direction passes, large heading changes,
low-texture walls and repeated windows. TIFF/DNG, decode failures and
unsupported browser features are explicitly shown as inconclusive visual checks.
An inconclusive comparison never becomes a visually supported claim. Candidate
sessions are bounded to 200 pairs and individual files to 64 MiB; any unexamined
candidates are reported. Always review the complete set before exporting.

Calibration: the supplied three-pass sequence supports the missing boundary
before photo `0015`. Its tilt/approach adjustments are useful negative examples.
The redacted telemetry fixture preserves relative motion only; original images,
absolute GPS coordinates, capture dates and camera identifiers are not committed.
Additional excerpts cover the removed-marker boundaries before `0062` and `0070`,
including pitch adjustments and a short preceding descent. Their combined
sequence proposes only those two boundaries. The image comparison can remain
inconclusive even when GPS and altitude support a review suggestion.
The steady-height sample covers `0020–0022` followed by `0024–0026`: all six photos
are at 4.2 m, and the move before `0024` is about 1.26 m sideways. The old rule
rejected both the small move and the lack of altitude reversal. The new sweep
rule proposes only `0024`, uses `0020`/`0026` for image comparison and produces two
three-photo folders when accepted. Its fixture also contains only relative motion.
The short tilted-return sample climbs through `0074`, moves about 3.49 m sideways
to `0076`, and tilts from −32.9° to −47.8° through `0077` at 11.5 m height. The next
photo, `0078`, is a separate marker. Accepting the sole `0076` suggestion creates
five-photo and two-photo inspection folders with markers skipped, or 5/2/1 when
retaining `0078`. The image check is inconclusive because the camera angles do
not align. This sample is also stored only as redacted relative-motion telemetry.
The `0859–0869` sample descends through `0864`, moves about 10.74 m sideways to
`0865`, then ascends in the new column. The boundary changes heading by 38.4° and
height by −2.2 m, exceeding the old adjacent-view limits of 8° and 2 m. The new
rule proposes only `0865`; accepting it produces 6/5 photos. The image check is
inconclusive because the headings differ. Its telemetry fixture is also redacted.
These limited samples do not establish general accuracy or Mavic 2 support.
The matching regression checks do not measure real-flight accuracy. Follow the
[validation guide](../docs/validation.md) before making accuracy claims.

## Correcting unreliable gimbal pitch (including Mavic 2)

A downward-facing photo may contain a recorded gimbal pitch of `0°`. The app
cannot recover the real angle from incorrect metadata. Review the photos after
analysis and use **Folder decision → Start folder here (marker)** on a missed
marker. An explicit correction starts a folder even beside another marker.

- **Automatic** restores the normal pitch and altitude rules for that photo.
- **Keep in current folder (inspection photo)** keeps the photo in the output and prevents an
  automatic or inferred split at that photo.
- Corrections update folder previews, CSV reports, and the downloaded ZIP immediately.
- **Skip marker photos** also skips manually marked photos;
  the next inspection photo starts the folder. Skipped markers remain in the review
  so you can undo mistakes, including when every photo was skipped.
- Search by filename or folder path to find a photo in a large selection.
- Corrections survive re-analysis of the same selection. After choosing files
  again or reloading, select the originals and use **Resume saved review** to
  restore them. **Reset corrections** restores automation.
- Original image bytes and recorded pitch are unchanged. CSV reports include
  `manual-marker` folder-start reasons and a `marker_override` column.

The browser now reads binary EXIF capture dates from JPEG and TIFF/DNG metadata
within its existing 2 MiB read limit. It prefers EXIF DateTimeOriginal, then XMP
DateTimeOriginal, then EXIF DateTimeDigitized, then XMP CreateDate. Date-only DJI
placeholders such as `1970-01-01` are not valid capture times. EXIF timezone offsets
are honored; timestamps without an offset retain the existing UTC sorting convention.

## Local development

Use Node.js 22 and npm. From the repository root:

```bash
cd web-app
npm ci
npm run dev
```

Run `npm test` from `web-app` for the browser regression suite. Golden metadata,
grouping, and GPS fixtures live in `web-app/test-support/golden/`; redacted visual
pass fixtures and test helpers live directly in `web-app/test-support/`.

For browser workflow checks, run these commands from `web-app`:

```bash
npx playwright install chromium
npm run test:e2e
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
- Install Command: `npm ci`
- Build Command: `npm run build`
- Output Directory: `dist`


## Changelog

### 0.6.0 - 2026-09-28

- Focus the repository, documentation, and CI on the browser application.
- Save and restore reviewed settings and photo decisions with full-content file fingerprints.
- Preserve colliding export names and offer smaller ZIP parts, progress, and cancellation.
- Keep altitude fallback within continuous, compatible telemetry sequences.
- Match visual patches at odd as well as even pixel offsets.
- Add browser workflow checks and a real-flight validation guide without claiming field accuracy.

### 0.4.6 - 2026-09-24

- Detect strongly separated, sustained vertical passes across moderate camera turns and height offsets.
- Check heading stability within each pass and sideways movement in both camera frames.
- Show the heading change without treating incompatible camera views as an image match.
- Add redacted telemetry and regression coverage for the missed boundary before `0865`.

### 0.4.5 - 2026-09-24

- Detect established vertical flights followed by tilted return passes after a sideways move.
- Support short two-photo inspection passes ending at a separate marker, without using the marker as tilt evidence.
- Explain the mixed flight/tilt evidence and keep incompatible image comparisons explicitly inconclusive.
- Add redacted telemetry and regression coverage for the missing boundary before `0076`.

### 0.4.4 - 2026-09-24

- Detect reversed camera tilt sweeps at steady height after a persistent sideways move.
- Require stable GPS clusters and supporting image matches for these smaller transitions.
- Explain camera-sweep suggestions and report sweeps lacking image support for manual review.
- Add a redacted regression fixture for the missing boundary before `0024`.

### 0.4.3 - 2026-09-24

- Display sideways GPS movement, left/right direction and the reference photo in all image previews.
- Keep comparisons tied to capture order and label unavailable telemetry explicitly.

### 0.4.2 - 2026-09-24

- Suggest persistent sideways moves despite pitch adjustments or limited preceding altitude evidence.
- Compare nearby photos at similar camera angles without moving the first new-pass photo.
- Label limited evidence and unavailable comparisons explicitly; folder changes still require acceptance.

### 0.4.1 - 2026-09-24

- Moved altitude inference and its tolerance into collapsed Advanced settings.
- Kept altitude inference off by default and explained its independence from visual suggestions.
- Kept an active fallback indicator visible when Advanced settings is collapsed.

### 0.4.0 - 2026-09-24

- Added optional local visual pass suggestions with bounded, cancellable thumbnail comparison.
- Added accept, move, dismiss and undo controls with explicit inconclusive states.
- Added retained-photo folder starts and capture-order grouping for reviewed boundaries.
- Added regression coverage for the confirmed missing boundary, camera adjustments and ZIP photo retention.

### 0.3.7 - 2026-09-24

- Added per-photo, reversible marker corrections that immediately update grouping and exports.
- Kept skipped markers reviewable, added filename search, and preserved corrections across re-analysis.
- Read actual EXIF capture times instead of DJI's date-only XMP placeholder.
- Respect manual marker corrections in optional altitude inference and GPS proposal suppression.
- Fixed repeated automatic splits in runs of three or more consecutive marker photos.

### 0.3.6 - 2026-08-11

- Corrected GPS proposal filenames and evidence to consistently use capture-time flight order.
- Added transition-wide marker suppression, complete rejection counts, and auditable redacted evidence.
- Added a seven-image local calibration reviewer and separate JSON report download.

### 0.3.5 - 2026-08-11

- Parse the full 2 MiB metadata window in one pass and reuse the browser text decoder.
- Analyze with four bounded readers and throttled, deterministic progress updates.
- Render previews in batches of 100 without changing folder tables, CSV reports, or ZIP membership.

### 0.3.4 - 2026-08-11

- Added an unchecked, experimental GPS turn-proposal view for real-flight calibration.
- Proposals are review-only, do not change folders, and are never included in the ZIP.
- Added shared GPS and timestamp golden vectors; timezone-free DJI timestamps now order as UTC.

### 0.3.3 - 2026-08-11

- Added normalized telemetry parsing and deterministic metadata warnings.
- Added local-only telemetry coverage for GPS, pitch, time, altitude sources, and yaw.


### 0.3.2 - 2026-08-11

- Refactor image metadata, ordering, grouping, telemetry, file helpers, and report generation out of `App.jsx`.
- Read metadata from a consistent 2 MiB window.
- Add JSON golden grouping vectors for regression testing.
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
- Add browser controls for skipping pitched-down marker photos while still using them as split points.
- Expand browser previews so all grouped photos can be reviewed with thumbnails when supported.
- Brand the web app with Flare Dynamics naming and logo treatment.
- Document Vercel deployment and project/security information.

### 0.1.0 - Initial release

Based on merged pull requests #1 and #2, the initial release added:

- Browser-only Vercel web app with folder/file selection, local image processing, ZIP export, and CSV audit reporting.

## Notes

Browser folder selection uses `webkitdirectory`. Use the Files button if folder
selection is unavailable in your browser.
