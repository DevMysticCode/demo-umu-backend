/**
 * Online Owner Verification (OOV) — typed input/output shapes that wrap the
 * HMLR Business Gateway SOAP messages. The wire format is XML; consumers in
 * this codebase work with these typed structures only.
 *
 * Spec: https://landregistry.github.io/bgtechdoc/documents/online_owner_verification/OOV_Interface_Spec.html
 */

export type SpecificTenure = 'freehold' | 'leasehold' | 'rentcharge'

export interface OvPropertyAddress {
  buildingName?: string
  buildingNumber?: string
  streetName?: string
  cityName?: string
  /** UK postcode (e.g. "PL1 1QQ"). HMLR validates server-side. */
  postcode?: string
  specificTenure?: SpecificTenure
}

export type OvSubjectProperty =
  | { titleNumber: string }
  | { address: OvPropertyAddress }

export interface OvOptions {
  /** If the service is out of hours, queue the request and return an
   *  acknowledgement instead of an immediate rejection. Defaults to true. */
  continueIfOutOfHours?: boolean
  /** Skip partial-match scoring (forename / surname phonetic + distance). */
  skipPartialMatching?: boolean
  /** Skip historical proprietor matching (only check current owners). */
  skipHistoricalMatching?: boolean
}

export interface VerifyOwnershipInput {
  /** Your case-management system reference — surfaces back on the response.
   *  Max 25 chars per the spec. */
  reference: string
  forename: string
  middleName?: string
  surname: string
  subject: OvSubjectProperty
  options?: OvOptions
  /** Optional explicit MessageId — useful for retries (same MessageId returns
   *  the original result). Defaults to an auto-generated value. */
  messageId?: string
}

/** TypeCode values per the OOV spec. */
export type OvTypeCode = 10 | 20 | 30

export interface OvAcknowledgement {
  uniqueId: string
  expectedResponseDateTime: string
  messageDescription: string
}

export interface OvRejection {
  reason: string
  code: string
  otherDescription?: string
  validationErrors?: Array<{ code: string; description: string }>
  reference?: string
}

export type OvMatchKind = 'MATCH' | 'NO_MATCH' | 'PARTIAL_MATCH' | 'SKIPPED'

export interface OvMatchType {
  typeOfMatch: OvMatchKind
  details?: Record<string, string>
}

export interface OvMatch {
  titleNumber?: string
  address?: OvPropertyAddress
  surnameMatch?: OvMatchType
  forenameMatch?: OvMatchType
  middleNameMatch?: OvMatchType
  stringMatch?: OvMatchType
  info: Record<string, string>
}

export type OvMatchResult = 'NO_MATCHES' | 'SINGLE_MATCH' | 'MULTIPLE_MATCHES'

export interface OvResult {
  message?: string
  reference: string
  matchResult: OvMatchResult
  matches: OvMatch[]
}

export interface VerifyOwnershipResult {
  typeCode: OvTypeCode
  acknowledgement?: OvAcknowledgement
  rejection?: OvRejection
  result?: OvResult
  /** Raw response XML — kept for audit logging. */
  raw: string
  /** MessageId we sent — needed for retry idempotency. */
  messageId: string
}
