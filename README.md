https://flare-pfi-sorting.vercel.app/

# Flare PFI Sorting

A dependency-free Python command-line tool for sorting drone building-inspection images into inspection run folders. The sorter reads embedded EXIF/XMP-style metadata and starts a new folder whenever the camera or gimbal pitch is detected as straight down (approximately 90 degrees).

## Why this exists

During a building inspection flight, pilots often point the drone camera straight down to mark the beginning of a new roof face, elevation, or inspection pass. This tool uses that pitch marker to split the photo stream into folders automatically.

## Supported metadata

The sorter looks for common embedded pitch fields used by drone vendors and metadata tools, including:

- `drone-dji:GimbalPitchDegree`
- `drone-dji:CameraPitchDegree`
- `CameraPitchDegree`
- `CameraPitch`
- `GimbalPitch`

Both `90` and `-90` are treated as pitched down because different vendors use different signs. The default tolerance is `2` degrees, so `-89.4` and `91.2` count as down-facing markers.

## Web GUI for non-technical users

The easiest way to use the sorter is the local web interface. It opens a browser page where the user can paste the source image folder and the destination folder, choose copy or move, preview the result, optionally skip marker images in the sorted output, and start sorting with one button.

Start the GUI by double-clicking `launch_sorter.py` from this repository, or run it directly if you are already in a terminal:

```bash
python -m pfi_sorter.web
```

After installing the package, the GUI can also be launched with either installed shortcut command:

```bash
pfi-sort-web
# or
pfi-sort-gui
```

The page runs locally at `http://127.0.0.1:8765/` by default and opens your browser automatically. It does not upload images to the internet; it calls the same local sorting engine used by the command-line tool.

### GUI workflow

1. Paste the full path to the folder containing the drone images.
2. Paste the full path where sorted folders should be created.
3. Leave **Copy files** selected unless you intentionally want originals moved.
4. Optionally enable **Skip pitched-down marker photos in output** to use marker photos only as split points.
5. Optionally enable **Preview only** to confirm the folder plan without writing files.
6. Click **Sort inspection images**.
## Installation

Run directly from this repository:

```bash
python -m pfi_sorter.cli ./input-images ./sorted-images
```

Or install the console script in editable mode:

```bash
python -m pip install -e .
pfi-sort ./input-images ./sorted-images
```

## Usage

```bash
pfi-sort INPUT_DIR OUTPUT_DIR [options]
```

By default, files are copied and each pitched-down marker image is placed in the new folder it starts:

```text
input-images/
  DJI_0001.JPG   pitch=-20
  DJI_0002.JPG   pitch=-90  -> starts inspection_run_002
  DJI_0003.JPG   pitch=-15
  DJI_0004.JPG   pitch=-90  -> starts inspection_run_003
```

Result:

```text
sorted-images/
  inspection_run_001/
    DJI_0001.JPG
  inspection_run_002/
    DJI_0002.JPG
    DJI_0003.JPG
  inspection_run_003/
    DJI_0004.JPG
```

To use pitched-down images only as folder split markers and skip them in the sorted output, add `--skip-markers`:

```bash
pfi-sort ./input-images ./sorted-images --skip-markers
```

With the example above, the output would skip `DJI_0002.JPG` and `DJI_0004.JPG` while still placing `DJI_0003.JPG` in `inspection_run_002`.

### Options

- `--move`: move files instead of copying them.
- `--dry-run`: print the planned folder placements without writing files.
- `--recursive`: scan nested input folders.
- `--tolerance DEGREES`: change how close pitch must be to 90 degrees. Default: `2.0`.
- `--folder-prefix NAME`: change folder names from `inspection_run_001` to `NAME_001`.
- `--marker-policy same-folder`: keep a pitched-down marker in the current folder and start the following image in the next folder.
- `--skip-markers`: use pitched-down marker photos to split folders, but do not copy or move those marker photos into the output folders.

## Development

Run the test suite:

```bash
python -m pytest
```
