// Mirror KycService.startInquiry — POST /inquiries against Persona
// using the .env credentials, dump status + trimmed body. No DB write,
// no user linkage; just proves the key/template pair is live.
import { readFileSync } from 'node:fs'

const envPath = new URL('../.env', import.meta.url)
for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
  if (!m) continue
  const [, k, vRaw] = m
  const v = vRaw.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1')
  if (!process.env[k]) process.env[k] = v
}

const apiKey = process.env.PERSONA_API_KEY
const templateId = process.env.PERSONA_TEMPLATE_ID
if (!apiKey || !templateId) {
  console.error('Missing PERSONA_API_KEY or PERSONA_TEMPLATE_ID'); process.exit(1)
}

const isCase = templateId.startsWith('ctmpl_')
const path = isCase ? '/cases' : '/inquiries'
const attrKey = isCase ? 'case-template-id' : 'inquiry-template-id'

const body = {
  data: {
    attributes: {
      [attrKey]: templateId,
      'reference-id': 'smoketest-' + Date.now(),
      fields: {
        'name-first': 'Test',
        'name-last': 'User',
        'email-address': 'software@ncs-it.co.uk',
      },
    },
  },
}

console.log(`[persona] POST ${path} template=${templateId.slice(0,10)}...`)
const t0 = Date.now()
const res = await fetch(`https://api.withpersona.com/api/v1${path}`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Persona-Version': '2023-01-05',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(body),
})
const text = await res.text()
console.log(`[persona] ${res.status} ${res.statusText} in ${Date.now() - t0}ms`)
let json = null
try { json = JSON.parse(text) } catch {}
if (res.ok) {
  console.log(`[persona] ✔ created id=${json?.data?.id} status=${json?.data?.attributes?.status}`)
  console.log(`[persona] hostedUrl=https://withpersona.com/verify?${isCase?'case-id':'inquiry-id'}=${json?.data?.id}`)
} else {
  console.log('[persona] ✘ error body:')
  console.log(JSON.stringify(json ?? text, null, 2).slice(0, 1200))
}
