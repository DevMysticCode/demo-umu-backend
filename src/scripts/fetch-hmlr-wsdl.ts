/**
 * Fetches the OOV WSDL via mTLS so we can see the actual SOAP operation name
 * and message structure HMLR expects. Run once, inspect, commit nothing.
 *
 *   npm run hmlr:wsdl
 */
import * as https from 'https'
import * as tls from 'tls'
import * as fs from 'fs'
import * as path from 'path'

const pfxPath = process.env.HMLR_PFX_PATH?.trim() || './secrets/hmlr/test.pfx'
const passphrase = process.env.HMLR_PFX_PASSPHRASE ?? ''
const endpoint =
  process.env.HMLR_OV_ENDPOINT?.trim() ||
  'https://bgtest.landregistry.gov.uk/b2b/EOOV_StubService/OnlineOwnershipVerificationV1_0WebService'

async function fetchWithCert(url: string): Promise<string> {
  const absPath = path.isAbsolute(pfxPath)
    ? pfxPath
    : path.resolve(process.cwd(), pfxPath)
  // Prefer PEM (modern OpenSSL 3) + explicit CA chain — same as the service.
  const certEnv = process.env.HMLR_CERT_PATH?.trim()
  const keyEnv = process.env.HMLR_KEY_PATH?.trim()
  const caEnv = process.env.HMLR_CA_PATH?.trim()
  let agent: https.Agent
  if (certEnv && keyEnv) {
    const certAbs = path.isAbsolute(certEnv) ? certEnv : path.resolve(process.cwd(), certEnv)
    const keyAbs = path.isAbsolute(keyEnv) ? keyEnv : path.resolve(process.cwd(), keyEnv)
    const caAbs = caEnv ? (path.isAbsolute(caEnv) ? caEnv : path.resolve(process.cwd(), caEnv)) : null
    const caBundle: string[] = [...tls.rootCertificates]
    if (caAbs) caBundle.push(fs.readFileSync(caAbs, 'utf8'))
    agent = new https.Agent({
      cert: fs.readFileSync(certAbs),
      key: fs.readFileSync(keyAbs),
      ca: caBundle,
      passphrase: process.env.HMLR_KEY_PASSPHRASE ?? undefined,
      keepAlive: false,
    })
  } else {
    const pfx = fs.readFileSync(absPath)
    agent = new https.Agent({ pfx, passphrase, keepAlive: false })
  }
  const u = new URL(url)
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: 'GET',
        agent,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const data = Buffer.concat(chunks).toString('utf8')
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 600)}`))
            return
          }
          resolve(data)
        })
      },
    )
    req.on('error', reject)
    req.end()
  })
}

async function main() {
  const wsdlUrl = endpoint.includes('?') ? `${endpoint}&wsdl` : `${endpoint}?wsdl`
  console.log('Fetching WSDL:', wsdlUrl)
  const wsdl = await fetchWithCert(wsdlUrl)
  const outDir = path.resolve(process.cwd(), 'docs/hmlr')
  fs.mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, 'OnlineOwnershipVerificationV1_0.wsdl')
  fs.writeFileSync(outPath, wsdl, 'utf8')
  console.log(`Saved ${wsdl.length} bytes → ${outPath}`)
  console.log('\n--- WSDL preview (first 3k) ---')
  console.log(wsdl.slice(0, 3000))

  // Also try to fetch any imported XSDs referenced in the WSDL (they tell
  // us the EXACT schema with element order + required wrappers).
  const xsdRefs = Array.from(
    wsdl.matchAll(/schemaLocation\s*=\s*"([^"]+)"/g),
    (m) => m[1],
  )
  for (const ref of xsdRefs) {
    const absRef = ref.startsWith('http')
      ? ref
      : new URL(ref, wsdlUrl).toString()
    try {
      const xsd = await fetchWithCert(absRef)
      const fname = path.basename(new URL(absRef).pathname)
      const xsdOut = path.join(outDir, fname || 'schema.xsd')
      fs.writeFileSync(xsdOut, xsd, 'utf8')
      console.log(`  + saved ${xsd.length} bytes → ${xsdOut}`)
    } catch (e) {
      console.warn(`  ! could not fetch ${absRef}: ${(e as Error).message}`)
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
