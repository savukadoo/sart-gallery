# Validation and delivery

Resolve commands against the SART checkout. Choose checks for the affected behaviour; do not rerun unrelated hardware tests merely because the skill lists them.

## Local build and regression checks

Use the supported Python/Node versions and locked dependencies from `README.md`. Prepare the official Samsung CA prerequisite with `tools/samsung_ca.py`; a valid cache supports offline builds. For network-restricted setup, use its documented `--archive` option. Do not copy retained vendor certificates into place to bypass acquisition or integrity checks.

The usual checks are:

```sh
.venv/bin/python -B tools/package_app.py
npm test
npm run check
.venv/bin/python -B -m unittest discover -s tests -p 'test_*.py'
.venv/bin/python -B tools/check_reproducible.py
.venv/bin/python -B tools/check_repository.py --tracked
```

Use a focused suite first when investigating a failure. Some TLS/callback tests need loopback sockets; a sandbox refusing a listener is an environment failure, not evidence that the implementation failed. Request only the execution access needed for the authorized test and do not weaken transport checks.

Relevant test entrypoints include:

| Change | Useful checks |
| --- | --- |
| Upload transport, setup or identity | `tests/mobile.test.mjs`, `tests/mobile-server.test.mjs`, `tests/mobile-setup.test.mjs`, `tests/test_security.py` |
| Native Art or styled export | `tests/native-art.test.mjs`, `tests/native-art-library.test.mjs`, `tests/native-art-tls.test.mjs`, `tests/native-composition.test.mjs`, `tests/native-composition-browser.mjs` |
| Collections, moves or removals | `tests/collections.test.mjs`, `tests/uploads.test.mjs`, `tests/collection-move-browser.mjs`, `tests/uploads-manager-browser.mjs` |
| Find art, sources or batch save | `tests/find-art.test.mjs`, `tests/find-art-sources.test.mjs`, `tests/find-art-batch.test.mjs`, `tests/test_artvee_preview.py`, source-manager browser scripts |
| Slideshow motion | `tests/slideshow-motion.test.mjs`, visible playing-slideshow checks |
| Signing, CA preparation or sign-in | `tests/test_samsung_ca.py`, `tests/test_samsung_login.py`, `tests/test_tv_development.py` |
| Public export or privacy rules | `tests/test_public_privacy.py`, `tools/check_repository.py --tracked`, inspection of staged files and source-bundle contents |

Browser scripts have their own fixture/setup requirements. Read the chosen script and existing runners instead of assuming every script is covered by `npm test` or invoking a live-TV script as a browser fixture.

## Visual and remote acceptance

`tools/run_browser_checks.py` starts an isolated loopback server/library for the main layout suite. Follow `CONTRIBUTING.md` for installing its browser or using an existing compatible Chromium executable. Use disposable data for other browser fixtures as well.

Inspect the affected flow at 1920 × 1080 and 1280 × 720, with and without native Art capability where applicable. Include:

- D-pad focus into, across and out of a dialog; Done, Cancel and Back; restoration to a sensible control.
- Long titles/names and enough collections/images to exercise scrolling. Return from the last row to the header.
- Consistent dialog geometry, visible focus rings and controls remaining within safe insets.
- Find art opening without unsolicited keyboard capture. With a system keyboard open, check that search/cancel remain visible and that editing can be exited.
- Saved-state readback after a move, removal, retry, appearance change or update.

Browser screenshots and fixture flags establish browser behaviour only. Native Samsung IME, physical phone pickers, foreground playback, panel appearance and native Art handoff require the corresponding real device. State an unavailable acceptance path explicitly rather than treating simulated success as hardware acceptance.

## Authorized TV testing

Use only the target and access authorized for the current task. Obtain addresses and signing profiles from operator input or private local configuration, never from this skill. Use the current `tools/tv.py` and inspector interface; preserve its exact model/identity checks and Samsung author identity.

Before an update, capture private counts and state digests for saved images, collections, preferences and HTTPS identity. Install over the existing app and compare those values afterwards. Do not publish the underlying library or identifiers. A successful installation, a running process, foreground visibility and observed feature behaviour are separate findings.

For destructive test coverage, use a clearly identified synthetic item and verify unrelated items remain. For native Art, verify upload, thumbnail, selected image and mode state as separate operations. Clean up that test's own fixtures and temporary inspector/listeners, and leave the user's app/data in the requested state. Stop when identity, certificate or state readback is inconsistent.

## Publication and skill maintenance

When publication is authorized, inspect the exact staged/committed files and the selected remote. Use the standalone SART repository; do not include surrounding workspace history or other projects. Do not introduce account-wide authentication when repository-scoped access is the established requirement. Clear temporary private authentication material when its work is complete.

Run the public-boundary/privacy check and inspect source archives if producing them. `tools/public_files.py` defines what is exported, including this skill. Keep downloaded caches, profiles, private diagnostics, personal photos and hardware scripts outside that boundary. A normal deletion commit does not erase older history; do not rewrite published history without explicit authorization and a concrete plan.

The current repository checker scans working-tree content and checks indexed paths. It does not scan the indexed or committed blob contents. Review `git diff --cached --name-status` and `git diff --cached --check`; inspect staged bytes with commands such as `git show :README.md` and committed bytes with `git show HEAD:README.md`. For a complete committed-tree audit, inspect an isolated clean checkout of the exact commit and supplement the content scan with configured private identifiers kept only in private local records. Use NUL-delimited Git path lists (`git ls-tree -r --name-only -z HEAD`) so accented filenames are not misread. Check commit author/committer metadata as well as files.

Preserve software notices, artwork provenance and the distinction between public certificates and private keys. A privacy pass does not establish third-party redistribution permission. Read the current `NOTICE` and prerequisite policy rather than assuming a certificate is AGPL/MIT because a helper is.

After a push, verify the remote SHA and wait for the relevant CI/CodeQL jobs. Passing CodeQL execution does not mean every code-scanning alert has been assessed. CI is not a Samsung store certification or hardware-acceptance result.

The skill's instructions, references, metadata and examples must remain free of personal/device information. Resolve links, validate the skill structure with the skill-authoring tools available in the maintenance environment, and forward-test substantial changes on a realistic read-only task. Keep evaluation artifacts private and outside source exports. Report actual checks and remaining limits concisely.
