# Contributing to SART Gallery

Small, focused contributions are welcome. Describe the user-visible problem and preserve existing photos, settings, collections and certificate identities.

## Set up

Use Node.js 22 or newer and Python 3.11 or newer. Follow the [README](README.md#local-preview) to create `.venv`, install the locked dependencies and build the widget. The preview runs on loopback; development does not require a TV or Samsung account.

```sh
npm ci --ignore-scripts
.venv/bin/python -m pip install --require-hashes -r requirements.lock
.venv/bin/python tools/package_app.py
npm test
npm run check
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
.venv/bin/python tools/check_public_privacy.py
```

For browser layout and remote-navigation checks:

```sh
npx playwright install chromium
.venv/bin/python tools/run_browser_checks.py
```

The browser runner starts its own loopback server and temporary library. It does not use your real gallery. Set `SART_CHROME` only if you want to use an existing compatible Chromium executable.

## Interface and hardware changes

- Keep the ES2020 syntax baseline and Tizen 6.5 minimum. Check optional capabilities before showing controls.
- Every action must be reachable by remote. Check focus visibility, Back/Return, keyboard dismissal, long titles and overflowing lists.
- Verify 1920 × 1080 and 1280 × 720 layouts, including both native Art-capable and ordinary TV branches.
- Label browser simulations accurately. They do not establish Samsung keyboard behaviour, native Art integration, physical-phone transfers or real panel appearance.
- Record hardware acceptance privately. Never uninstall to test an update: independently verify saved images, preferences and certificate identity survive.

## Keep the public repository clean

Do not commit credentials, signing profiles, certificate private keys, personal photos, deployment reports, screenshots of your network, device addresses, serial numbers or DUIDs. Use reserved example addresses in documentation. Redact private data before filing issues.

`tools/public_files.py` defines the source/export boundary. CI checks tracked files against that boundary and scans public content for private material. Run `python tools/check_repository.py --tracked` from this standalone repository before pushing. Only stage files you reviewed; avoid force-adding ignored files.

## Pull requests

Explain the problem, resulting behaviour and validation. Include clean screenshots for visible changes and distinguish automated checks from hardware acceptance. Keep generated packages and personal installation files out of the PR.

Original contributions use AGPL-3.0-only, matching [LICENSE](LICENSE). Preserve third-party notices. Artwork is separately licensed: every addition needs a matching provenance record and rights evidence; see [ARTWORK-RIGHTS.md](ARTWORK-RIGHTS.md).

## Maintaining CI and distributions

CI runs logic tests, Python tests, build and licence validation, privacy checks, reproducibility checks and browser layout checks. CodeQL performs additional JavaScript and Python analysis. Actions are pinned to full commit hashes; Dependabot proposes updates. Review action changes and lockfile changes together with their upstream release notes.

When changing Python dependencies, update both `requirements.txt` and `requirements.lock`, retaining hashes for supported distributions. Verify installation on a clean supported Python version. The application has no runtime dependency on Playwright, Acorn or CI services.

Keep source access available for distributed executables. CI does not sign, deploy, upload packages, create releases or access TVs. Before distributing a build, run `tools/release.py`, inspect the archive, preserve all notices, and provide its corresponding source and required build materials. See the README for TLS source and rebuild instructions.

For the main branch, require pull requests and the passing `Checks (Node 22 / Python 3.11)`, `Checks (Node 24 / Python 3.13)`, `Browser layout`, and CodeQL checks where repository settings allow it. Do not enable automatic merging or require hardware tests to run on public CI.
