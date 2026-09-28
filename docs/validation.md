# Real-flight validation

Automated regression tests check known cases and application behavior. They do
not establish real-flight precision, recall, or a calibrated confidence score.
No field-accuracy measurements are claimed here.

## Build an independent reference set

Collect complete flights across the cameras, facades, flight patterns, and
lighting conditions the team intends to support. Include repeated windows,
plain walls, small sideways moves, camera tilt sweeps, heading changes, partial
passes, missing markers, and poor or missing telemetry. Keep flights used to
tune thresholds separate from the flights used for final evaluation.

Have an operator label the first inspection photo of every intended new pass
before looking at detector results. Record explicit marker photos separately.
Use stable relative file paths so duplicate filenames do not merge labels.
For ambiguous transitions, record the reason and have another operator resolve
them. Report unresolved labels separately rather than treating them as correct.

Keep original inspection images private. A shareable regression fixture should
contain only the minimum redacted or synthetic evidence needed to reproduce a
case; GPS coordinates, capture dates, and customer names may identify a site.

## Measure boundary quality

Run a fixed app commit and settings against the held-out flights. Save the
version, settings, expected boundary paths, proposed boundary paths, evidence
type, and image-check status. Measure the unedited suggestions before operator
acceptance; final corrected folders measure the combined operator workflow.

Match a proposed first-photo boundary to at most one labeled boundary. Use exact
first-photo matches as the primary metric. If an adjacent-photo tolerance is
also useful, define it before the evaluation and report it separately. Extra
proposals for the same true boundary count as false positives.

| Measure | Calculation | Meaning |
| --- | --- | --- |
| Precision | Correct proposed boundaries / all proposed boundaries | How often a review suggestion is useful |
| Recall | Correct proposed boundaries / all eligible labeled boundaries | How many expected boundaries are found |
| False boundaries per flight | Incorrect proposed boundaries / flights | Unnecessary review burden |
| Missed boundaries per flight | Unmatched labeled boundaries / flights | Remaining manual correction work |

Report counts as well as ratios. Use “not applicable” when a denominator is
zero. State which labeled boundaries were eligible; missing telemetry must not
quietly disappear from the coverage report. Break results down by flight,
camera, pass pattern, evidence type, and visually supported versus inconclusive
image checks. Report automatic altitude splitting separately from optional
visual suggestions. A single combined accuracy number can conceal poor recall
on difficult flights.

## Check false boundaries and output integrity

- Suggestions alone must not change the folder plan. Accepting a boundary must
  start the intended photo's folder; dismissing it must leave grouping unchanged.
- Stationary tilt adjustments, forward approaches, GPS spikes, same-direction
  pauses, and continuous marker bursts should not introduce unrelated splits.
- Altitude fallback must not bridge unknown or changing altitude sources,
  missing timestamps, duplicate timestamps, or capture gaps over 60 seconds.
- Check visually similar repeated windows and low-texture walls separately.
  Inconclusive comparisons must not be presented as supporting image matches.
- With markers skipped, accepted inspection boundaries must retain their first
  photo. Check the expected folder counts and membership after corrections.
- Save, reload, reselect, and resume a review. Confirm settings and accepted
  photo decisions return, and a mismatched file selection is rejected.
- Export colliding filenames and sanitized paths. Extract every ZIP part into
  one folder and verify every intended photo appears exactly once, with its
  original bytes. Verify cancellation leaves the review usable for another
  export.

Set release criteria before evaluating the held-out set. Preserve failures as
new regression cases, repeat the same evaluation after a fix, and report both
improvements and remaining failure patterns. Do not infer general accuracy from
a handful of successful calibration excerpts.
