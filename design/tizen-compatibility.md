# Tizen compatibility

SART uses one Tizen web widget with a Tizen 6.5 minimum and ES2020 JavaScript baseline. Syntax and packaging checks enforce that baseline. Runtime feature detection decides which optional capabilities to expose; platform version alone is not proof of availability.

## Platform differences

Older TV browsers need compatibility helpers for request cancellation, object-property checks and secure identity generation. Standard Samsung Web APIs are loaded when needed, including when a partial namespace is already present. TLS WebAssembly builds disable instructions unavailable to older engines. CSP permits only the plugin types required by the older socket transport.

## Native Art

The app offers native Samsung Art Mode only after its supported-model and capability checks pass. Unsupported TVs retain SART's own artwork display. Native operations must verify the selected host and peer, then confirm storage/selection changes through readback. See [native Art design](native-art.md).

## Installation and acceptance

Installation tools require an explicit target address or private local developer configuration and verify the selected model before access. A valid Samsung author/distributor profile is needed for the target TV. Retain the author identity across updates. Discovery logs, DUIDs, addresses, certificates and hardware acceptance reports are private local records.

Test remote navigation, text entry and IME exit, modal bounds, saved looks, slideshow timing/motion, uploads and persistence on each supported engine. Inspect image/blob and settings readback independently after an update. Automated/source checks are separate from physical hardware acceptance.
