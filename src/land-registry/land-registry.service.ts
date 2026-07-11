import { Injectable, Logger } from '@nestjs/common'
import * as https from 'https'
import * as tls from 'tls'
import * as fs from 'fs'
import * as path from 'path'
import { XMLParser } from 'fast-xml-parser'
import type {
  VerifyOwnershipInput,
  VerifyOwnershipResult,
  OvAcknowledgement,
  OvRejection,
  OvResult,
  OvMatch,
  OvMatchType,
  OvPropertyAddress,
  OvTypeCode,
} from './land-registry.types'

/**
 * Pull a PEM blob from env vars. We accept either:
 *   1. `<NAME>`     — raw PEM (`-----BEGIN ...\n...\n-----END ...`),
 *                     useful for `.env` files where newlines are fine.
 *   2. `<NAME>_B64` — base64-encoded PEM, the form that pastes cleanly
 *                     into a managed-host (Railway / Fly / Heroku) env-var
 *                     UI which often mangles multi-line input.
 *
 * Returns the decoded PEM string, or null when neither var is set.
 */
function readPemFromEnv(rawName: string, b64Name: string): string | null {
  const raw = process.env[rawName]?.trim()
  if (raw) return raw.includes('-----BEGIN') ? raw : Buffer.from(raw, 'base64').toString('utf8')
  const b64 = process.env[b64Name]?.trim()
  if (b64) return Buffer.from(b64, 'base64').toString('utf8')
  return null
}

/**
 * HM Land Registry Business Gateway client — Online Owner Verification (OOV).
 *
 * Transport: SOAP 1.1 over mutual TLS. The SOAP envelope carries a WS-Security
 * UsernameToken (plaintext password — safe because mTLS encrypts the channel)
 * and the OOV payload (`RequestOOV`) inside the Body.
 *
 * Test environment:
 *   https://bgtest.landregistry.gov.uk/b2b/EOOV_StubService/OnlineOwnershipVerificationV1_0WebService
 *
 * Production environment:
 *   https://businessgateway.landregistry.gov.uk/b2b/EOOV_SoapEngine/OnlineOwnershipVerificationV1_0WebService
 *
 * Spec:
 *   https://landregistry.github.io/bgtechdoc/services/online_owner_verification/
 *   https://landregistry.github.io/bgtechdoc/documents/online_owner_verification/OOV_Interface_Spec.html
 */
@Injectable()
export class LandRegistryService {
  private readonly logger = new Logger(LandRegistryService.name)
  private agent: https.Agent | null = null

  private get endpoint(): string {
    return (
      process.env.HMLR_OV_ENDPOINT?.trim() ||
      'https://bgtest.landregistry.gov.uk/b2b/EOOV_StubService/OnlineOwnershipVerificationV1_0WebService'
    )
  }

  private get username(): string {
    return process.env.HMLR_USERNAME?.trim() || 'BGUser001'
  }

  private get password(): string {
    return process.env.HMLR_PASSWORD?.trim() || 'landreg001'
  }

