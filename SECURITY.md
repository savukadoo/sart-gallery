# Security policy

## Report a vulnerability privately

Use this repository's **Security → Report a vulnerability** option. Do not post exploitable details, keys, certificates, connection codes, personal photos or device identifiers in a public issue. If private reporting is unavailable, open a brief issue requesting a private reporting channel without disclosing the vulnerability.

Include the affected version, component, impact and a minimal reproduction using disposable data. State whether you tested a browser preview or a TV. Never test a device or network without its owner's permission.

## Supported code

Security fixes target the latest code on `main`. Older packages may not contain those fixes. A security review or passing CI is not a claim that the application is free of vulnerabilities.

## Security boundaries

- The TV approves each upload/source-management session. Session capabilities expire and listeners close when the connection ends.
- Uploads and pairing use HTTPS. Photo transfers use encrypted connections. The temporary HTTP setup page serves public trust material only.
- A manually trusted local authority changes the device's trust settings. Check its fingerprint on the TV before installing it; remove that trust when it is no longer needed. Keep authority and signing private keys private.
- Developer Mode and developer tools are separate from ordinary upload use. Do not expose development or upload ports to the internet.
- Public CI uses disposable fixtures, receives no Samsung credentials and never connects to users' TVs.

Dependency alerts, CodeQL and automated tests supplement code review. Changes involving authentication, TLS, parsing, source URLs or uploaded data need a targeted review of those boundaries.
