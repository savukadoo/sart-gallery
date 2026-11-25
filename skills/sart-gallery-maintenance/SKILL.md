---
name: sart-gallery-maintenance
description: Develop, review and validate SART Gallery, the Samsung Tizen TV art and photo app, including remote navigation, collections, uploads, native Frame Art Mode and build tooling. Use with the SART repository; the separate ART Frame Uploader macOS app has a different architecture.
license: AGPL-3.0-only
---

# SART Gallery maintenance

Help evolve SART while preserving saved photos, collections, appearance settings and signing identities. This skill contains reusable engineering guidance only. It contains no device inventory, account information or deployment credentials.

## Establish the working context

Find the SART checkout in the supplied workspace. Confirm `package.json` identifies `sart-gallery` and `app/config.xml` describes its Tizen widget. Resolve the code paths below against that checkout, wherever it is located; do not search a person's home directory for private project history.

Read repository instructions and the relevant current source before editing. Treat `README.md`, `CONTRIBUTING.md`, `tools/check.mjs` and the package/config files as the maintained build contract. Read version pins from the repository instead of copying them from an earlier report.

- For source ownership and feature constraints, read [references/architecture.md](references/architecture.md).
- Before selecting tests, performing visual QA or preparing a publication/deployment, read [references/validation.md](references/validation.md).
- For a narrow copy or documentation change, read only the material that applies. Do not rebuild TLS, connect to a TV or change certificates simply because this skill is active.

## Preserve the application contracts

### Platform and interface

SART uses one web-widget package across supported Tizen versions. Preserve the syntax baseline and minimum platform enforced by `tools/check.mjs`; optional features need runtime capability checks. A successful install does not establish that a feature works on that engine.

Keep every visible action reachable with a remote. A modal must have an initial focus, reachable confirmation/cancellation, a reliable Back path and sensible focus restoration. Entering Find art should not immediately trap the user in the system keyboard. Verify text entry and keyboard dismissal separately from ordinary button navigation.

Check layouts at the repository's TV viewport sizes and safe insets, including long artwork titles and collection names. Constrain and wrap text rather than allowing it to widen a dialog. Focus outlines should follow the control's shape. Prevent collection scrolling from displacing the header when focus returns to the top. Keep controls consistent between capability branches.

### Saved state and artwork

Use existing storage helpers and migration conventions. Collection membership can include saved overrides; use the effective collection instead of trusting stale upload metadata. Preserve stable image IDs, favourites, the last artwork and per-image/global appearance when moving or removing records.

Keep SART copies, bundled artwork and Samsung native Art copies distinct. Destructive actions must name the destination/library they affect. Retry and duplicate handling must acknowledge an existing committed image without overwriting an unrelated record.

Saved photos may be IndexedDB blobs on a TV's file origin. Read a saved `photo.blob` directly when bytes are needed; a fetch of its object URL can fail even when display succeeds. Keep CSP protections intact.

### Connections and native Art

Keep the shared phone/computer Add photos flow coherent. HTTPS protects the page and pairing; WebRTC transports the image bytes. Retain the TV's explicit device approval, bounded requests/transfers, session expiry, cancellation and durable-save acknowledgement. WebRTC encryption alone does not authenticate an HTTP-delivered page.

Ordinary uploads run without a companion computer after setup. Initial issuance and later renewal of the TV's HTTPS certificate still use development-computer tooling; sending devices also need manual trust. Check `design/https.md` before claiming a completely computer-free setup.

Offer native Art integration only when supported-model and service checks succeed. Preserve peer pinning and host binding. A native upload, a selected image and entry into Art Mode are different operations: verify their acknowledgements/readback before reporting success. Samsung controls native Art power/sensor behaviour after handoff.

When exporting SART's look, compose the frame, mat, bevel and fit into the image. Keep original and styled native-copy identities separate, reuse only a verified matching copy, and confirm Samsung's additional mat is disabled for a styled export. See `design/native-art.md` and the current native modules for the supported flow.

### Build, security and content rights

Use `tools/samsung_ca.py` for the verified official CA prerequisite. Builds and project signing helpers use its ignored local cache, not a fallback to retained vendor copies. Preserve archive/certificate checksums, HTTPS validation and bounded archive reads. Do not execute downloaded SDK code or add credentials to CI.

TLS has separate server and native-Art client WASM modules. A shared Mbed TLS version upgrade must update both binaries, their source/configuration pins, hashes, licences and build documentation. Use the existing build scripts and verify the changed transports; a version-string edit is not an upgrade.

Find art sources are bounded adapters and validated source definitions. Do not turn a custom source into arbitrary script execution, unrestricted URL fetching or an embedded API secret. Keep host validation, response/image limits and rights information.

Artwork permissions are separate from the software licence. Preserve `ARTWORK-RIGHTS.md`, image provenance, provider review evidence and third-party notices. Public availability is not proof of worldwide artwork clearance or permission to redistribute a third-party certificate.

## Keep the skill and public repository portable

Keep this skill free of identifiable people/accounts and use relative project links. Use reserved documentation addresses when examples are necessary. Exclude personal contact details, live network addresses, device serials/DUIDs/MACs, native-library IDs, account tokens, private keys and signing profiles from the skill and public project documentation. In other repository documents, preserve intended public project URLs and required third-party attribution; those are separate from private user information. Use a disposable demo library for public screenshots.

Private diagnostics, saved-state snapshots and hardware evidence belong outside the public export boundary. Run `tools/check_repository.py --tracked` before publication and inspect the actual staged/committed files. Review retained third-party notices separately from user information; do not remove required attribution to make a privacy check pass.

The skill itself grants no permission to publish, access accounts or deploy to hardware. Use authorization already established in the active task and keep actions scoped to that repository and explicitly selected devices. For updates, retain the author identity and install over the app; do not uninstall as a routine test step. If a target, certificate or host check fails, stop that operation and investigate instead of weakening it or targeting another device.

Finish by stating what changed, why, which checks passed and which browser/device paths remain untested. Keep automated results, browser observations, installation status and physical-TV acceptance separate. Update these instructions when verified architecture changes make them stale; do not append private session history.
