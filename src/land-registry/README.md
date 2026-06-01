# HM Land Registry — Business Gateway integration

Test-side client for **Online Owner Verification (OOV)** over Business Gateway.

## What it does

`LandRegistryService.verifyOwnership(...)` POSTs a SOAP envelope to HMLR's
test (or production) endpoint over mutual TLS, with a WS-Security
UsernameToken header. The OOV payload (`RequestOOV`) goes inside the SOAP
body. The response is parsed into a typed `VerifyOwnershipResult` with
either `acknowledgement` (TypeCode 10), `rejection` (20), or `result` (30).

## Env vars

Add these to `umu-backend/.env`:

```dotenv
# Preferred: PEM cert + private key (modern OpenSSL 3 — no legacy flag).
# Extract once from the .pfx with openssl (see "Cert rotation" below).
HMLR_CERT_PATH=./secrets/hmlr/test.cert.pem
HMLR_KEY_PATH=./secrets/hmlr/test.key.pem
HMLR_CA_PATH=./secrets/hmlr/test.ca.pem
# HMLR_KEY_PASSPHRASE=<only if the key.pem is encrypted>

# Fallback: original .pfx — kept for emergency use, but loading it needs
# `node --openssl-legacy-provider` (HMLR's pfx uses legacy ciphers).
# HMLR_PFX_PATH=./secrets/hmlr/test.pfx
# HMLR_PFX_PASSPHRASE=<pfx passphrase>

# Test creds from HMLR (sandbox). Override for production.
HMLR_USERNAME=BGUser001
HMLR_PASSWORD=landreg001

# OOV endpoint. The default is the test stub — switch hosts + path segment
# (EOOV_StubService → EOOV_SoapEngine) for production.
HMLR_OV_ENDPOINT=https://bgtest.landregistry.gov.uk/b2b/EOOV_StubService/OnlineOwnershipVerificationV1_0WebService
```

## Cert rotation

Re-extract the PEMs from a fresh `.pfx`:

```bash
# Client/leaf cert — sent to HMLR as our identity.
openssl pkcs12 -legacy -in secrets/hmlr/test.pfx -clcerts -nokeys \
  -out secrets/hmlr/test.cert.pem -passin pass:<pfx-passphrase>

# Private key — pairs with the client cert.
openssl pkcs12 -legacy -in secrets/hmlr/test.pfx -nocerts -nodes \
  -out secrets/hmlr/test.key.pem -passin pass:<pfx-passphrase>

# CA chain — intermediates + root from HMLR. Required so Node trusts
# the server cert HMLR presents (without it Node throws
# SELF_SIGNED_CERT_IN_CHAIN, because HMLR's chain isn't in Node's default
# CA bundle).
openssl pkcs12 -legacy -in secrets/hmlr/test.pfx -cacerts -nokeys \
  -out secrets/hmlr/test.ca.pem -passin pass:<pfx-passphrase>
```

(`-legacy` is only needed for *reading* the legacy .pfx — the resulting PEMs
load natively in Node.)

## Smoke test

```
npm run hmlr:test
```

Fires the sample request from the OOV interface spec
(`Jon Tomas Tankerman` at `101A PL1 1QQ`) and prints the parsed result + the
first 2k of raw XML. If you see:

- `TypeCode: 30` — full round-trip works.
- `TypeCode: 20` with `Code: bg.*` — HMLR accepted the call; tweak inputs.
- `Error: HMLR client certificate not found` — set `HMLR_PFX_PATH`.
- `Error: HMLR transport 401/403` — username/password rejected or cert not
  matched to the test account.

## Where it plugs in

Future: wire `LandRegistryModule` into the `ClaimController` / passport
claim flow so submitting a claim triggers OOV and writes the verdict into
the existing `OwnershipVerification` table.

Spec links:
- https://landregistry.github.io/bgtechdoc/get_started/developer_guide/
- https://landregistry.github.io/bgtechdoc/services/online_owner_verification/
- https://landregistry.github.io/bgtechdoc/documents/online_owner_verification/OOV_Interface_Spec.html
