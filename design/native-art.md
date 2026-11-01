# Native Samsung Art Mode

SART's optional native integration is separate from its normal artwork player. It is offered only on supported Frame models when the required native services are available. It does not turn other TVs into a Frame or replace Samsung firmware.

## Data flow

1. Detect and verify the native Art service host; bind requests to that connection.
2. Export an original or optional SART-styled image, reusing a verified existing native copy when bytes and appearance match.
3. Transfer through the pinned TLS client and verify the saved native image identifier.
4. For a styled copy, confirm Samsung's extra mat is disabled before selecting it.
5. Verify selection and request native Art Mode; require acknowledgement/readback before reporting success.

Samsung's native app owns display, sensors, sleep and power settings after handoff. SART's own copy remains separate. Cancelling stale work must not affect a newer connection.

## Management

The native collection manager reads eligible personal-photo records, loads bounded authenticated previews, and keeps store content outside deletion controls. Deletion requires explicit selection/confirmation and verifies that unrelated records remain after readback. Native originals and styled exports have separate identities. Deleting a native copy does not remove its SART original.

## Limits and privacy

A detected capability does not establish successful upload or visible handoff. Test foreground behaviour and persistence on the intended platform. Device inventories, service endpoints, native image selections, personal library records and acceptance evidence stay in private local storage; public documentation contains no live device identity or network configuration.
