# Slideshow effects, 0.6.0

The existing artwork timer is unchanged: 30 seconds, one minute, five minutes, fifteen minutes or one hour. Its previously saved value is preserved. A completed transition starts a full new artwork interval; transition duration is a separate preference.

Slideshow options are available from the artwork controls, the Slideshow tab alongside Frame/Mat/Fit/Picture, and Settings → Slideshow options → Order & effects. They use explicit D-pad button navigation; there are no native dropdowns. The two-column panel keeps Done visible on a TV.

- None: switch images after decode without animation.
- Crossfade (default): reveal the next artwork over the previous one.
- Fade through dark: fade out during the first half, fade in during the second.
- Slide: shift artwork horizontally, respecting previous/next direction.
- Transition duration: 0.5, 1 (default) or 2 seconds; unused with None.
- Artwork motion: Off (default) or Gentle pan & zoom. Motion pauses with slideshow pause, open dialogs and app hiding. It remains separate from transition effect.

Only image layers animate. The frame, mat, bevel and controls stay outside those layers. Per-artwork fit/frame/mat preferences still apply to each image. Images are decoded before starting an effect. The previous image remains visible while its replacement loads. Rapid navigation cancels stale loads/animations and retains one settled image. App exit removes animations. Reduced-motion preference suppresses transitions and pan/zoom. No external library or runtime download was added.

New persisted preferences are `transition`, `transitionDuration` and `motion`. Existing preference records inherit crossfade/one second/motion off through normalisation. Unsupported/corrupt values fall back safely without changing a valid artwork timer.

The gallery header no longer displays “Ready for your photos” or its empty status dot. Existing saved-photo counts and active connection/saving status remain.


## Pan and zoom fix, 0.6.2

Motion now uses a 24-second alternating loop, independent of the artwork timer, rather than a single 3.5-percent zoom spread across the entire interval. The scale range is 1.03 to 1.12 with a small diagonal pan. A dedicated inner `.art-motion` surface is composited with transform, leaving the frame, mat and image brightness filter outside the moving surface. Finishing a transition removes only outgoing layers; it never detaches the active moving layer. The Off setting, slideshow pause, settings pause and reduced-motion preference remain respected.


## Manual navigation and immediate motion, 0.6.4
