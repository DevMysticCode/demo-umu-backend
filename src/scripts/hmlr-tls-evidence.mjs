/**
 * Capture openssl s_client handshake evidence against both HMLR
 * Business Gateway hosts (test + live) using our BGTest client cert.
 * Writes the handshake log to evidence/hmlr-uat/tls-<host>.log so
 * we have a durable artefact showing:
 *
 *   - TLS version + cipher negotiated
 *   - Server certificate presented
 *   - "Verify return code: 0 (ok)" — mTLS accepted
 *   - Session ID
 *
 * All output is redirected to files under the gitignored evidence dir.
 */
import { execSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const envPath = new URL('../../.env', import.meta.url)
for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
  if (!m) continue
  const [, k, v] = m
  if (!process.env[k]) process.env[k] = v.replace(/^"(.*)"$/, '$1')
}
const passphrase = process.env.HMLR_PFX_PASSPHRASE
if (!passphrase) { console.error('HMLR_PFX_PASSPHRASE missing'); process.exit(1) }

// Extract PEMs to a Windows-visible temp dir; wiped on exit.
const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'hmlr-tls-'))
process.on('exit', () => { try { rmSync(tmpDir, { recursive: true, force: true }) } catch {} })
const extract = (flags, out) =>
  execSync(
    `openssl pkcs12 -legacy -in "secrets/hmlr/live/OpenProperty.p12" ${flags} -out "${path.join(tmpDir, out)}" -passin env:PP`,
    { env: { ...process.env, PP: passphrase } },
  )
extract('-clcerts -nokeys', 'cert.pem')
extract('-nocerts -nodes', 'key.pem')
extract('-cacerts -nokeys', 'chain.pem')

const evidenceDir = path.join(process.cwd(), 'evidence', 'hmlr-uat')
mkdirSync(evidenceDir, { recursive: true })

const hosts = [
  { name: 'bgtest', host: 'bgtest.landregistry.gov.uk' },
  { name: 'live',   host: 'businessgateway.landregistry.gov.uk' },
]

for (const { name, host } of hosts) {
  const outFile = path.join(evidenceDir, `tls-${name}.log`)
  console.log(`▶ ${host}`)
  const cmd = [
    'openssl s_client',
    `-connect ${host}:443`,
    `-servername ${host}`,
    `-cert "${path.join(tmpDir, 'cert.pem')}"`,
    `-key "${path.join(tmpDir, 'key.pem')}"`,
    `-CAfile "${path.join(tmpDir, 'chain.pem')}"`,
    '-tls1_2',
    '-showcerts',
  ].join(' ')
  try {
    // input:'' closes stdin so openssl s_client exits after the
    // handshake instead of hanging on interactive input. Portable
    // replacement for `< /dev/null` which doesn't work on Windows.
    const stdout = execSync(cmd, { encoding: 'utf8', timeout: 30_000, input: '' })
    writeFileSync(outFile, stdout)
    // Grep out the interesting lines for the console.
    const summary = stdout
      .split('\n')
      .filter((l) => /CONNECTED|Cipher\s*:|Protocol\s*:|Verify return code|Session-ID:|subject=|issuer=/.test(l))
      .slice(0, 10)
      .join('\n')
    console.log(summary)
    console.log(`  → ${outFile}`)
  } catch (e) {
    console.log(`  ✘ ${e.message.slice(0, 200)}`)
  }
  console.log('')
}

console.log('TLS evidence captured under evidence/hmlr-uat/tls-*.log')
