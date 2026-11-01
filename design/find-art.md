# Find art

## Manage sources · 0.20.0

**Find art → Manage sources** and **Settings → Find art → Manage sources** share one panel. Included NGA, Artvee and Met sources can be enabled/disabled and chosen as the default. All sources may be disabled; Find art then disables text/search controls and offers Manage sources. Four sources per page keep entire rows visible on both 1920 × 1080 and 1280 × 720 layouts. More than three enabled sources use a compact paged chooser on Find art rather than a growing row of buttons.

Custom sources in this release are **Wikimedia Commons image categories**, entered as a category name or an HTTPS Commons category URL. Users give the source a name and run Test source before Save becomes available. The test checks category information, up to 24 indexed image records across bounded search pages, explicit PD/CC0 metadata, an allowed preview URL and a bounded JPEG response. Parent categories containing no direct images report a useful error; automatic traversal into subcategories is not included. Arbitrary websites, generic feeds, external plug-in code and API keys are not implemented in this phase.

The existing HTTPS/WebRTC-approved phone/PC connection exposes an **Art sources** tab alongside Photos. It operates the same TV registry; the browser does not proxy public artwork. The TV approval prompt explicitly names adding photos and managing Find art sources for that connection. Source requests require the exact claimed client after TV approval and connection. Testing is cancellable, capped at 20 seconds, and retains the existing fixed HTTPS provider hosts, credential omission, response budgets, image limits and rights checks. Only the test HTTP response gets a 32-second socket budget (30-second browser deadline); normal requests keep their existing 12-second budget. No new listener, third-party service, executable source descriptor, runtime library or permissive image-host rule is added.

`findArtSourcesV1` is a small settings record: version, revision, default source ID and at most 12 entries (three included plus nine custom). No schema migration or startup write is required. Every mutation uses a single IndexedDB read-modify-write transaction with an expected revision and AbortSignal guard. Concurrent edits fail with Refresh guidance. A successful test issues a five-minute, single-use save ticket for its exact normalized draft and originating approved session. Closing that session or the TV screen aborts pending work; a cancelled test grants no save ticket.

Custom Commons results retain the canonical `museum-nga-<Commons page ID>` image identity used by the older NGA adapter, while their provider is Commons and their chosen source label is saved separately. This prevents a work already saved through NGA from being downloaded again merely because it appears in another category. Old image IDs, collection assignments, looks, favourites, native export mappings and certificate identities are not rewritten. Disabled/deleted-source searches are hidden from the recent-search controls without rewriting the stored five-query history; downloaded images retain provenance and remain available offline.

UI review applied the Apple design skill's web-appropriate principles: visible field labels (`text-fields.md › Best practices`), explicit activation after focus (`focus-and-selection.md › Focus and selection`), and adapting to available display size (`layout.md`). Existing SART dark/cream/gold tokens, rounded focus rings and 48 px browser controls are retained. This is design guidance, not a claim of Samsung certification.

