/**
 * Standalone CLI to verify the HMLR Online Owner Verification integration.
 *
 *   npm run hmlr:test
 *
 * Reads the test certificate (HMLR_PFX_PATH + HMLR_PFX_PASSPHRASE) and POSTs a
 * sample request to the OOV stub. Prints the parsed result + the raw XML so
 * we can confirm mTLS, WS-Security and the OOV envelope are all valid before
 * wiring the service into the claim flow.
 *
 * IMPORTANT — MessageId: per HMLR's reliable-messaging spec, MessageId is a
 * per-request idempotency key ("unique message ID" + "process request only
 * once" — Business Gateway stores the response keyed by it and replays that
 * stored response for any repeat with the same ID). The `eoov-*` codes below
 * are a DIFFERENT thing — fixed scenario codes from HMLR's Vendor Test Data
 * page that only the bgtest STUB pattern-matches on to pick a canned
 * fixture. They are meaningless (and apparently harmful — see below) against
 * the real production SOAP engine, which expects a genuinely unique ID like
 * any other request. We spent a long time chasing a "System Error occurred"
 * fault against production while defaulting to the fixed scenario code
 * `eoov-fm-1` on every single call — reusing the exact same "unique" ID for
 * weeks is very likely what actually caused that fault, not an HMLR-side
 * account provisioning issue as we originally assumed. A real UUID is now
 * the default; only pass HMLR_TEST_SCENARIO when deliberately testing
 * against bgtest, never against the live endpoint.
 */
// Run via `npm run hmlr:test` — the npm script passes `--env-file=.env`
// so we don't pull in a dotenv dep just for one CLI.
import { randomUUID } from 'node:crypto'
import { LandRegistryService } from '../land-registry/land-registry.service'

async function main() {
  const svc = new LandRegistryService()
  const reference = `UMU-TEST-${Date.now().toString(36)}`
  console.log('--- HMLR OOV test request ---')
  console.log('Endpoint :', process.env.HMLR_OV_ENDPOINT || '(default test)')
  if (process.env.HMLR_CERT_PATH && process.env.HMLR_KEY_PATH) {
    console.log('Cert path:', process.env.HMLR_CERT_PATH)
    console.log('Key path :', process.env.HMLR_KEY_PATH)
    console.log('CA path  :', process.env.HMLR_CA_PATH || '(none)')
  } else if (process.env.HMLR_CERT_PEM || process.env.HMLR_CERT_PEM_B64) {
    console.log('Cert     : inline via HMLR_CERT_PEM(_B64)')
  } else {
    console.log('PFX path :', process.env.HMLR_PFX_PATH || './secrets/hmlr/test.pfx')
  }
  console.log('Username :', process.env.HMLR_USERNAME || 'BGUser001')
  console.log('Reference:', reference)
  console.log('-----------------------------')

  // Only the bgtest STUB pattern-matches on these — pick one from the
  // Vendor Test Data page ONLY when HMLR_OV_ENDPOINT points at bgtest:
  //   eoov-fm-1   Full Match   (TypeCode 30, SINGLE_MATCH, DN506574)
  //   eoov-snm-1  Surname-only match
  //   eoov-nm-1   NO_MATCHES
  //   eoov-pi-1   Postcode invalid (rejection)
  //   eoov-nam-1  No address match (rejection)
  //   eoov-ooh-1  Out of hours (rejection)
  //   eoov-ooh-2  Out of hours queued (acknowledgement)
  //   eoov-mam-1  Multiple matches
  // Against the LIVE endpoint this must be a genuinely unique ID (see the
  // file header) — default is a fresh UUID every run. Only override with
  // HMLR_TEST_SCENARIO when you're deliberately pointed at bgtest.
  const scenario = process.env.HMLR_TEST_SCENARIO?.trim() || randomUUID()
  console.log('MessageId:', scenario, '(set HMLR_TEST_SCENARIO to override — bgtest scenario codes ONLY, never against live)')
  console.log('-----------------------------')

  // Subject defaults to HMLR's own vendor test person (Jon Tankerman / 24
  // Dovedale Road) — fine against bgtest, meaningless against production
  // (it isn't a real title owner, so live will just return NO_MATCHES).
  // Override via env vars to test a real subject against the live service.
  const forename = process.env.HMLR_TEST_FORENAME?.trim() || 'Jon'
  // Falsy-OR would coerce an intentionally empty override back to the
  // default — use presence-check so HMLR_TEST_MIDDLENAME="" means "no
  // middle name" rather than "unset".
  const middleName =
    process.env.HMLR_TEST_MIDDLENAME !== undefined
      ? process.env.HMLR_TEST_MIDDLENAME.trim()
      : 'Tomas'
  const surname = process.env.HMLR_TEST_SURNAME?.trim() || 'Tankerman'
  const buildingNumber = process.env.HMLR_TEST_BUILDING_NUMBER?.trim() || '24'
  const streetName = process.env.HMLR_TEST_STREET?.trim() || 'Dovedale Road'
  const cityName = process.env.HMLR_TEST_CITY?.trim() || 'Plymouth'
  const postcode = process.env.HMLR_TEST_POSTCODE?.trim() || 'PL1 1QQ'
  console.log('Subject  :', forename, middleName, surname)
  console.log('Address  :', buildingNumber, streetName, cityName, postcode)
  console.log('-----------------------------')

  const result = await svc.verifyOwnership({
    messageId: scenario,
    reference,
    forename,
    middleName,
    surname,
    subject: {
      address: {
        buildingNumber,
        streetName,
        cityName,
        postcode,
      },
    },
    options: {
      continueIfOutOfHours: true,
      skipPartialMatching: false,
      skipHistoricalMatching: false,
    },
  })

  console.log('\n=== Parsed result ===')
  console.log('TypeCode  :', result.typeCode)
  if (result.acknowledgement) {
    console.log('Ack       :', result.acknowledgement)
  }
  if (result.rejection) {
    console.log('Rejection :', result.rejection)
  }
  if (result.result) {
    console.log('MatchResult:', result.result.matchResult)
    console.log('Matches    :', result.result.matches.length)
    for (const [i, m] of result.result.matches.entries()) {
      console.log(`  [${i}] title=${m.titleNumber ?? '-'}  ` +
        `surname=${m.surnameMatch?.typeOfMatch ?? '-'}  ` +
        `forename=${m.forenameMatch?.typeOfMatch ?? '-'}  ` +
        `historical=${m.info.HistoricalMatch ?? '-'}`)
    }
  }

  console.log('\n=== Raw XML (first 2k chars) ===')
  console.log(result.raw.slice(0, 2000))
}

main().catch((err) => {
  console.error('HMLR test failed:', err)
  process.exit(1)
})