  /** Load the client cert once and reuse the agent across calls.
   *
   *  Preferred: PEM cert + key files (HMLR_CERT_PATH / HMLR_KEY_PATH).
   *  Modern OpenSSL 3 reads these natively — no --openssl-legacy-provider
   *  needed at runtime. Encrypted key files can carry a passphrase via
   *  HMLR_KEY_PASSPHRASE.
   *
   *  Fallback: PKCS#12 .pfx (HMLR_PFX_PATH / HMLR_PFX_PASSPHRASE). HMLR's
   *  .pfx uses legacy ciphers so loading it requires Node be started with
   *  --openssl-legacy-provider — the PEM path avoids that flag entirely. */
  private getAgent(): https.Agent {
    if (this.agent) return this.agent

    // Preferred on managed hosts (Railway, Fly, Heroku) where the
    // /secrets folder isn't deployed: PEM contents passed inline via
    // env vars. Accept either raw PEM (newlines preserved) or base64
    // — base64 is easier to paste into a single-line env-var box.
    const certPem = readPemFromEnv('HMLR_CERT_PEM', 'HMLR_CERT_PEM_B64')
    const keyPem = readPemFromEnv('HMLR_KEY_PEM', 'HMLR_KEY_PEM_B64')
    if (certPem && keyPem) {
      const caPem = readPemFromEnv('HMLR_CA_PEM', 'HMLR_CA_PEM_B64')
      const caBundle: string[] = [...tls.rootCertificates]
      if (caPem) caBundle.push(caPem)
      this.agent = new https.Agent({
        cert: certPem,
        key: keyPem,
        ca: caBundle,
        passphrase: process.env.HMLR_KEY_PASSPHRASE ?? undefined,
        keepAlive: true,
      })
      return this.agent
    }

    const certPath = process.env.HMLR_CERT_PATH?.trim()
    const keyPath = process.env.HMLR_KEY_PATH?.trim()
    if (certPath && keyPath) {
      const certAbs = this.absolutise(certPath)
      const keyAbs = this.absolutise(keyPath)
      this.assertFile(certAbs, 'HMLR_CERT_PATH')
      this.assertFile(keyAbs, 'HMLR_KEY_PATH')
      // HMLR's intermediates / root CA aren't in Node's default trust store,
      // so we have to add them via `ca`. The catch: passing `ca` REPLACES
      // Node's built-in CA bundle entirely, so we splice HMLR's chain in
      // alongside `tls.rootCertificates` instead of replacing them outright.
      // Loading via `.pfx` doesn't hit this because Node merges PFX-bundled
      // CAs with the defaults — switching to PEM means we do it manually.
      const caPath = process.env.HMLR_CA_PATH?.trim()
      const caBundle: string[] = [...tls.rootCertificates]
      if (caPath) {
        const caAbs = this.absolutise(caPath)
        this.assertFile(caAbs, 'HMLR_CA_PATH')
        caBundle.push(fs.readFileSync(caAbs, 'utf8'))
      }
      this.agent = new https.Agent({
        cert: fs.readFileSync(certAbs),
        key: fs.readFileSync(keyAbs),
        ca: caBundle,
        passphrase: process.env.HMLR_KEY_PASSPHRASE ?? undefined,
        keepAlive: true,
      })
      return this.agent
    }

    const pfxPath = process.env.HMLR_PFX_PATH?.trim() || './secrets/hmlr/test.pfx'
    const pfxAbs = this.absolutise(pfxPath)
    this.assertFile(
      pfxAbs,
      'HMLR_PFX_PATH (or set HMLR_CERT_PATH + HMLR_KEY_PATH)',
    )
    this.agent = new https.Agent({
      pfx: fs.readFileSync(pfxAbs),
      passphrase: process.env.HMLR_PFX_PASSPHRASE ?? '',
      keepAlive: true,
    })
    return this.agent
  }

