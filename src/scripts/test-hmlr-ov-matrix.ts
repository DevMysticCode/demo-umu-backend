/**
 * HMLR OOV — full BGTest scenario matrix runner for UAT evidence.
 *
 *   npm run hmlr:uat
 *
 * Fires every documented BGTest MessageId at the OOV stub, asserts the
 * response against the expected shape from the Vendor Test Data page,
 * and persists a per-scenario evidence pack to
 *
 *   evidence/hmlr-uat/<messageId>/
 *     request.xml    — the SOAP envelope we sent
 *     response.xml   — HMLR's raw response
 *     verdict.json   — parsed result + expected + pass/fail
 *
 * At the end, prints a pass/fail matrix summarising the run.
 *
 * The evidence directory is gitignored — it contains real HMLR test
 * data with our BGUser credentials + response payloads.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LandRegistryService } from '../land-registry/land-registry.service'
import type { VerifyOwnershipInput, VerifyOwnershipResult } from '../land-registry/land-registry.types'

interface Expected {
  typeCode?: 10 | 20 | 30
  matchResult?: 'SINGLE_MATCH' | 'MULTIPLE_MATCHES' | 'NO_MATCHES'
  minMatches?: number
  hasRejectionCode?: boolean
  hasAckExpectedDate?: boolean
}

interface Scenario {
  id: string
  description: string
  input: VerifyOwnershipInput
  expected: Expected
}

// Reference personality that HMLR's stub keys most of its scenarios
// against. Real address/name doesn't matter for the stub — MessageId
// drives the response — but we send a plausible pair so the request
// envelope is realistic for evidence.
const REFERENCE_PERSONALITY = {
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
} as const

const scenarios: Scenario[] = [
  {
    id: 'eoov-fm-1',
    description: 'Full match — TypeCode 30, SINGLE_MATCH, title DN506574',
    input: { ...REFERENCE_PERSONALITY, messageId: 'eoov-fm-1', reference: 'UMU-UAT-fm-1' },
    expected: { typeCode: 30, matchResult: 'SINGLE_MATCH', minMatches: 1 },
  },
  {
    id: 'eoov-snm-1',
    description: 'Surname-only match — TypeCode 30 with surname MATCH only',
    input: { ...REFERENCE_PERSONALITY, messageId: 'eoov-snm-1', reference: 'UMU-UAT-snm-1' },
    expected: { typeCode: 30, matchResult: 'SINGLE_MATCH', minMatches: 1 },
  },
  {
    id: 'eoov-nm-1',
    description: 'No matches — TypeCode 30, NO_MATCHES',
    input: { ...REFERENCE_PERSONALITY, messageId: 'eoov-nm-1', reference: 'UMU-UAT-nm-1' },
    expected: { typeCode: 30, matchResult: 'NO_MATCHES' },
  },
  {
    id: 'eoov-mam-1',
    description: 'Multiple address matches — TypeCode 30, MULTIPLE_MATCHES',
    input: { ...REFERENCE_PERSONALITY, messageId: 'eoov-mam-1', reference: 'UMU-UAT-mam-1' },
    expected: { typeCode: 30, matchResult: 'MULTIPLE_MATCHES', minMatches: 2 },
  },
  {
    id: 'eoov-pi-1',
    description: 'Postcode invalid — TypeCode 20 rejection',
    input: { ...REFERENCE_PERSONALITY, messageId: 'eoov-pi-1', reference: 'UMU-UAT-pi-1' },
    expected: { typeCode: 20, hasRejectionCode: true },
  },
  {
    id: 'eoov-nam-1',
    description: 'No address match — TypeCode 20 rejection',
    input: { ...REFERENCE_PERSONALITY, messageId: 'eoov-nam-1', reference: 'UMU-UAT-nam-1' },
    expected: { typeCode: 20, hasRejectionCode: true },
  },
  {
    id: 'eoov-ooh-1',
    description: 'Out of hours — TypeCode 20 rejection (with continueIfOutOfHours=false)',
    input: {
      ...REFERENCE_PERSONALITY,
      messageId: 'eoov-ooh-1',
      reference: 'UMU-UAT-ooh-1',
      options: { ...REFERENCE_PERSONALITY.options, continueIfOutOfHours: false },
    },
    expected: { typeCode: 20, hasRejectionCode: true },
  },
  {
    id: 'eoov-ooh-2',
    description: 'Out of hours queued — TypeCode 10 acknowledgement (continueIfOutOfHours=true)',
    input: { ...REFERENCE_PERSONALITY, messageId: 'eoov-ooh-2', reference: 'UMU-UAT-ooh-2' },
    expected: { typeCode: 10, hasAckExpectedDate: true },
  },
]

function assertScenario(
  expected: Expected,
  result: VerifyOwnershipResult,
): { passed: boolean; failures: string[] } {
  const failures: string[] = []
  if (expected.typeCode !== undefined && result.typeCode !== expected.typeCode) {
    failures.push(`expected typeCode=${expected.typeCode}, got ${result.typeCode}`)
  }
  if (expected.matchResult !== undefined && result.result?.matchResult !== expected.matchResult) {
    failures.push(`expected matchResult=${expected.matchResult}, got ${result.result?.matchResult ?? '<none>'}`)
  }
  if (expected.minMatches !== undefined && (result.result?.matches?.length ?? 0) < expected.minMatches) {
    failures.push(`expected at least ${expected.minMatches} match(es), got ${result.result?.matches?.length ?? 0}`)
  }
  if (expected.hasRejectionCode && !result.rejection?.code) {
    failures.push('expected rejection code, got none')
  }
  if (expected.hasAckExpectedDate && !result.acknowledgement?.expectedResponseDateTime) {
    failures.push('expected acknowledgement.expectedResponseDateTime, got none')
  }
  return { passed: failures.length === 0, failures }
}

async function runScenario(
  svc: LandRegistryService,
  scenario: Scenario,
): Promise<{
  id: string
  status: 'PASS' | 'FAIL' | 'ERROR'
  typeCode?: number
  matchResult?: string
  matchCount?: number
  rejectionCode?: string
  failures: string[]
  errorMessage?: string
  durationMs: number
}> {
  const startedAt = Date.now()
  try {
    const result = await svc.verifyOwnership(scenario.input)
    const verdict = assertScenario(scenario.expected, result)

    // Persist the evidence artefacts. One directory per scenario keeps
    // it easy to zip up + attach to the HMLR account file.
    const dir = join(process.cwd(), 'evidence', 'hmlr-uat', scenario.id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'request.xml'), result.rawRequest)
    writeFileSync(join(dir, 'response.xml'), result.raw)
    writeFileSync(
      join(dir, 'verdict.json'),
      JSON.stringify(
        {
          scenario: scenario.id,
          description: scenario.description,
          runAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt,
          endpoint: process.env.HMLR_OV_ENDPOINT ?? '(default test)',
          username: process.env.HMLR_USERNAME ?? 'BGUser001',
          expected: scenario.expected,
          actual: {
            typeCode: result.typeCode,
            matchResult: result.result?.matchResult,
            matchCount: result.result?.matches?.length ?? 0,
            rejectionCode: result.rejection?.code,
            acknowledgementExpectedResponseDateTime:
              result.acknowledgement?.expectedResponseDateTime,
          },
          verdict: verdict.passed ? 'PASS' : 'FAIL',
          failures: verdict.failures,
        },
        null,
        2,
      ),
    )

    return {
      id: scenario.id,
      status: verdict.passed ? 'PASS' : 'FAIL',
      typeCode: result.typeCode,
      matchResult: result.result?.matchResult,
      matchCount: result.result?.matches?.length ?? 0,
      rejectionCode: result.rejection?.code,
      failures: verdict.failures,
      durationMs: Date.now() - startedAt,
    }
  } catch (err) {
    const errorMessage = (err as Error).message
    // Best effort — still write the error to disk so the evidence pack
    // shows the scenario was attempted even if the call errored.
    const dir = join(process.cwd(), 'evidence', 'hmlr-uat', scenario.id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'verdict.json'),
      JSON.stringify(
        {
          scenario: scenario.id,
          description: scenario.description,
          runAt: new Date().toISOString(),
          verdict: 'ERROR',
          errorMessage,
        },
        null,
        2,
      ),
    )
    return {
      id: scenario.id,
      status: 'ERROR',
      failures: [errorMessage],
      errorMessage,
      durationMs: Date.now() - startedAt,
    }
  }
}

async function main() {
  const svc = new LandRegistryService()
  console.log('--- HMLR OOV UAT scenario matrix ---')
  console.log('Endpoint :', process.env.HMLR_OV_ENDPOINT || '(default test)')
  console.log('Username :', process.env.HMLR_USERNAME || 'BGUser001')
  console.log(`Scenarios: ${scenarios.length}`)
  console.log('------------------------------------\n')

  const results: Awaited<ReturnType<typeof runScenario>>[] = []
  for (const s of scenarios) {
    process.stdout.write(`▶ ${s.id.padEnd(12)} ${s.description}\n`)
    const r = await runScenario(svc, s)
    const badge = r.status === 'PASS' ? '✅ PASS' : r.status === 'FAIL' ? '❌ FAIL' : '⚠️  ERROR'
    process.stdout.write(
      `  ${badge}  typeCode=${r.typeCode ?? '-'}  matchResult=${r.matchResult ?? '-'}  matches=${r.matchCount ?? '-'}  rejection=${r.rejectionCode ?? '-'}  (${r.durationMs}ms)\n`,
    )
    if (r.failures.length) for (const f of r.failures) process.stdout.write(`      · ${f}\n`)
    process.stdout.write('\n')
    results.push(r)
  }

  const pass = results.filter((r) => r.status === 'PASS').length
  const fail = results.filter((r) => r.status === 'FAIL').length
  const err = results.filter((r) => r.status === 'ERROR').length
  console.log('=================================')
  console.log(`Summary: ${pass}/${results.length} pass · ${fail} fail · ${err} error`)
  console.log('Evidence pack: evidence/hmlr-uat/<messageId>/')
  console.log('=================================')

  // Persist the summary itself as JSON so the whole run has an index.
  const summaryDir = join(process.cwd(), 'evidence', 'hmlr-uat')
  mkdirSync(summaryDir, { recursive: true })
  writeFileSync(
    join(summaryDir, '_summary.json'),
    JSON.stringify(
      {
        runAt: new Date().toISOString(),
        endpoint: process.env.HMLR_OV_ENDPOINT ?? '(default test)',
        username: process.env.HMLR_USERNAME ?? 'BGUser001',
        counts: { total: results.length, pass, fail, error: err },
        results,
      },
      null,
      2,
    ),
  )

  if (fail + err > 0) process.exit(1)
}

main().catch((err) => {
  console.error('HMLR UAT matrix failed:', err)
  process.exit(1)
})
