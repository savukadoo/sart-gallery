# Source ownership and feature guidance

All code paths in this reference are relative to the SART checkout. Inspect the current implementations before relying on a historical design note.

## Where to start

| Area | Primary files | Related design notes |
| --- | --- | --- |
| Screen flow, remote focus and dialogs | `app/main.mjs`, `app/styles.css`, `app/index.html`, `app/compat.mjs` | `design/ux-review-2026-10-28.md`, `design/tizen-compatibility.md` |
| Collections, preferences and image state | `app/core.mjs`, `app/storage.mjs`, `app/uploads-manager.mjs` | `design/collections-notes.md`, `design/global-appearance.md` |
| Slideshow timing, transitions and motion | `app/slideshow.mjs`, player integration in `app/main.mjs` | `design/slideshow-effects.md` |
| Frame, mat, bevel and image composition | `app/core.mjs`, `app/styles.css`, `app/native-composition.mjs` | `design/frame-references.md`, `design/mat-depth.md` |
| Phone/computer upload page | `mobile/index.html`, `mobile/mobile.mjs`, `mobile/mobile.css`, `app/mobile-shared.mjs` | `design/direct-upload.md` |
| TV upload host and pairing | `app/mobile-host.mjs`, `app/mobile-native.mjs`, `app/mobile-http.mjs`, `app/mobile-setup.mjs`, `app/mobile-identity.mjs`, `app/mobile-tls.mjs` | `design/https.md` |
| Native Samsung Art integration | `app/native-art.mjs`, `app/native-art-library.mjs`, `app/native-art-manager.mjs`, `app/native-art-worker.mjs`, `app/native-art-tls.mjs` | `design/native-art.md` |
| Find art, source configuration and batch saves | `app/find-art.mjs`, `app/find-art-sources.mjs`, `app/find-sources-manager.mjs`, `app/find-art-batch.mjs`, `app/response-limits.mjs` | `design/find-art.md` |
| Optional desktop library service and preview | `companion/server.py`, `companion/manage.mjs`, `companion/manage.css` | `README.md`, `design/https.md` |
| Packaging, prerequisites and installation | `tools/package_app.py`, `tools/samsung_ca.py`, `tools/tv.py`, `tools/tv_signing.py`, `tools/tv_inspector.py` | `README.md`, `CONTRIBUTING.md` |
| TLS source and provenance | `tools/tls/server.c`, `tools/tls/config.h`, `tools/tls/native-client.c`, `tools/tls/native-client-config.h`, `tools/build_tls.py`, `tools/build_native_art_tls.py` | `LICENSES/provenance.json`, `app/assets/tls-license.json`, `app/assets/native-art-tls-license.json` |

## Changes that cross feature boundaries

### Collections and uploads

The TV, shared browser page and optional desktop service can affect the same library. Use the current serialized storage/write path. A collection rename/move must remain consistent in the gallery, upload destination picker and management screens.

An upload is complete only after its durable TV save or verified existing-image acknowledgement. Keep the transfer identity through a retry. Distinguish a duplicate from a same-name/different-content conflict. Do not infer success from the sender finishing its data-channel writes.

The phone's text field may retain focus while its photo picker opens. Preserve explicit blur before file selection and test the native picker interaction on a real phone when that path changes. Browser automation cannot establish the operating-system picker's behaviour.

The unique local HTTPS identity and its manual trust setup are separate from Samsung developer signing certificates. Preserve identity across app updates. Do not replace browser trust with a shared private key, silently weaken certificate validation or expose photo APIs through the certificate-download setup listener.

### Artwork presentation and native copies

The ordinary SART player and Samsung's native Art app are separate display paths. Keep ordinary-TV features available without native Art capability. App image filters should not be presented as verified changes to the physical panel's brightness or picture settings.

For motion changes, check a playing slideshow after closing settings and after manual next/previous navigation. Confirm movement from an actual frame/time comparison or visible hardware observation; the presence of a CSS animation or running timer is insufficient.

Native-library management must distinguish eligible personal-photo records from store content. Select by stable native image identity, use authenticated bounded previews, and read back the result of a deletion. Remove only fixtures created for the current authorized test; do not treat a complete library as disposable.

### Sources and content

Find art source definitions should stay data, with explicit provider/host rules. Keep collection selection/creation in batch-save flows, long result metadata within dialog bounds, recent-search handling and a deliberate route into custom text entry. Provider changes may require parsing, rights, CSP and image-fetch tests together.

Default artwork is a catalogue of named collections. Check the current catalogue's counts and metadata when replacing images, generate matching thumbnails and retain provenance. Do not copy a user's uploaded photos into bundled assets or public screenshots.

### Build and compatibility

Edit source under `app/` and `mobile/`; regenerate `dist/widget/` instead of editing bundled output. Packaging removes module imports and concatenates a declared module order. Adding a source module requires checking that order, browser assets, workers and CSP as appropriate.

Keep the web syntax and WASM instruction baseline compatible with the oldest supported engine. Feature-detect individual APIs and partial Samsung Web API namespaces. Do not lower the declared Tizen minimum without validating the actual engine and optional transports.

Certificate acquisition happens on the development computer. The official archive is pinned and parsed as data; the cache is ignored by Git and excluded from source bundles. It is not a runtime TV download. Consult `tools/samsung_ca.py` and `NOTICE` for the current acquisition and retained-copy policy.
