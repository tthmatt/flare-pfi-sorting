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

### Options

- `--move`: move files instead of copying them.
- `--dry-run`: print the planned folder placements without writing files.
- `--recursive`: scan nested input folders.
- `--tolerance DEGREES`: change how close pitch must be to 90 degrees. Default: `2.0`.
- `--folder-prefix NAME`: change folder names from `inspection_run_001` to `NAME_001`.
- `--marker-policy same-folder`: keep a pitched-down marker in the current folder and start the following image in the next folder.

## Development

Run the test suite:

```bash
python -m pytest
```
