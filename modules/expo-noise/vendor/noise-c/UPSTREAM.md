# Noise-C upstream

This directory vendors the MIT-licensed Noise-C reference implementation from
<https://github.com/rweather/noise-c> at commit
`cfe25410979a87391bb9ac8d4d4bef64e9f268c6`.

Only the XX/25519/ChaChaPoly/SHA256 sources are linked into the application.
The cipher, DH, and hash factories are narrowed to those algorithms so the
unused implementations do not become link-time dependencies. All other
upstream files are retained unchanged except that Curve25519 DH rejects the
all-zero shared secret required by the Noise specification.