Primary protocol references: [MediaWiki Categoryinfo](https://www.mediawiki.org/wiki/API:Categoryinfo), [Imageinfo](https://www.mediawiki.org/wiki/API:Imageinfo), and [cross-site requests](https://www.mediawiki.org/wiki/API:Cross-site_requests).

## Historical Find art behaviour

SART Gallery 0.15.1 searches National Gallery of Art, Artvee and the Met. Cleveland is removed from the search-source choices. Existing saved artwork and the 60 licensed offline artworks stay available.

## Search and remote navigation

The collection home opens collections through their thumbnail; the duplicate View collection button is removed. Thumbnail/chevron Up navigation leads to the header. The left footer slogan and saved-photo count are removed; remote hints remain on the right. Collection contents use a bounded artwork scroller with explicit row/column focus links, keeping the header and footer anchored. Returning to row one restores zero scroll. The collection preview uses equal top/bottom gaps and symmetric padding/shadow, retaining contain-fit without cropping.

## Download several images

Choose **Select images** above the result grid. OK toggles a checkmark; **Select page** marks eligible images on this page and **Clear** clears the selection. Up to **50 images** can be selected across pages, searches and sources. Already saved results are labelled Saved and excluded from batch downloads. Selection updates change only the toolbar/checkmarks; result images are not reloaded. Back or Cancel leaves selection mode without changing saved artwork.

Choose **Add selected (N)**, choose one existing collection or name one new collection, then **Download N images**. One full image is fetched, decoded and durably stored at a time. Progress shows the current image and saved count. **Stop** or Back cancels the active request and remaining queue; completed saves remain. A transaction that commits while Stop arrives is still counted as saved.

Failed/unattempted records remain selected for retry. Successful/existing records leave the pending selection, preventing duplicate downloads. Storage-full failures stop the queue before requesting more images. Selection and unfinished queues are session-local; saved images persist across app restarts.

## Display downloaded artwork

After a single save or move completes, **Display now** receives the first remote focus beside **Keep browsing**. It opens the durable local copy immediately. An already-saved search result also offers Display now without another download.

A completed batch offers the same action. It starts with the first saved image; previous/next and optional slideshow stay within that saved batch, in download order. Stopped or partially failed batches offer only committed/existing copies. If nothing saved, Display now is absent. Unfinished selections remain available for retry. **Back / Find art** returns to the same query, page, provider and results instead of making the user locate the image in its collection. The viewing queue is temporary; collection membership, saved appearance and slideshow preferences are unchanged.

## Remove images

Open an image, press **OK** to reveal artwork controls, choose **Remove**, then **Remove from SART App**. Uploaded/downloaded copies are deleted from local storage; originals at their sources are unchanged. Included artwork is hidden through the bounded `hiddenArtworkV1` setting, without changing packaged assets. It stays hidden after reload and leaves collection counts, playback and favourites views. Favourite IDs and saved appearance are retained for restoration.

**Settings → Restore included artwork (N)** restores hidden included images after confirmation. Imported photos, downloaded art, companion exclusions, favourites and appearance remain unchanged. Empty included collections have a safe placeholder and remain navigable, including when all 60 included images are hidden. No IndexedDB schema migration is required.

## Sources and rights

| Source | Access | Per-image eligibility |
| --- | --- | --- |
| **National Gallery of Art** | Wikimedia's supported [Imageinfo/Search API](https://www.mediawiki.org/wiki/API:Imageinfo), scoped to `Images from the National Gallery of Art`, matching the Mac app's approach. NGA [welcomes reuse of its Wikimedia collection](https://github.com/NationalGalleryOfArt/opendata). | JPEG with bounded thumbnail dimensions and explicit CC0 or Public Domain metadata. CC0 licence URLs are checked against Creative Commons; Public Domain also requires an explicit non-copyrighted flag. Credit identifies NGA and retains the Commons record URL. |
| **Artvee** | A bounded reader of public search and artwork pages, using the public eight-result paging parameter. This is **not a documented or guaranteed API**; a site-layout change can require an adapter update. No page scripts, frames, cookies, accounts or paid downloads are loaded. | The matching public artwork record must declare public-domain reuse and provide a free **Standard JPEG** within the size/dimension budget. Rights are recorded as `Public domain (Artvee)`, not CC0. The Standard link is resolved again at save time because links expire. See [Artvee's terms](https://artvee.com/terms-of-service/) and [Standard download example](https://artvee.com/dl/woman-with-a-parasol-madame-monet-and-her-son/). |
| **The Met** | Its key-free [Collection API](https://metmuseum.github.io/), paginated search and bounded object lookups. | `isPublicDomain: true` and an allowed image URL. Rights remain `CC0 1.0`. |

Provider name/ID, title, artist, date, source URL and declared rights are retained with each saved display copy. Copyrighted, unconfirmed, malformed and unsupported records are excluded. A page can contain no eligible images despite search matches; next page and a different query remain available. Pixabay remains deferred.

## Runtime and storage budget

- No new runtime library, API key, font, cloud backend or image catalogue bundled in the app. No requests at launch or when merely opening Find art. The 0.12.1 search update added approximately 3 KB compressed; 0.13.0 batch/removal adds another 3,929 bytes.
- At most eight previews/page. NGA needs one metadata request; Artvee and the Met need one search plus at most eight details, at most two details concurrently.
- Four metadata pages cached in memory for ten minutes. No polling or bulk artwork downloads. Only the selected larger image is fetched for saving. Artvee uses the site's small `ft` previews and free Standard image; Pro maximum-resolution images are not requested.
- Metadata/HTML cap: 512 KiB per response. Selected JPEG cap: 12 MiB, enforced while streaming. Before decoder allocation: at most 16 million pixels and 8192 px per axis. NGA originals exceeding that budget use the API's smaller image; download/decode failure can fall back to the preview.
- Display copies are re-encoded without source EXIF to a maximum 1920 px long edge plus a thumbnail, sharing the existing **200 images / 200 MiB** import budget.
- HTTPS only, exact source host allowlists, bounded known Artvee paths, no credentials/referrers, redirects rejected, search/download deadlines and cancellation on leaving/hiding the feature. Page markup is parsed only for known text/attributes and is never inserted or executed.
- Stable `museum-<provider>-<id>` IDs prevent duplicates. No IndexedDB schema migration; existing mobile/bundled collection IDs, saved Cleveland copies, preferences, favourites and HTTPS identities are unchanged.

## Local preview and privacy

Packaged TVs request all sources directly. They do not require the PC companion for Find art. Artvee's pages lack browser CORS headers, so the existing **loopback-only local preview** uses a narrowly scoped relay for Artvee's public search/detail/Standard/thumbnail addresses. It validates HTTPS hosts and paths, blocks redirects and oversized responses, omits credentials, returns remote HTML only as plain text, and is inaccessible to LAN clients or untrusted browser origins. It adds no TV-side service or privilege.

Search needs Internet access; saved copies work offline. Explicit searches send the term and normal request information to the selected source (Wikimedia for NGA). Recent queries remain local. SART adds no analytics or background search traffic.

The 0.14.1 patch QA (private test evidence) records 19 focused Display now checks on each TV: single save, existing copy, move, remote focus/bounds, Keep browsing, direct image decoding, return to the same results, batch order/wrap, stopped-batch display with pending selections intact, and no Display action after a verified zero-save failure. Original data/identity readbacks matched and disposable copies were removed. All 76 JavaScript and 18 Python tests and the Tizen 6.5/ES2020 package checks passed. Only bundle.js, config.xml and runtime-config.js differ from 0.14.0; artwork and CSS are unchanged. The unsigned widget increases by 419 compressed bytes. The broader transport/native/lifecycle matrix below was not repeated for this patch.

Implementation: `app/find-art.mjs`, `app/main.mjs`, `app/styles.css`, the optional preview route in `companion/server.py`; tests in `tests/find-art.test.mjs`, `tests/find-art-batch.test.mjs` and `tests/test_artvee_preview.py`.

## Move an image between collections

Version 0.15.1 adds **Move to collection** to the artwork controls for included art, museum downloads and uploads. The custom remote-friendly picker excludes the current collection, supports My photos and New collection, and returns from an expanded list before closing the dialog. A blank new name stays in the field; Samsung IME Done returns to Move. Cancel writes nothing. A failed settings transaction keeps the image in its source and offers retry.

Collection assignments live in the small `photoCollectionsV1` settings record and are overlaid on stored photos and the included catalogue at reload. Image IDs, JPEGs/thumbnails, provenance, favourites, looks and native export mappings are unchanged. Imported photo records are not rewritten, so PC sync cannot undo a move when source bytes change. Existing saved Find art moves use the same assignment layer. Hidden included art retains its assignment for restoration. Empty personal collections disappear; the four built-in collection IDs remain available. The displayed image stays open; Back returns to its destination from Collections, while Favourites and Find art retain their return context.

## Manage uploads in Settings

Version 0.16.0 places **Manage uploads** beside the saved-photo count in Your photo library. Its scope matches that count: uploaded photos, legacy companion photos and downloaded art; bundled images and Samsung’s native My Photos library are excluded. Six thumbnails load per page. Selection persists between pages, with Select all, Clear, Move selected, Remove selected, Remove all uploads and Refresh. Each thumbnail shows its collection.

Bulk moves reuse `photoCollectionsV1`, support a new named collection, and retain image bytes, IDs, provenance, favourites, looks and native-copy mappings. `updateSavedPhotos` serializes with photo writes and reads the current stored records/settings in one IndexedDB read/write transaction. A stale ID fails the entire operation. A failed mid-batch write rolls back every deletion and settings change. Removal clears selected collection assignments and a selected last-photo pointer; removed legacy companion IDs enter `ignored` so sync cannot silently restore them. Mobile/museum removals do not create unrelated ignored settings. Favourite/look/native-export records stay available for a future restored copy with the same identity.

Both removal paths name SART App, show an exact captured count and default to **Keep images**. Originals on other devices, bundled artwork and Samsung Art Mode copies stay available. Removal applies only to the confirmed IDs; a new image arriving after the confirmation is not implicitly included. Closing restores focus to Manage uploads and the Settings count updates after committed changes.
