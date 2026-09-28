# Security Policy

## Scope

This repository contains the browser application and its development tools.
Reports should identify the affected commit or deployed app version and include
steps to reproduce the issue. The current browser code is the maintenance
target; older deployments may not contain the latest fixes.

## Reporting a vulnerability

For a sensitive issue, use **Report a vulnerability** in the repository's
[Security tab](https://github.com/tthmatt/flare-pfi-sorting/security) if private
reporting is available. Otherwise, contact the repository owner through a
published private contact channel before sharing exploit details. Do not put
private inspection photos, precise GPS coordinates, credentials, or other
sensitive data in a public issue.

Include the browser and operating system, affected version or commit, expected
and observed behavior, and a minimal redacted example where possible. A
synthetic image or metadata fixture is preferable to customer inspection data.

## Data handling

Selected photos are processed in the browser. The app does not upload them for
metadata parsing, image comparison, or ZIP creation. The hosted app includes
Vercel Web Analytics for usage measurement; local processing is not a promise
that the hosted page makes no network requests.

Exported photos retain their original bytes and embedded metadata. A ZIP or
report may therefore contain sensitive filenames, inspection details, capture
times, or locations. Review downloaded artifacts before sharing them.

The browser saves the latest analyzed review in local storage. Review files
contain file paths, sizes, modification times, content fingerprints, settings,
and photo decisions, but not the original photos. Browser storage is tied to
the site and browser profile; consider access by other users of that profile.

Resume checks cover every image byte alongside its file inventory. The app
hashes each 4 MiB chunk with SHA-256, then hashes the ordered chunk digests to
form a content fingerprint. This fingerprint is not the same as a conventional
whole-file SHA-256 checksum. No original image bytes are stored in the review.

Experimental boundary suggestions require operator review. Incorrect grouping
or a missed boundary should be reported as a normal bug unless it also exposes
data, permits unintended code execution, or crosses another security boundary.
