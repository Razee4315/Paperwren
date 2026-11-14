#!/usr/bin/env bash
# A real, deliberately long issuer Name exercises repeated CMS issuer fields.
set -eu
export MSYS_NO_PATHCONV=1
root=$(cd "$(dirname "$0")/.." && pwd)
out="$root/fixtures/digital-id"
tmp=$(mktemp -d "$out/.long-XXXXXX")
trap 'rm -f "$tmp"/*; rmdir "$tmp"' EXIT
if command -v cygpath >/dev/null 2>&1; then out=$(cygpath -m "$out"); fi
cd "$tmp"
subject='/CN=Long Issuer Test'
for n in {1..80}; do subject="$subject/OU=Paperwren long issuer department for reservation testing $n"; done
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out root.key
openssl req -new -x509 -key root.key -out root.pem -days 7300 -subj "$subject" \
  -addext basicConstraints=critical,CA:TRUE -addext keyUsage=critical,keyCertSign,cRLSign
openssl req -new -key "$out/rsa.key" -out leaf.csr -subj '/CN=Long Issuer Signer'
printf 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\n' > leaf.ext
openssl x509 -req -in leaf.csr -CA root.pem -CAkey root.key -CAcreateserial -days 7300 -extfile leaf.ext -out leaf.pem 2>/dev/null
openssl pkcs12 -export -inkey "$out/rsa.key" -in leaf.pem -certfile root.pem -passout pass:wren -out "$out/long-issuer.p12"
cp root.pem "$out/long-issuer-root.pem"
