# TV-hosted HTTPS and certificate setup, 0.7.0

The upload page, static assets, code/QR pairing and SDP exchange are served by the TV at `https://TV-IP:8768/`. Photos continue over a direct encrypted WebRTC data channel. The computer is needed for initial certificate issuance and later renewal, not for ordinary uploads. There is no cloud, STUN, TURN, runtime CDN or HTTP upload fallback. The temporary listener closes when the connection dialog closes, the app pauses or its ten-minute idle session expires.

**Add photos** now opens one connection screen from the top-right button or Settings. It shows the connection QR, HTTPS address and six-digit code together. **Set up this device** opens a separate public-certificate download page at `http://TV-IP:8769/`. This HTTP listener exists only during setup/certificate details and exposes exactly the page, CSS, public root certificate and certificate-only Apple profile. It rejects POST and all upload/API routes. Returning to the connection screen, approval, closing, hiding the app or expiry closes it. The HTTPS connection has no plaintext fallback.

HTTP bootstrap is not authenticated delivery. Users must compare the downloaded certificate fingerprint with **Certificate details** on the TV before trusting it. Safari may show its HTTP warning; no code bypasses browser warnings. Installation and SSL/TLS trust remain manual. A trusted public onboarding service remains a possible future alternative, not part of this local implementation.

## Identity and manual trust

`mobile-identity.mjs` generates a unique P-256 leaf key on the TV. It directly wraps PKCS#8 with AES-GCM using a non-extractable AES CryptoKey and a random 96-bit IV. IndexedDB stores that CryptoKey and the encrypted envelope; a persistence read/unwrap check must succeed. Only the public SPKI and an identity UUID leave the TV. The worker unwraps the leaf key into memory for Mbed TLS, clears temporary DER buffers, and destroys the TLS instance on close. This is app-origin WebCrypto protection; hardware-backed storage and Samsung security approval are not claimed.

`tools/https_certificate.py` keeps the private per-TV authority under `.local/https/<UUID>/authority-private.key` on the Mac, mode 0600 inside a mode 0700 folder. It issues a 397-day server certificate with the TV IPv4 address in SAN, serverAuth EKU, CA=false and digitalSignature key usage. The ten-year root has path length zero and an IP name constraint for that TV address only. The public signed leaf and public root are provisioned back to the TV. The root key never enters the TV or widget/source archive. Keep the Mac's private `.local` folder backed up securely for renewals.

The user explicitly chose manual device trust. `dist/TV-certificate/` contains the public root `.cer`/`.pem`, a certificate-only iPhone/iPad `.mobileconfig`, its SHA-256 fingerprint and `setup.html`. No code changes operating-system trust or bypasses a browser warning. The profile contains no MDM, VPN, accounts or private keys. A phone or PC must trust the public root manually before using the QR/URL. iPhone profile installation alone is insufficient: enable SSL/TLS trust under Settings → General → About → Certificate Trust Settings, per [Apple](https://support.apple.com/en-au/102390). Mac trust is controlled in [Keychain Access](https://support.apple.com/en-au/guide/keychain-access/kyca11871/mac).

At expiry, an invalid TV clock, missing identity, changed IP, failed CryptoKey persistence or TLS load failure, startup fails closed with a setup/renewal message. It never generates an unrelated identity silently. Reserve the TV's address in the router if desired. An IP change requires a new constrained authority and repeating manual trust; use a new explicit `--directory` when issuing it. For normal renewal at the same IP, re-run public-key issuance/provisioning with the existing identity and authority. Uninstalling/resetting the TV app removes its private key and requires setup again.

## TLS and bounds

The locally bundled `tls.wasm` uses Mbed TLS 3.6.7 with TLS 1.2 only and `TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256`. Entropy comes only from worker WebCrypto `getRandomValues`; failure aborts. TLS 1.0/1.1, RSA transport, CBC, client renegotiation, session tickets and plaintext are not enabled. Clients authenticate the TV with its certificate; existing code/QR pairing and explicit TV approval authorise the uploading device.

The C adapter has eight connection slots, bounded 64 KiB input/output memory BIO queues per slot, 16 KiB records and a 32 MiB WASM memory ceiling. The JS adapter handles socket EAGAIN, fragmented TLS records, partial writes, clean shutdown and twelve-second connection deadlines. Strict HTTP framing, Host/HTTPS Origin checking, CSRF restrictions, API bearer/client binding, five code attempts/minute and ten-minute session expiry remain in place. The TLS endpoint provides no saved-photo listing/read route and no plaintext route. The separate public setup listener has at most two clients, 8 KiB request bounds and eight-second deadlines; it never exposes the pairing token, private key or uploaded artwork.

Old PC library records/photos are preserved. The TV rejects HTTP library origins before a request sends their token. The optional Python companion accepts `--tls-cert` and `--tls-key`, minimum TLS 1.2, for a certificate already trusted by its TV client; this separate legacy path has not been commissioned with a TV trust store. In default HTTP mode its management/preview remains available on loopback, and all non-loopback requests are rejected before token or library access. Direct PC uploads use the same TV-hosted HTTPS/WebRTC flow as mobile.

## Rebuild and provenance

Official archives, verified before extraction:

- [Mbed TLS 3.6.7](https://github.com/Mbed-TLS/mbedtls/releases/download/mbedtls-3.6.7/mbedtls-3.6.7.tar.bz2), SHA-256 `a7e8bcbec0e6f761b4af24f25677626b35f762f68eef79c08677a363212d11f6`.
- [WASI SDK 34 ARM Mac](https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-34/wasi-sdk-34.0-arm64-macos.tar.gz), SHA-256 `9c59398106b417f8f14913380fdf0097a8cc0ff4af9eb3ce0065a859e88d49e9`.

Extract under `.local/tls-build/mbedtls` and `.local/tls-build/wasi`, then run `python3 tools/build_tls.py`. Config/adapter source is in `tools/tls/`. Archive locations can be supplied as flags. Four compiler jobs are used. The WASM imports only `sart.random`. Mbed TLS is used under Apache-2.0; its full license and provenance/hash are bundled. The resulting WASM is about 97 kB before package compression. Samsung's old Intel-only Emscripten binary is not needed on this ARM Mac; Samsung's socket engine backend remains the existing dedicated-worker transport.

After normal signing/install, start `tools/tv_inspector.py`, run `tools/tv_https_setup.mjs`, then stop the inspector. This SDK step provisions public certificate material and prepares public trust files; it does not install trust on any client. For an existing commissioned TV, `tools/tv_trust_download.mjs` copies only its existing public root into the app for download. Its SHA-256 must match the stored authority fingerprint; the identity and private key stay unchanged. Never publish `.local` or its authority private key.

## Verification and limits

## 0.18.0 authority hardening