  private absolutise(p: string): string {
    return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p)
  }

  private assertFile(p: string, envName: string): void {
    if (!fs.existsSync(p)) {
      throw new Error(
        `HMLR client certificate not found at ${p}. ` +
          `Set ${envName} to point at the file.`,
      )
    }
  }

  /**
   * Run an Online Owner Verification against HM Land Registry.
   * Returns a typed result; throws only on network / cert / malformed XML.
   */
  async verifyOwnership(
    input: VerifyOwnershipInput,
  ): Promise<VerifyOwnershipResult> {
    const messageId = input.messageId || this.makeMessageId()
    const envelope = this.buildEnvelope(messageId, input)
    this.logger.debug(`OOV → ${this.endpoint} (MessageId=${messageId})`)
    if (process.env.HMLR_DEBUG === '1') {
      // eslint-disable-next-line no-console
      console.log('--- OOV REQUEST XML ---\n' + envelope + '\n-----------------------')
    }
    const xml = await this.post(envelope)
    try {
      const parsed = this.parseResponse(xml)
      return { ...parsed, raw: xml, rawRequest: envelope, messageId }
    } catch (e) {
      // Re-throw with the request body appended so it's obvious which bytes
      // produced the schema fault.
      const err = e as Error
      err.message =
        err.message +
        '\n\n--- request body (sent) ---\n' +
        envelope.slice(0, 4000)
      throw err
    }
  }

  // ── Envelope construction ─────────────────────────────────────

  private makeMessageId(): string {
    const d = new Date()
    const stamp =
      d.getFullYear().toString() +
      pad(d.getMonth() + 1) +
      pad(d.getDate()) +
      '-' +
      pad(d.getHours()) +
      pad(d.getMinutes()) +
      pad(d.getSeconds())
    const rand = Math.floor(Math.random() * 1e4)
      .toString()
      .padStart(4, '0')
    return `OnlineOwnershipVerification-${stamp}-${rand}`
  }

  private buildEnvelope(
    messageId: string,
    input: VerifyOwnershipInput,
  ): string {
    const subject = 'titleNumber' in input.subject
      ? `<oov:TitleNumber>${xmlEscape(input.subject.titleNumber)}</oov:TitleNumber>`
      : `<oov:PropertyAddress>${this.renderAddress(input.subject.address)}</oov:PropertyAddress>`

    const indicators: string[] = []
    if (input.options?.continueIfOutOfHours !== undefined) {
      indicators.push(
        renderIndicator(
          'ContinueIfOutOfHours',
          input.options.continueIfOutOfHours,
        ),
      )
    }
    if (input.options?.skipPartialMatching !== undefined) {
      indicators.push(
        renderIndicator(
          'SkipPartialMatching',
          input.options.skipPartialMatching,
        ),
      )
    }
    if (input.options?.skipHistoricalMatching !== undefined) {
      indicators.push(
        renderIndicator(
          'SkipHistoricalMatching',
          input.options.skipHistoricalMatching,
        ),
      )
    }
    // Always include a ContinueIfOutOfHours indicator (defaults true). The
    // stub treats absence as "false" in one of the test scenarios, so being
    // explicit is safer.
    if (input.options?.continueIfOutOfHours === undefined) {
      indicators.unshift(renderIndicator('ContinueIfOutOfHours', true))
    }

    const middleName = input.middleName
      ? `<oov:MiddleName>${xmlEscape(input.middleName)}</oov:MiddleName>`
      : ''

    // Doc/literal wrapped SOAP per the WSDL: the body holds a
    // `<tns:verifyOwnership>` operation wrapper (tns =
    // http://ownershipv1_0.ws.bg.lr.gov/) containing one unqualified `<in>`
    // element of type RequestOnlineOwnershipVerificationType. The OOV-typed
    // fields inside `<in>` go in the OOV request namespace via the `oov:`
    // prefix.
    const oovFields =
      `<oov:MessageId>${xmlEscape(messageId)}</oov:MessageId>` +
      `<oov:Reference>${xmlEscape(input.reference)}</oov:Reference>` +
      `<oov:SubjectProperty>${subject}</oov:SubjectProperty>` +
      `<oov:FirstForename>${xmlEscape(input.forename)}</oov:FirstForename>` +
      middleName +
      `<oov:Surname>${xmlEscape(input.surname)}</oov:Surname>` +
      `<oov:Indicators>${indicators.join('')}</oov:Indicators>`

    const operationBody =
      '<tns:verifyOwnership xmlns:tns="http://ownershipv1_0.ws.bg.lr.gov/" ' +
      'xmlns:oov="http://www.landregistry.gov.uk/OOV/RequestOnlineOwnershipVerificationV1_0">' +
      '<in>' +
      oovFields +
      '</in>' +
      '</tns:verifyOwnership>'

    return (
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">' +
      '<soapenv:Header>' +
      '<wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">' +
      '<wsse:UsernameToken>' +
      `<wsse:Username>${xmlEscape(this.username)}</wsse:Username>` +
      `<wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${xmlEscape(this.password)}</wsse:Password>` +
      '</wsse:UsernameToken>' +
      '</wsse:Security>' +
      '<i18n:international xmlns:i18n="http://www.w3.org/2005/09/ws-i18n">' +
      '<i18n:locale>en</i18n:locale>' +
      '</i18n:international>' +
      '</soapenv:Header>' +
      '<soapenv:Body>' +
      operationBody +
      '</soapenv:Body>' +
      '</soapenv:Envelope>'
    )
  }

  private renderAddress(a: OvPropertyAddress): string {
    const parts: string[] = []
    if (a.buildingName) parts.push(`<oov:BuildingName>${xmlEscape(a.buildingName)}</oov:BuildingName>`)
    if (a.buildingNumber) parts.push(`<oov:BuildingNumber>${xmlEscape(a.buildingNumber)}</oov:BuildingNumber>`)
    if (a.streetName) parts.push(`<oov:StreetName>${xmlEscape(a.streetName)}</oov:StreetName>`)
    if (a.cityName) parts.push(`<oov:CityName>${xmlEscape(a.cityName)}</oov:CityName>`)
    if (a.postcode) parts.push(`<oov:PostcodeZone>${xmlEscape(a.postcode)}</oov:PostcodeZone>`)
    if (a.specificTenure) parts.push(`<oov:SpecificTenure>${xmlEscape(a.specificTenure)}</oov:SpecificTenure>`)
    return parts.join('')
  }

  // ── HTTPS transport ────────────────────────────────────────────

  private post(body: string): Promise<string> {
    const url = new URL(this.endpoint)
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: url.hostname,
          port: url.port || 443,
          path: url.pathname + url.search,
          method: 'POST',
          agent: this.getAgent(),
          headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            SOAPAction: '""',
            'Content-Length': Buffer.byteLength(body, 'utf8'),
          },
        },
        (res) => {
          const chunks: Buffer[] = []
          res.on('data', (c) => chunks.push(c))
          res.on('end', () => {
            const data = Buffer.concat(chunks).toString('utf8')
            // HMLR returns 200 even for SOAP faults — only treat network /
            // transport failures (4xx/5xx) as throws. SOAP-level errors
            // surface as TypeCode=20 (Rejection) and are returned to caller.
            if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
              reject(
                new Error(
                  `HMLR transport ${res.statusCode}: ${data.slice(0, 600)}`,
                ),
              )
              return
            }
            resolve(data)
          })
        },
      )
      req.on('error', reject)
      req.write(body)
      req.end()
    })
  }

  // ── Response parsing ───────────────────────────────────────────

  private parseResponse(
    xml: string,
  ): Omit<VerifyOwnershipResult, 'raw' | 'rawRequest' | 'messageId'> {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      removeNSPrefix: true,
      isArray: (name) =>
        ['Match', 'MatchInformation', 'MatchDetails', 'ValidationErrors'].includes(
          name,
        ),
      // Keep all values as strings so we can decide how to coerce per field.
      parseTagValue: false,
      parseAttributeValue: false,
      trimValues: true,
    })
    let obj: any
    try {
      obj = parser.parse(xml)
    } catch (e) {
      throw new Error(`HMLR response XML parse failed: ${(e as Error).message}`)
    }

    // Doc/literal wrapped response: Envelope → Body → verifyOwnershipResponse
    //   → return (which itself is the ResponseOnlineOwnershipVerificationType
    //     content — TypeCode, Result / Acknowledgement / Rejection, …).
    // Fall back to the old `ResponseOOV` shape in case the live service
    // ever ships an element-form variant.
    const body = obj?.Envelope?.Body
    const r =
      body?.verifyOwnershipResponse?.return ??
      body?.ResponseOOV ??
      obj?.ResponseOOV
    if (!r) {
      // Surface a SOAP Fault if present, with every detail we can dig out.
      const fault = obj?.Envelope?.Body?.Fault
      if (fault) {
        const code = fault.faultcode || fault.Code?.Value || ''
        const str = fault.faultstring || fault.Reason?.Text || ''
        // Flatten the fault.detail tree — HMLR puts the actual schema
        // validation messages here, often nested under <SchemaErrors>, so
        // walk it and pull every text/Code/Description we find.
        const detailMsgs = collectFaultDetails(fault.detail || fault.Detail)
        const summary =
          detailMsgs.length > 0 ? `\n  ${detailMsgs.join('\n  ')}` : ''
        const xmlSnippet = `\n\n--- raw response (first 4k) ---\n${xml.slice(0, 4000)}`
        throw new Error(
          `HMLR SOAP Fault: ${code} ${str}${summary}${xmlSnippet}`,
        )
      }
      throw new Error(
        `HMLR unexpected response (no ResponseOOV, no Fault):\n${xml.slice(0, 4000)}`,
      )
    }

    const typeCode = Number(r.TypeCode) as OvTypeCode

    if (typeCode === 10 && r.Acknowledgement) {
      const a = r.Acknowledgement
      const ack: OvAcknowledgement = {
        uniqueId: String(a.UniqueID ?? ''),
        expectedResponseDateTime: String(a.ExpectedResponseDateTime ?? ''),
        messageDescription: String(a.MessageDescription ?? ''),
      }
      return { typeCode, acknowledgement: ack }
    }

    if (typeCode === 20 && r.Rejection) {
      const j = r.Rejection
      const rej: OvRejection = {
        reason: String(j.Reason ?? ''),
        code: String(j.Code ?? ''),
        otherDescription: j.OtherDescription
          ? String(j.OtherDescription)
          : undefined,
        validationErrors: toArray(j.ValidationErrors).map((v: any) => ({
          code: String(v.Code ?? ''),
          description: String(v.Description ?? ''),
        })),
        reference: j.Reference ? String(j.Reference) : undefined,
      }
      return { typeCode, rejection: rej }
    }

    if (typeCode === 30 && r.Result) {
      const result = this.parseResult(r.Result)
      return { typeCode, result }
    }

    throw new Error(
      `HMLR response had TypeCode=${typeCode} but no matching payload: ${xml.slice(
        0,
        600,
      )}`,
    )
  }

  private parseResult(res: any): OvResult {
    return {
      message: res.Message ? String(res.Message) : undefined,
      reference: String(res.Reference ?? ''),
      matchResult: res.MatchResult as OvResult['matchResult'],
      matches: toArray(res.Match).map((m: any) => this.parseMatch(m)),
    }
  }

  private parseMatch(m: any): OvMatch {
    const subject = m.SubjectProperty ?? {}
    const address = subject.PropertyAddress
    return {
      titleNumber: subject.TitleNumber ? String(subject.TitleNumber) : undefined,
      address: address
        ? {
            buildingName: address.BuildingName ? String(address.BuildingName) : undefined,
            buildingNumber: address.BuildingNumber ? String(address.BuildingNumber) : undefined,
            streetName: address.StreetName ? String(address.StreetName) : undefined,
            cityName: address.CityName ? String(address.CityName) : undefined,
            postcode: address.PostcodeZone ? String(address.PostcodeZone) : undefined,
            specificTenure: address.Tenure || address.SpecificTenure || undefined,
          }
        : undefined,
      surnameMatch: this.parseMatchType(m.SurnameMatch),
      forenameMatch: this.parseMatchType(m.ForenameMatchDetails),
      middleNameMatch: this.parseMatchType(m.MiddleNameMatchDetails),
      stringMatch: this.parseMatchType(m.StringMatchDetails),
      info: this.pairsToRecord(m.MatchInformation),
    }
  }

  private parseMatchType(t: any): OvMatchType | undefined {
    if (!t) return undefined
    return {
      typeOfMatch: t.TypeOfMatch,
      details: this.pairsToRecord(t.MatchDetails),
    }
  }

  private pairsToRecord(pairs: any): Record<string, string> {
    const out: Record<string, string> = {}
    for (const p of toArray(pairs)) {
      if (p && p.Name != null) out[String(p.Name)] = String(p.Value ?? '')
    }
    return out
  }
}

