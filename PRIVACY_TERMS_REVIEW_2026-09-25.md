# UmovingU — Privacy Policy, Terms & Cookie Policy Review

**Date:** 2026-09-25
**Scope:** `pages/legal/privacy.vue`, `pages/legal/terms.vue`, `pages/legal/cookies.vue` in both `umu-website-integration` and `umu-mobile-webapp` (identical legal text in both, different page markup — confirmed via diff). Checked against what the product actually does today (backend `payment.service.ts`, `kyc.service.ts`, third-party integrations listed in `DEPLOYMENT.md`, and the frontend's own auth/cookie implementation).

**⚠️ Not legal advice.** I'm not a solicitor and this isn't a substitute for one. The findings below are a factual accuracy check — "does the document describe what the product actually does" — which is the part I can verify directly against the code. The drafted replacement text at the end is a solid starting point, but given real money is being charged and identity documents are being collected, **have a UK solicitor with data protection/consumer law experience review the final wording before it goes live.** The riskiest mistakes here (getting the legal basis for identity-document processing wrong, getting international-transfer safeguards wrong, retention periods that don't match your actual regulatory obligations) are exactly the kind a specialist needs to sign off on, not an AI.

---

## Executive summary

The testers are right, and the problem is worse than "could lead to fines" — the current Terms of Service contains a **false statement about pricing** that contradicts what the app actually charges today, and the Privacy Policy contains a **false statement about not collecting identity documents** when it does (via Persona KYC). Both documents were written in March 2025 for an early-access landing page that collected a name and email via a contact form. The product has since grown into a platform that: charges real money (three different pricing models), collects government ID documents for identity verification, runs HM Land Registry and Companies House checks, processes data through an AI/LLM provider, and shares data with roughly a dozen third parties — none of which the current documents mention.

**This isn't a wording-polish job — the documents describe a different, earlier product.** They need a substantive rewrite, not an edit pass.

---

## Findings

### 1. CRITICAL — Terms of Service falsely states the service is free

**File:** `pages/legal/terms.vue`, Section 07 "Pricing and payment":
> "Early access is currently free. Paid features may be introduced with clear advance notice and explicit user agreement before charges apply."

**Reality, confirmed from `payment.service.ts`:**
- Owner property claims are charged **£8.99–£19.99** today, tiered by what verification is still outstanding (KYC only: £8.99; HMLR ownership check only: £12.99; both: £19.99).
- Buyer passport unlock is charged **£99.00**.
- The tradesperson marketplace charges a **10% platform fee** on top of every job amount (escrow-held).

None of this is "early access... currently free." A user reading this page before paying is being told something false about what they're about to be charged for — that's not just a GDPR problem, it's a **Consumer Contracts (Information, Cancellation and Additional Charges) Regulations 2013** and **Consumer Protection from Unfair Trading Regulations 2008** problem: UK consumer law requires the total price (or how it's calculated) to be given clearly before a consumer is bound to pay, and a business misrepresenting whether something is free is a textbook unfair commercial practice. This is enforced by Trading Standards/the CMA, separately from the ICO's GDPR remit — so "fines from the UK government" is accurate on two separate fronts, not one.

**Fix:** Terms need a real, accurate pricing section naming the actual charges (or at minimum stating clearly that fees apply and pointing to where current pricing is shown in-app, if you'd rather not hardcode figures that change). Either way, "currently free" has to go.

### 2. CRITICAL — Privacy Policy falsely states no identity documents are collected

**File:** `pages/legal/privacy.vue`, Section 02:
> "The company does not collect payment card details, health information, or government identity documents at this stage."

**Reality:** The KYC module integrates with Persona to verify identity as part of the property-claim flow — this collects government-issued ID documents (and, depending on Persona's configured product, likely a selfie/liveness check, which is **biometric data — UK GDPR Article 9 "special category" data**, requiring a stronger legal basis than ordinary personal data and much more careful disclosure than a single line).

This is the single most consequential gap in the whole review. Special category data mishandling is one of the areas the ICO takes most seriously, and "we told users we don't collect this, but we do" is about as bad as a factual inaccuracy gets in a privacy policy.

**Fix:** A dedicated section on identity verification: what's collected, why (fraud prevention / confirming you own the property you're claiming), the legal basis (this needs your solicitor's sign-off — likely explicit consent, or the "prevention of fraud" substantial-public-interest condition under Schedule 1 of the Data Protection Act 2018, but which one applies and how it's worded matters), how long it's kept, and that Persona (a named third party, US-based) processes it.

### 3. HIGH — Payment processor never disclosed as a third party

Stripe is not named anywhere in the Privacy Policy's "who we share your information with" section, despite handling every payment on the platform. The policy correctly says card details aren't collected *by UmovingU* (true — Stripe tokenizes them), but that's not the same as disclosing that Stripe processes payment data at all, which UK GDPR requires.

### 4. HIGH — Around a dozen real third-party processors are undisclosed

The Privacy Policy's "who we share your information with" section lists four recipients: Google Analytics, Mailchimp, "OpenProperty Tech Ltd," and legal/regulatory authorities. Checked against what's actually integrated (`DEPLOYMENT.md`'s secrets list and the codebase's service integrations), the real list is substantially longer:

| Third party | What it actually processes | Currently disclosed? |
|---|---|---|
| Stripe | Payment card data, billing | ❌ No |
| Persona | Government ID documents, likely biometric/liveness data | ❌ No |
| HM Land Registry | Name + address, for ownership verification (via a government Business Gateway API, using your own mTLS certs) | ❌ No |
| Companies House | Company number lookups (when a user adds a company) | ❌ No |
| Groq | Chat messages and property data sent to an LLM for AI chat/passport summaries | ❌ No |
| Resend | Email address + content, for OTP/transactional emails | ❌ No |
| AWS (App Runner, RDS, S3, SNS) | Hosts all data; S3 stores uploaded documents/photos; SNS delivers push notifications | ❌ No |
| Ordnance Survey (OS Places) | Address/property lookups | ❌ No |
| EPC Register | Energy performance data tied to an address | ❌ No |
| Google Maps / Street View | Address geocoding, street imagery | ❌ No |
| Mapbox | Map rendering | ❌ No |
| A council-tax lookup API | Address → council tax band | ❌ No |
| Ofcom broadband API | Address → broadband availability | ❌ No |

**Fix:** A real sub-processor list. This also needs an **international transfers** section — Persona, Stripe, and Groq in particular are US-headquartered; even where a company has UK/EU entities, you should confirm (with them, or your solicitor) what transfer safeguard applies (UK International Data Transfer Agreement / the UK Addendum to the EU SCCs is the usual mechanism) and say so in the policy. AWS hosting is in `eu-west-2` (London), which is fine and worth stating explicitly as a point in your favour.

### 5. HIGH — Cookie Policy describes cookies that don't exist, and misses the one that does

**File:** `pages/legal/cookies.vue` lists `u_session`, `u_csrf`, `u_consent`, `_ga`, `_ga_[ID]` (Google Analytics).

**Reality, confirmed from the codebase:**
- Authentication is **not cookie-based at all** — the app uses a Bearer JWT stored in `localStorage`, sent as an `Authorization` header. There is no `u_session` cookie, no `u_csrf` cookie (there's nothing to CSRF-protect, since there's no cookie-based auth to forge requests against), and no cookie-based consent-recording mechanism matching `u_consent`.
- **Google Analytics is not integrated anywhere in the codebase** — no `gtag`/`ga` script, no GA plugin. The policy describes tracking that isn't happening.
- The one **real** cookie in the app is `umu_has_session` (`composables/useSessionFlag.ts`) — a small, non-secret, essential routing-hint cookie that lets the server guess whether to server-render a signed-in or signed-out landing page. It carries no session data itself and grants no access (every real request is still gated by the JWT). It isn't in the current cookie table at all.

**Fix:** Replace the fictional cookie table with the real one (currently just `umu_has_session`, essential-only), and drop the Google Analytics section unless/until GA is actually added — an inaccurate cookie policy is its own (smaller, but real) compliance gap under PECR (the Privacy and Electronic Communications Regulations), which requires cookie disclosures to match what's actually set.

### 6. MEDIUM — Retention periods don't account for KYC, payment, or marketplace records

The current retention table (contact enquiries: 2 years; Passport records: active + 2 years; analytics: 26 months) has no line for: identity-verification records, payment/transaction records, or marketplace escrow/dispute records. These typically have their own retention drivers — UK tax law generally expects financial records kept ~6 years, and if any part of the identity-check flow is treated as anti-fraud/AML-adjacent, that can carry its own retention expectation. **This is a case where your solicitor/accountant should confirm exact periods** rather than me inventing numbers — I've used reasonable placeholders in the draft below and flagged them.

### 7. MEDIUM — No pre-contract pricing disclosure at the point of payment mentioned in Terms

Beyond Section 7's false "it's free" statement, there's no general commitment that pricing will be shown clearly before a user commits to pay (a Consumer Contracts Regulations 2013 requirement) or how refunds/cancellations work for a paid digital service. Given the tiered owner-claim pricing depends on state the user may not fully understand (which tier applies to them), this is worth being explicit about.

### 8. LOW — Company/ICO details need a currency check, not a content check

I can't independently verify Company No. 13321548 or ICO registration ZC111880 are still current/correct — that's a five-minute Companies House/ICO register check on your end, but worth doing given how much else on the page turned out to be stale. Also: "Last updated March 2025" should obviously change once this is republished, and going forward this page needs to be part of the checklist whenever a new paid feature, data source, or third-party integration ships.

### 9. LOW — Two copies of the same text, one of which is on a superseded app

Confirmed (via diff) that `umu-mobile-webapp` carries the identical legal text, just different page markup. Per the separate security review, `umu-mobile-webapp` is the superseded predecessor to `umu-website-integration` — but if its Vercel deployment is still publicly reachable, it's still a live legal document with the same false statements. Update both, or take the old deployment down as part of retiring that app.

---

## Suggested replacement text

Below are full drafts for all three pages, written to match the actual product. Treat every `[ ]` bracket as something that needs a real answer from you or your solicitor before publishing — I've been explicit about where I'm placeholdering rather than guessing.

### Privacy Policy (draft)

```markdown
# Privacy Policy

Last updated: [DATE OF PUBLICATION] · Controller: umovingu Limited · ICO registration: ZC111880 [CONFIRM STILL CURRENT]

## 1. Who we are

umovingu Limited operates the UmovingU Property Passport platform — for sellers, landlords and buyers
to build, verify, store and share property documentation. Registered in England and Wales,
Company No. 13321548 [CONFIRM STILL CURRENT], registered office 116 Yardley Road, Birmingham, B27 6LG.
umovingu Limited is the data controller for the personal data described in this policy.
Contact: hello@umovingu.io.

## 2. What information we collect

Depending on how you use the platform, we collect:

- **Account information**: name, email address, phone number, date of birth, postcode.
- **Property information**: property address, ownership details, EPC and energy data, uploaded
  certificates, disclosures, photos and documents you add to a Property Passport.
- **Identity verification documents**: when you claim ownership of a property, we ask you to verify
  your identity via our identity-verification partner, Persona. This may include a government-issued
  ID document (e.g. passport, driving licence) and a selfie/liveness check. This is special category
  data under UK GDPR and is processed on the basis of [LEGAL BASIS — CONFIRM WITH YOUR SOLICITOR:
  likely explicit consent, or the substantial-public-interest "prevention of fraud" condition under
  the Data Protection Act 2018, Schedule 1]. We do not see or store the raw document images ourselves —
  Persona processes them and returns a verification result to us.
- **Ownership verification data**: your name and the property address, checked against HM Land
  Registry's records to confirm you're the registered owner.
- **Company information**: if you add a company (e.g. as a landlord operating through a limited
  company), your company number, checked against Companies House.
- **Payment information**: handled entirely by our payment processor, Stripe — we do not collect or
  store your card details. We do keep a record that a payment was made, for which service, and the
  amount charged.
- **Communications**: messages you send through the platform (e.g. to a buyer, seller, or
  tradesperson), support requests, and AI chat conversations with our in-app assistant.
- **Marketplace activity**: if you use the tradesperson marketplace, job details, photos, offers,
  messages, reviews, and (for tradespeople) payout information.
- **Technical and usage data**: device/browser information, IP address, and how you interact with
  the app, including a small essential cookie described in our Cookie Policy.
- **Push notification tokens**: if you enable push notifications, a device token used to deliver them.

## 3. Our legal basis for using your information

- **Contract**: to create and manage your account, Property Passport, and any paid service you
  purchase.
- **Legal obligation**: to comply with anti-fraud, tax/accounting, and other legal requirements.
- **Consent**: for marketing communications and identity verification [CONFIRM — see §2], withdrawable
  at any time.
- **Legitimate interests**: to keep the platform secure, prevent fraud, and improve our service using
  aggregated/anonymised data.

## 4. How we use your information

- Create, verify and manage Property Passports and ownership claims.
- Process payments for paid features (see our pricing, shown clearly before you're charged).
- Verify your identity and property ownership, to prevent fraudulent claims.
- Send transactional communications (verification codes, receipts, updates about your Passport).
- Power our AI assistant, which uses a third-party AI provider (Groq) to answer questions about your
  Passport and summarise information — chat content you send is processed by Groq for this purpose.
- Operate the tradesperson marketplace, including payments and dispute resolution.
- Respond to support requests.
- Send marketing communications, only with your consent.
- Comply with legal obligations and enforce our Terms of Service.

We do not sell your information. We do not use automated decision-making that produces legal or
similarly significant effects on you without human involvement.

## 5. Who we share your information with

We share information with the following categories of recipient, each acting as a processor or
independent controller as applicable:

| Recipient | What they receive | Why |
|---|---|---|
| Stripe | Payment details, transaction records | Payment processing |
| Persona | Identity documents, verification results | Identity verification |
| HM Land Registry | Name, property address | Ownership verification (statutory/government body) |
| Companies House | Company number | Company verification (statutory/government body) |
| Groq | Chat messages, relevant Passport data | AI assistant functionality |
| Resend | Email address, email content | Sending you emails |
| Amazon Web Services | All platform data, as our hosting provider | Hosting, storage, infrastructure (hosted in the UK — `eu-west-2`, London) |
| Ordnance Survey, EPC Register, Google Maps, Mapbox, [council-tax data provider], Ofcom | Property address | Property search and enrichment |
| Other users you choose to share with | Whatever you choose to include in a shared Passport link, collaborator invite, or marketplace listing | You control this |
| Legal or regulatory authorities | As required | Legal compliance |

### International transfers

Some of our processors (including Persona, Stripe and Groq) may process data outside the UK,
including in the United States. Where this happens, we rely on [SAFEGUARD — CONFIRM: typically the UK
International Data Transfer Agreement, or the UK Addendum to the EU Standard Contractual Clauses,
or an adequacy decision where one applies] to ensure your data remains protected to UK standards.

## 6. How long we keep your information

- Account and Property Passport data: for as long as your account is active, plus up to 2 years after
  closure (so a former owner/buyer relationship can still be referenced if needed).
- Identity verification records: [PERIOD — CONFIRM WITH SOLICITOR/COMPLIANCE — commonly retained
  longer than ordinary account data for fraud-prevention purposes].
- Payment and transaction records: [PERIOD — CONFIRM — UK tax/accounting law generally expects
  financial records to be kept around 6 years].
- Marketplace job, payment and dispute records: [PERIOD — CONFIRM, likely aligned with payment
  records above].
- Marketing preferences: until you withdraw consent.
- Support/contact enquiries: 2 years.

## 7. Your rights

Under UK GDPR, you can exercise the following rights by emailing hello@umovingu.io — we'll respond
within one month:

- **Access** — confirm what we hold and get a copy.
- **Rectification** — correct inaccurate or incomplete information.
- **Erasure** — ask us to delete your information, in certain circumstances.
- **Restriction** — pause our use of your information while a dispute is resolved.
- **Portability** — receive your information in a portable format.
- **Object** — object to processing based on legitimate interests.
- **Withdraw consent** — for marketing or identity verification consent, at any time (note: withdrawing
  identity-verification consent may mean we can't complete an ownership claim).

You can also complain to the ICO at ico.org.uk or 0303 123 1113.

## 8. Security

- Encrypted transmission (HTTPS) between your device and our servers.
- Sensitive documents are stored with restricted, signed access — not publicly reachable URLs.
- Passwords are stored as one-way hashes, never in plain text.
- Payment card data is never touched by our own systems — it goes directly to Stripe.
- Access to production systems is restricted to authorised team members.
- We notify the ICO within 72 hours of becoming aware of a breach likely to affect your rights.

## 9. Children

The service is not directed at children under 16 and requires users to be at least 18. If you believe
a child has provided us with information, please contact us.

## 10. Contact us

Email: hello@umovingu.io
Post: umovingu Limited, 116 Yardley Road, Birmingham, B27 6LG
Company No. 13321548

umovingu Limited · ICO registration ZC111880
```

### Terms of Service (draft)

```markdown
# Terms of Service

Last updated: [DATE OF PUBLICATION] · Governing law: England & Wales

## 1. Who we are and what we provide

umovingu Limited (Company No. 13321548, 116 Yardley Road, Birmingham, B27 6LG) operates the
UmovingU Property Passport platform: a tool for sellers, landlords and buyers to build, verify,
store and share property documentation, and (via our marketplace) connect with tradespeople for
property-related work.

## 2. Accepting these terms

By creating an account or using any part of the service, you agree to these terms. You must be at
least 18 years old.

## 3. What we provide, and what we don't

We provide tools for organising, verifying, storing and sharing property-related information. We are
not solicitors, conveyancers, financial advisers, surveyors, or estate agents, and nothing on the
platform is legal, financial, mortgage or property advice. We don't guarantee a faster sale, prevent
a transaction from falling through, or guarantee lender acceptance of any document.

## 4. Your account and your responsibilities

You must:
- Provide accurate information, including about yourself and any property you claim or list.
- Keep your login credentials secure.
- Tell us immediately if you think your account has been compromised.
- Only upload or share documents you have the right to share.
- Not misrepresent a property's condition, upload someone else's documents without permission, or use
  the service unlawfully.

## 5. Identity and ownership verification

Some features — including claiming a property as an owner and unlocking a Passport as a buyer —
require identity and/or ownership verification. This may involve submitting identity documents to our
verification partner and/or checks against HM Land Registry or Companies House records. Providing
false information for verification purposes is a serious breach of these terms and may be reported to
the relevant authorities.

## 6. Pricing and payment

The following fees currently apply [KEEP THIS SECTION IN SYNC WITH ACTUAL PRICING — CONSIDER LINKING
TO AN IN-APP PRICING PAGE INSTEAD OF HARDCODING FIGURES HERE, SO IT CAN NEVER GO STALE AGAIN]:

- **Claiming a property as an owner**: £8.99–£19.99, depending on what verification you need
  (identity verification only, ownership verification only, or both). The exact price is always shown
  before you pay.
- **Unlocking a Property Passport as a buyer**: £99.00.
- **Marketplace jobs**: a 10% platform fee is added to the job amount you agree with a tradesperson,
  held in escrow until the job is confirmed complete.

All prices are shown in full, including any fees, before you're asked to confirm payment. Payments
are processed by Stripe. [ADD: refund/cancellation policy, consistent with the Consumer Contracts
Regulations 2013 — CONFIRM WITH SOLICITOR what cooling-off rights apply to a digital service that's
fully performed once the verification/unlock happens.]

## 7. Availability and changes to the service

We aim for the service to be available at all times but can't guarantee uninterrupted access.
Features may be added, changed, or removed. We'll give reasonable notice of significant changes,
including to pricing.

## 8. Your content

You own the documents and information you upload. By uploading, you grant us a licence to store,
process, and share your content as you instruct (e.g. via a share link or with a collaborator) and as
needed to provide the service. We claim no ownership over your content. Deleting your account results
in deletion of your content, as described in our Privacy Policy.

## 9. Sharing your Passport

You control who can see your Property Passport and for how long, and can revoke access at any time.
We're not responsible for what a third party does with information after you've shared it with them.

## 10. The marketplace

If you use the marketplace as a customer or a tradesperson, additional terms apply: payments are held
in escrow until you confirm a job is complete; disputes are handled per [DISPUTE PROCESS — CONFIRM];
tradespeople are independent contractors, not umovingu employees or agents, and we don't guarantee
the quality of their work — we facilitate the connection and payment, we don't perform the work.

## 11. Our liability to you

We're not liable for losses that weren't reasonably foreseeable, losses caused by your own actions,
losses arising from inaccurate information you uploaded, or business losses (including lost profits).
For free services, our total liability is limited to £100 per claim. For paid services, our liability
is limited to the amount you paid us for that service in the 12 months before the claim [CONFIRM THIS
CAP WITH YOUR SOLICITOR — NOW THAT REAL MONEY CHANGES HANDS, THIS CLAUSE NEEDS PROPER REVIEW, NOT JUST
A COPY OF THE OLD FREE-SERVICE WORDING]. Nothing in these terms limits our liability for death or
personal injury caused by negligence, fraud, or anything that can't be excluded by law.

## 12. Intellectual property

All platform content — text, design, graphics, software, and the Property Passport concept — belongs
to umovingu Limited or our licensors. Our name, logo and branding are protected. You need our written
consent to use them.

## 13. Closing your account

You can close your account at any time by emailing hello@umovingu.io. We'll action this within 10
working days. [CONFIRM: what happens to any pending payments, escrow funds, or in-progress
verification at the point of closure.]

## 14. Governing law and disputes

These terms are governed by the law of England and Wales, and disputes fall under the exclusive
jurisdiction of the English and Welsh courts. Please contact hello@umovingu.io first — most issues
are resolved through direct conversation.

umovingu Limited · 116 Yardley Road, Birmingham, B27 6LG · Company No. 13321548 · ICO registration ZC111880
```

### Cookie Policy (draft)

```markdown
# Cookie Policy

Last updated: [DATE OF PUBLICATION]

## What are cookies

Cookies are small text files placed on your device when you use our site or app. We keep this list
short and accurate — it only contains cookies we actually set.

## Cookies we use

| Cookie | Category | Purpose | Duration |
|---|---|---|---|
| `umu_has_session` | Essential | A routing hint that tells our server whether you're likely signed in, so we can show you the right page immediately. It doesn't grant access to anything — every real request is separately authenticated. | 7 days [OR ALIGN TO YOUR REFRESH-TOKEN LIFETIME, CURRENTLY 30 DAYS] |

We don't currently use analytics, advertising, or tracking cookies. If that changes (for example, if
we add Google Analytics in future), we'll update this page and, where required, ask for your consent
first.

## Your choices

Because we only set one essential cookie needed for the site to work correctly, there's nothing to
opt out of today. If we introduce any non-essential cookie in future, we'll add a consent mechanism
here before it's set.

umovingu Limited · ICO registration ZC111880
```

---

## What I'd do next

1. Send the three drafts above to a UK solicitor with data protection/consumer law experience — specifically to confirm: the legal basis for identity-document processing (§2/§5 of the Privacy Policy draft), the international-transfer safeguard wording, the retention periods I've placeholdered, and the liability-cap clause in the Terms now that real payments are involved.
2. Once approved, update both `pages/legal/privacy.vue`, `pages/legal/terms.vue`, and `pages/legal/cookies.vue` in `umu-website-integration` (and `umu-mobile-webapp` if that deployment is still publicly reachable).
3. Consider linking the pricing section in the Terms to an in-app pricing display rather than hardcoding figures, so it can't drift out of sync with `payment.service.ts` again.
4. Add "update the legal pages" to the checklist for any future change that adds a new paid feature, a new data type collected, or a new third-party integration — this is exactly how the gap happened the first time.
