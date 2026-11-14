#!/usr/bin/env bash
# Throwaway identities for offline signing tests. Requires OpenSSL 3.x.
set -eu
export MSYS_NO_PATHCONV=1
root=$(cd "$(dirname "$0")/.." && pwd)
out="$root/fixtures/digital-id"
mkdir -p "$out"
tmp=$(mktemp -d "$out/.make-XXXXXX")
if command -v cygpath >/dev/null 2>&1; then out=$(cygpath -m "$out"); fi
trap 'rm -f "$tmp"/*; rmdir "$tmp"' EXIT
cd "$tmp"
touch index
printf '1000\n' > serial
cat > ca.cnf <<'EOF'
[ca]
default_ca=tests
[tests]
database=index
serial=serial
new_certs_dir=.
default_md=sha256
policy=names
unique_subject=no
copy_extensions=none
[names]
commonName=supplied
organizationName=optional
emailAddress=optional
[root]
basicConstraints=critical,CA:TRUE,pathlen:1
keyUsage=critical,keyCertSign,cRLSign
subjectKeyIdentifier=hash
[intermediate]
basicConstraints=critical,CA:TRUE,pathlen:0
keyUsage=critical,keyCertSign,cRLSign
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid
[leaf]
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,nonRepudiation
extendedKeyUsage=emailProtection
subjectAltName=email:signer@example.invalid
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid
EOF
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out ca.key 2>/dev/null
openssl req -new -key ca.key -out ca.csr -subj '/CN=Paperwren Test CA/O=Paperwren Tests'
openssl req -x509 -key ca.key -in ca.csr -out bootstrap.pem -days 1
issue() {
  name=$1; cert=$2; key=$3; ext=$4; start=${5:-20250101000000Z}; end=${6:-20450101000000Z}
  openssl ca -batch -notext -config ca.cnf -cert "$cert" -keyfile "$key" \
    -extensions "$ext" -startdate "$start" -enddate "$end" \
    -in "$name.csr" -out "$name.pem" "${@:7}" 2>/dev/null
}
issue ca bootstrap.pem ca.key root 20250101000000Z 20450101000000Z -selfsign
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out issuer.key
openssl req -new -key issuer.key -out issuer.csr -subj '/CN=Paperwren Test Issuer/O=Paperwren Tests'
issue issuer ca.pem ca.key intermediate
leaf() {
  name=$1; shift
  openssl genpkey "$@" -out "$name.key" 2>/dev/null
  openssl req -new -key "$name.key" -out "$name.csr" \
    -subj "/CN=Test Signer $name/O=Paperwren Tests/emailAddress=legacy@example.invalid"
  issue "$name" issuer.pem issuer.key leaf
}
leaf rsa -algorithm RSA -pkeyopt rsa_keygen_bits:2048
leaf rsa4096 -algorithm RSA -pkeyopt rsa_keygen_bits:4096
leaf p256 -algorithm EC -pkeyopt ec_paramgen_curve:P-256
leaf p384 -algorithm EC -pkeyopt ec_paramgen_curve:P-384
leaf p521 -algorithm EC -pkeyopt ec_paramgen_curve:P-521
cat issuer.pem ca.pem > chain.pem
x() {
  openssl pkcs12 -export -inkey "$1.key" -in "$1.pem" -certfile chain.pem \
    -passout pass:wren -out "$out/$2" "${@:3}"
}
x rsa rsa-aes256.p12
x rsa rsa-legacy.p12 -legacy
x rsa rsa-3des.p12 -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1
x rsa rsa-2des-rc2128.p12 -legacy -keypbe PBE-SHA1-2DES -certpbe PBE-SHA1-RC2-128
x rsa rsa-pbes2-3des.p12 -keypbe des-ede3-cbc -certpbe des-ede3-cbc
x rsa rsa-aes128.p12 -keypbe aes-128-cbc -certpbe aes-128-cbc -macalg sha1
x rsa rsa-nomac.p12 -nomac
x rsa rsa-plaincerts.p12 -certpbe NONE
x rsa rsa-plainkey.p12 -keypbe NONE -certpbe NONE
x rsa rsa-aes192.p12 -keypbe aes-192-cbc -certpbe aes-192-cbc
x rsa rsa-sha384.p12 -macalg sha384
x rsa rsa-sha512.p12 -macalg sha512
x rsa4096 rsa4096.p12
x p256 p256.p12
x p256 p256-legacy.p12 -legacy
x p384 p384.p12
x p521 p521.p12
openssl pkcs12 -export -inkey rsa.key -in rsa.pem -passout pass: -out "$out/rsa-empty-password.p12"
printf '%s\n' 'wrénøß' > unicode.pass
openssl pkcs12 -export -inkey rsa.key -in rsa.pem -passout file:unicode.pass -out "$out/rsa-unicode.p12"
openssl pkcs12 -export -legacy -inkey rsa.key -in rsa.pem -passout file:unicode.pass -out "$out/rsa-unicode-legacy.p12"
openssl pkcs12 -export -nokeys -in rsa.pem -passout pass:wren -out "$out/certs-only.p12"
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out self.key
openssl req -new -key self.key -out self.csr -subj '/CN=Self Signed Tester'
openssl req -x509 -key self.key -in self.csr -out self-bootstrap.pem -days 1
issue self self-bootstrap.pem self.key leaf 20250101000000Z 20450101000000Z -selfsign
openssl pkcs12 -export -inkey self.key -in self.pem -passout pass:wren -out "$out/self-signed.p12"
cp rsa.csr expired.csr
issue expired issuer.pem issuer.key leaf 20200101000000Z 20210101000000Z
openssl pkcs12 -export -inkey rsa.key -in expired.pem -certfile chain.pem -passout pass:wren -out "$out/expired.p12"
if openssl pkcs12 -help 2>&1 | grep -q -- -pbmac1_pbkdf2; then
  x rsa rsa-pbmac1.p12 -pbmac1_pbkdf2
fi
# Public certificates and these two private keys support structural unit tests
# and independent OpenSSL/pyHanko checks. None belongs to a real identity.
cp ca.pem issuer.pem rsa.pem p256.pem p384.pem p521.pem self.pem expired.pem rsa.key p256.key "$out/"
for file in "$out"/*.p12; do
  password=pass:wren
  case "$file" in
    *empty-password*) password=pass: ;;
    *unicode*) password=file:unicode.pass ;;
  esac
  openssl pkcs12 -legacy -info -noout -in "$file" -passin "$password" 2>&1
done
cd "$root"
node scripts/make-digital-id-pdf-fixtures.mjs
node scripts/make-digital-id-shadow-fixtures.mjs
bash scripts/make-digital-id-long-issuer.sh