// ── Helpers ──────────────────────────────────────────────────────

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}

function xmlEscape(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function renderIndicator(type: string, value: boolean | string): string {
  return (
    '<oov:Indicator>' +
    `<oov:IndicatorType>${type}</oov:IndicatorType>` +
    `<oov:IndicatorValue>${value}</oov:IndicatorValue>` +
    '</oov:Indicator>'
  )
}

function toArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return []
  return Array.isArray(v) ? v : [v]
}

/** Walk a SOAP fault detail tree and pull every text node, code, and
 *  description out for an error message. HMLR uses several shapes here. */
function collectFaultDetails(node: any, out: string[] = []): string[] {
  if (node == null) return out
  if (typeof node === 'string') {
    const s = node.trim()
    if (s) out.push(s)
    return out
  }
  if (Array.isArray(node)) {
    for (const v of node) collectFaultDetails(v, out)
    return out
  }
  if (typeof node === 'object') {
    // Common HMLR shapes: { Code, Description }, { ErrorMessage }, { #text }.
    if (node.Code || node.Description) {
      out.push(`[${node.Code ?? ''}] ${node.Description ?? ''}`.trim())
    }
    for (const [k, v] of Object.entries(node)) {
      if (k.startsWith('@_')) continue
      if (k === 'Code' || k === 'Description') continue
      collectFaultDetails(v, out)
    }
  }
  return out
}
