# Direct browser uploads

**0.5.0:** The page, assets and signalling now use TV-hosted HTTPS. See [HTTPS setup and security](https.md). The historical HTTP limitation below describes 0.4.1 only.

## Use

- Open Add photos on the TV. The top-right button and Settings use the same connection screen.
- On a phone, scan the connection QR. On a computer, open the displayed HTTPS address and enter the six-digit code. First-time devices use Set up this device for the public certificate download and manual trust instructions.
- Match the code, then choose Allow device on the TV with the remote. A code never bypasses TV approval.
- Select up to 50 images, name the collection, and choose Send to TV. Both screens show progress. The browser reports success only after local IndexedDB storage commits.
- Done/Back, leaving the app, or ten minutes of inactivity closes the listening socket and peer. A fresh connection uses new secrets. Reloading the phone page requires pairing again. Only one browser may claim a session.
- The old PC companion remains under Settings → Advanced → PC companion setup for existing read-only library synchronisation. Existing PC pairing, artwork looks and user records are retained.

## Data and limits

Images travel on a reliable ordered WebRTC data channel, in 16 KiB chunks with sender backpressure, at most one photo in progress. The receiver bounds headers, chunks, dimensions and file bytes; verifies SHA-256; checks JPEG dimensions before decoding; re-encodes only pixels on the TV; creates a thumbnail; and saves within the existing 200-photo / 200 MiB budget. Photo writes are serialised with companion writes. Incomplete, cancelled or corrupt files never reach storage. A file already being committed when disconnected can finish saving. Retries within the same browser selection reuse the transfer ID and are idempotent. Uploaded collection names are escaped when displayed; each batch has a unique collection ID. HEIC support depends on the sending browser's image decoder and otherwise shows an export-as-JPEG error.

The QR contains a 192-bit random secret in its fragment. The page removes the fragment from the address bar and holds credentials in memory. PC short-code requests are limited to five per minute and also need explicit TV approval. The bounded HTTP parser rejects unknown Host values, cross-origin API requests, duplicate headers, request smuggling, oversized bodies and arbitrary paths. The server exposes no saved-photo read/list/download endpoint. Closing a session revokes access and closes its socket.

## Transport security

In 0.4.1, the local page and signalling used HTTP. WebRTC encrypts the data channel, but this does not authenticate or protect the HTTP-delivered page or signalling from an active attacker on the LAN. Matching codes and TV approval do not remove that limitation. This is not advertised as end-to-end authenticated HTTPS. No shared self-signed certificate or private key is bundled. A trusted HTTPS design remains separate work for public-release readiness; self-signed certificates alone cause browser trust warnings.

## Mobile interaction

## Evidence

## Upload destinations and duplicate detection · 0.17.0

The shared PC/phone HTTPS page offers existing collections and New collection. My photos is the default. Names/IDs come from a bounded `GET /api/collections` response only after token/client matching, TV approval and an established connection; no photos or account information are included. The list can be refreshed and a newly created collection becomes the selected existing destination for the next batch. Existing IDs must still exist when the TV saves; its canonical name is used instead of a client-supplied rename. New IDs retain the mobile UUID namespace. Legacy new-collection metadata remains supported.

The TV serializes upload saves with photo writes and checks the current effective collection, including moved-image overrides. A normalized matching title or identical transfer/display hash returns an existing-image acknowledgement without writing or overwriting a photo. Same-name/different-content conflicts explain that the file should be renamed. The same image can be saved in a different collection. Added and already-present counts are separate on the page and TV. This prevents new duplicates; it does not merge or remove older copies.

A started batch retains its collection and transfer IDs through cancellation/failure. Retry skips confirmed files and sends the rest to the same destination; Clear allows choosing another destination. This avoids mixed collections and duplicate saves after a lost acknowledgement. The iOS picker still explicitly blurs text editing before opening the chooser.


## Consistent collection picker and TV receipts · 0.17.1

The shared upload page uses a styled HTML listbox instead of the browser-native collection menu. It retains existing/new collection choices and the same secure collection endpoint, with a 48 px minimum target, a selected checkmark, scrollable bounded lists and wrapping option names. Keyboard input supports arrows, Home/End, type-ahead and Enter/Space; Escape dismisses without changing the collection, Tab leaves the control and outside interaction dismisses it. The menu chooses above/below placement based on available viewport space. No UI library or runtime dependency is added.

After durable storage or a verified duplicate match, the TV Add photos screen keeps a latest-upload receipt with the stored image title and canonical collection name. Effective collection membership is used for moved images; duplicates say Already in collection. The receipt stays visible while the next photo transfers and resets with a new connection. The connected view omits its decorative status circle to keep long names and Finish & disconnect within the fixed popup.
