Throwaway keys made for tests. They sign nothing real; never trust these certificates.

`node scripts/make-digital-id-pdf-fixtures.mjs --mixed` regenerates only
`mixed-certified.pdf`. Its independent OpenSSL signature certifies with
DocMDP P=2. The first page has a rotated CropBox with a non-zero origin
and an empty `Prepared` signature widget. AcroForm, Fields and Annots
are indirect objects stored in an object stream; two further pages share
an empty Annots array. Tests emit `mixed-existing` and `mixed-shared`
signed outputs, required by both independent CI verification scripts.

`bash scripts/make-digital-id-long-issuer.sh` generates `long-issuer.p12`
and its throwaway root. Its issuer has 80 organisational units; CMS repeats
that Name in both the signer identifier and the signing-certificate attribute.
This checks reservation against the actual encoding instead of a chain-size
estimate. It has a two-certificate chain and uses the existing test RSA key.

`node scripts/make-digital-id-shadow-fixtures.mjs` generates the two
`shadow-*.pdf` attack samples. Their xref selects a page saying PAY 100,
but an unindexed later page definition says PAY 99999. The signed variant
has a real independent OpenSSL CMS signature over its unchanged original
revision, followed by the unindexed shadow page. Its first signature still
verifies mathematically. Both files must be refused before signing. The
generator needs OpenSSL on PATH as well as Node.

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

`node scripts/make-digital-id-pdf-fixtures.mjs` regenerates `signed-once.pdf`
and `certified-nochanges.pdf` using OpenSSL CMS signatures, independently of
the signing library. The main generator also runs it (Node and the existing
pdf-lib dependency are needed). Both have classic xref tables. PDF tests
generate xref streams and rotated pages in memory.

The checked-in `linearized-stream.pdf`, `linearized-table.pdf`, and
`linearized-multi.pdf` were made with the official qpdf 12.4.2 MSVC64
portable Windows release. The first two share a one-page pdf-lib input;
the third has three pages. All pages are blank, 600 by 800 points. These
are real Annex F files, with a linearization dictionary, hint stream,
first-page xref and forward Prev to the main xref. The stream fixtures
use FlateDecode with PNG Up prediction (`Predictor 12`, `W [1 2 0]`),
unlike the unfiltered synthetic xref fixtures in the tests.

To regenerate, set `QPDF` to the absolute path of a separately downloaded
qpdf executable and `SCRATCH` to an existing directory outside the repo.
The following commands use a Bash shell:

```sh
export SCRATCH
node --input-type=module <<'JS'
import { PDFDocument } from '@cantoo/pdf-lib';
import { writeFileSync } from 'node:fs';
const doc = await PDFDocument.create();
doc.addPage([600, 800]);
writeFileSync(`${process.env.SCRATCH}/before-linearize.pdf`, await doc.save());
doc.addPage([600, 800]);
doc.addPage([600, 800]);
writeFileSync(`${process.env.SCRATCH}/multi.pdf`, await doc.save());
JS
"$QPDF" --linearize "$SCRATCH/before-linearize.pdf" fixtures/digital-id/linearized-stream.pdf
"$QPDF" --linearize --object-streams=disable "$SCRATCH/before-linearize.pdf" fixtures/digital-id/linearized-table.pdf
"$QPDF" --linearize "$SCRATCH/multi.pdf" fixtures/digital-id/linearized-multi.pdf
PAPERWREN_SIGN_OUT="$SCRATCH/signed" npx vitest run src/lib/__tests__/pades.test.ts -t 'accepts real qpdf stream output'
cp "$SCRATCH/signed/once-linearized-stream.pdf" fixtures/digital-id/linearized-signed.pdf
```

`linearized-signed.pdf` is the stream fixture signed once by this library
with `rsa-aes256.p12`, signer name `Test`, and time 2026-11-14T00:00:00Z.
It is about 19 KB because the signature reserves 8192 bytes of CMS space.
Appending makes the original linearization hints stale, as Annex F allows;
the original bytes and first signature remain intact. The static tests
need no qpdf and verify every signature with WebCrypto, preserve each
prefix and Prev, and reopen each signed revision in pdf-lib and pdf.js.

The stage A library has no canvas or font renderer. Optional text captions
use the standard PDF font's WinAnsi characters; other scripts must be drawn
into the supplied appearance PNG by the caller. A non-WinAnsi `caption`
returns `unsupported`. This is a deliberate limit of this library-only stage.
