Throwaway keys made for tests. They sign nothing real; never trust these certificates.

Regenerate with `bash scripts/make-digital-id-fixtures.sh` (OpenSSL 3.x;
the PBMAC1 sample additionally needs 3.4+). Random keys and salts change on
each run. Certificates are valid from 2025-01-01 through 2045-01-01, except
`expired.pem` (2020–2021). The chain is leaf → issuer → CA.

Passwords are `wren`, except `rsa-empty-password.p12` (empty) and
`rsa-unicode*.p12` (`wrénøß`). `certs-only.p12` has no key; `rsa-aes192.p12`
uses an intentionally unsupported cipher. Other names describe their PBE,
MAC or key. AES-128 uses OpenSSL's SHA-256 PBKDF2 PRF; a SHA-1 default PRF
is exercised in the unit tests. `rsa-legacy.p12` and `p256-legacy.p12` have
RC2-40 certificate bags and 3DES keys. `rsa-2des-rc2128.p12` covers their
two-key 3DES and RC2-128 relatives. `rsa-plainkey.p12` exercises keyBag.
`self-signed.p12` has no CA. No production exporter files are included yet.

The generator verifies every export with OpenSSL and prints its algorithms.
Mismatched IDs and malformed structures are constructed in unit tests:
OpenSSL deliberately refuses to export a mismatched key and certificate.
