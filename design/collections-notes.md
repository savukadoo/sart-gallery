# Included collections — SART Gallery 0.14.0

Four offline collections contain exactly 15 artworks each (60 bundled works). Light & Water is unchanged. This refresh replaces 29 works and retains 31; retained IDs, source images and thumbnails are byte-identical to 0.13.0. Collection IDs remain stable, including `japan-print` for the renamed Japan & China collection. Existing imported/downloaded photos are retained separately and can increase the visible collection count beyond 15.

| Collection | Selection | Refresh |
| --- | --- | --- |
| Light & Water | Impressionist and Post-Impressionist paintings by Monet, Seurat, Pissarro, Sisley, Renoir, Caillebotte and Van Gogh | All 15 unchanged |
| Japan & China | Eight Japanese woodblock prints by Hokusai/Hiroshige and seven Chinese ink/colour paintings: mountain and river landscapes, birds and flowers | Seven Chinese works replace seven Japanese prints |
| Botanical Cabinet | Flowers, ferns, foliage, fruit and insects; botanical plates, nature printing, Anna Atkins cyanotype and Sutcliffe photography | Eleven replacements broaden subject, artist, technique and palette |
| Shape & Colour | Mature geometric and expressive abstraction by Kandinsky, Mondrian, van Doesburg, Malevich, Klee, Delaunay and El Lissitzky | Eleven replacements favour clear geometry and substantial compositions over figurative landscapes and faint sketches |

Selection was visually reviewed in three 15-work contact sheets. Chinese album leaves were chosen over very narrow handscrolls or tiny double-page reproductions. Images retain their original proportions and borders: no stretching, creative alterations or baked-in crops. Source reproductions have long edges of 1,676–1,920 pixels; thumbnails fit within 640 × 480. The existing Fit/Fill and frame/mat controls continue to determine presentation.

Art Institute of Chicago records explicitly mark selected works `is_public_domain: true`; Cleveland Museum of Art records mark them `share_license_status: CC0`. Eleven Shape & Colour images use Artvee’s public-domain free Standard downloads, under its reuse terms; these are recorded as Public domain (Artvee), not CC0. Full catalogue titles, artists, dates, countries where relevant, source links, rights/policy links, image identifiers, dimensions and SHA-256 hashes are bundled in `app/assets/provenance.json`. Fresh selected museum records and stable Artvee metadata are in `artwork-research/`; membership and display titles are in `collections-curation.json`. The Artvee helper resolves only free Standard images, using the existing bounded downloader; it adds no TV runtime dependency.

The 60 display images and 60 thumbnails total 41,882,927 bytes. The unsigned widget is 42,438,584 bytes; the signed widget is 42,465,805 bytes. Replaced JPEGs are retired to a private build cache and removed from generated widget assets, so there are exactly 120 current JPEGs in the TV package. Original downloads, signing credentials and private QA state stay outside the widget and development archive. No internet connection is needed to browse or display the bundled art.

Playback, slideshow timing, uploads, Find art, imported photos and appearance settings are unchanged. Removed-default IDs are never reassigned to new art; dormant favourite/look/hide entries remain intact instead of being remapped. The four original Light & Water sample IDs remain available.
