/**
 * Standalone CLI to verify the HMLR Online Owner Verification integration.
 *
 *   npm run hmlr:test
 *
 * Reads the test certificate (HMLR_PFX_PATH + HMLR_PFX_PASSPHRASE) and POSTs a
 * sample request to the OOV stub. Prints the parsed result + the raw XML so
 * we can confirm mTLS, WS-Security and the OOV envelope are all valid before
 * wiring the service into the claim flow.
 */
// Run via `npm run hmlr:test` — the npm script passes `--env-file=.env`
// so we don't pull in a dotenv dep just for one CLI.
import { LandRegistryService } from '../land-registry/land-registry.service'

async function main() {
  const svc = new LandRegistryService()
  const reference = `UMU-TEST-${Date.now().toString(36)}`
  console.log('--- HMLR OOV test request ---')
  console.log('Endpoint :', process.env.HMLR_OV_ENDPOINT || '(default test)')
  console.log('PFX path :', process.env.HMLR_PFX_PATH || './secrets/hmlr/test.pfx')
  console.log('Username :', process.env.HMLR_USERNAME || 'BGUser001')
  console.log('Reference:', reference)
  console.log('-----------------------------')

  // The OOV test stub matches on MessageId, not the actual inputs. Pick a
  // scenario from the Vendor Test Data page:
  //   eoov-fm-1   Full Match   (TypeCode 30, SINGLE_MATCH, DN506574)
  //   eoov-snm-1  Surname-only match
  //   eoov-nm-1   NO_MATCHES
  //   eoov-pi-1   Postcode invalid (rejection)
  //   eoov-nam-1  No address match (rejection)
  //   eoov-ooh-1  Out of hours (rejection)
  //   eoov-ooh-2  Out of hours queued (acknowledgement)
  //   eoov-mam-1  Multiple matches
  const scenario = process.env.HMLR_TEST_SCENARIO?.trim() || 'eoov-fm-1'
  console.log('Scenario :', scenario, '(set HMLR_TEST_SCENARIO to switch)')
  console.log('-----------------------------')

  const result = await svc.verifyOwnership({
    messageId: scenario,
    reference,
    forename: 'Jon',
    middleName: 'Tomas',
    surname: 'Tankerman',
    subject: {
      address: {
        buildingNumber: '24',
        streetName: 'Dovedale Road',
        cityName: 'Plymouth',
        postcode: 'PL1 1QQ',
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
