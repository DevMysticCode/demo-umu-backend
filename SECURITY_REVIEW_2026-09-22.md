# UmovingU (UMU) — Internal Security Review

**Date:** 2026-09-22
**Scope:** `umu-backend` (NestJS 11 + Prisma + PostgreSQL) and `umu-website-integration` (Nuxt 3), static code review against local dev instances. No live AWS/Railway systems were touched.
**Method:** Authorized, report-only static analysis (read-only; no dynamic exploitation against a running server was performed in this pass — see "Out of scope" below). Six parallel review passes covering auth, authorization/IDOR, injection, business logic, web/API hygiene, and dependencies/secrets; the IDOR pass additionally fanned out module-by-module across all ~18 controllers.
**Status:** Report only. Nothing in this document has been fixed yet.

---

## Executive summary

The codebase has matured substantially since the last external review (DF4 Labs, June 2026): the `/auth/apple/mock` backdoor is gone (OAuth was removed entirely rather than patched), CORS is a real allowlist, helmet + a global exception filter are wired in, rate limiting covers the auth routes, the Stripe webhook is signature-verified, and payment amounts are computed server-side from fixed tiers. Authorization (IDOR) scoping is correct on the large majority of the ~150+ endpoints reviewed — ownership/collaborator checks are present and consistently implemented across passport, document, profile, marketplace, and verifier-API modules.

However, one **Critical** finding fully defeats the property-ownership fraud protection the KYC/HMLR/payment stack was built for, and a cluster of **High** findings around file uploads (stored XSS), a private-section visibility leak, and a couple of authorization gaps warrant fixing before public launch.

**Findings by severity:** 1 Critical · 10 High · 10 Medium · 12 Low/Info · 2 dependency-audit summaries

| Severity | Count |
|---|---|
| Critical | 1 |
| High | 10 |
| Medium | 10 |
| Low / Info | 12 |

---

## Findings (most severe first)

### CRITICAL

#### C1 — Ownership verification can be forged by any authenticated user
- **Endpoint:** `POST /property/:id/complete-verification`
- **Files:** `src/property/property.controller.ts:180-184`, `src/property/property.service.ts:5927-5953` (`completeVerification`)
- **Also implicated:** legacy frontend page `pages/verify-ownership/[id].vue` (still shipped/routed), which drives exactly this endpoint via a client-side `setTimeout` animation claiming "Successfully verified through GOV.UK One Login" — **no such integration exists anywhere in the backend**.
- **Description:** `completeVerification(propertyId, userId)` unconditionally upserts `OwnershipVerification.status = 'VERIFIED'` for the calling user against **any** `propertyId`, gated only by `JwtAuthGuard`. No HMLR match result, no real verification evidence, and no cross-check of any kind is performed. `activatePassport()` (`passport.service.ts:599-608`) trusts this field directly: `if (!ov || ov.status !== 'VERIFIED') throw ...` — it never re-checks `landRegistryMatchResult`.
- **PoC / reproduction:**
  1. `POST /property/<any-unclaimed-property-id>/complete-verification` with a valid JWT for any user (no relationship to the property required).
  2. The attacker's `OwnershipVerification` row for that property flips to `VERIFIED`.
  3. `POST /passport` (creates a PENDING_PAYMENT claim) → `POST /payment/create-claim-intent` (pay the real but small £8.99–£19.99 Stripe charge) → `POST /passport/:id/activate` succeeds, because the forged OV row satisfies the check.
  4. Attacker is now recorded as the verified owner/seller/landlord of a property they don't own, receives a Founding Homeowner certificate, and can transact with buyers as the "verified owner."
- **Contrast:** the *other*, correct claim flow (`pages/claim/[id].vue` → `start-verification` → `land-registry-check` → real HMLR SOAP call → `activatePassport`) is properly gated. This is a second, leftover decorative flow that bypasses it entirely.
- **Fix:** Delete `completeVerification`/`/complete-verification` and the `verify-ownership/[id].vue` page, or rewrite `completeVerification` to be a no-op unless it's reading a genuine `landRegistryMatchResult` set by the real HMLR flow. Never let a bare client POST write `status: 'VERIFIED'`.

---

### HIGH

#### H1 — Stored XSS via unsanitized upload filename / unvalidated content-type
- **Files:** `src/common/storage.ts` — `buildFilename()` (lines 71-74), `buildFileFilter()` (lines 76-86)
- **Affected endpoints:** `POST /profile/avatar` (bucket `avatars`, **public**), `POST /marketplace/upload-photo` (`job-photos`, **public**), `POST /passport/:id/upload-image` (`property-images`, **public**), plus `documents`/`truevalue-evidence` buckets (private).
- **Description:** The stored file's extension is taken verbatim from the client's `originalname` (`extname(originalName)`), independent of any mimetype check. Mimetype validation itself trusts the client-declared `Content-Type` header, never the actual file bytes. An attacker can upload `filename="x.svg"` with `Content-Type: image/png` set on the multipart part — it passes the allow-list check but is stored (and served) as `.svg` containing an embedded `<script>`.
- **PoC:** Multipart upload to `/profile/avatar` with `filename="x.svg"`, `Content-Type: image/png`, body containing `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.domain)</script></svg>`. Server stores `avatars/<ts>-<rand>.svg`; it's publicly reachable at `/uploads/avatars/<ts>-<rand>.svg`, served by `express.static` (disk mode) or `multer-s3`'s `AUTO_CONTENT_TYPE` (S3/prod mode) with `Content-Type: image/svg+xml` inferred from the extension — executes the script when opened directly or embedded via `<object>`/`<iframe>`.
- **Fix:** Never derive the stored extension from client input — map it from a validated mimetype allow-list, or drop the extension and set `Content-Type` explicitly at serve time from a DB-stored, byte-sniffed mimetype (e.g. via the `file-type` package). Reject `image/svg+xml` outright on any bucket rendered as an `<img>`/avatar unless sanitized server-side.

#### H2 — Public upload buckets served with no CSP and extension-derived Content-Type
- **File:** `src/main.ts:39-72`
- **Description:** `helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } })` — reasonable for a JSON API, but it means the three public static-served upload buckets (`avatars`, `job-photos`, `property-images`) have no CSP constraining an injected script (per H1) and are explicitly embeddable cross-origin.
- **Fix:** Serve `/uploads/*` with a scoped CSP/sandbox header, or force `Content-Disposition: attachment` for any non-whitelisted extension on those mounts, independent of fixing H1.

#### H3 — Passport-docs / bills / documents / truevalue-evidence uploads have no content-type filter at all, served inline
- **Files:** `src/question/question.controller.ts:44-98` (raw `diskStorage`, no `fileFilter`), `src/property/property.controller.ts:442-467` (`bills`), `documents.controller.ts:30`, `buyer-profile.controller.ts:60`, `truevalue.controller.ts:76` (all call `createUploadStorage` without `mimeAllowList`/`mimePrefix`, so no filter is applied); served via `src/files/files.controller.ts:78-79` with `Content-Disposition: inline` (never `attachment`).
- **Description:** These buckets are private (not statically mounted), but documents routinely cross between accounts — owner ↔ buyer ↔ collaborator ↔ solicitor (via `SharedPassportLink`) ↔ marketplace tradesperson. An HTML/SVG payload uploaded by one party executes in another party's browser when they view a shared "document" or "evidence" — genuine **cross-user** stored XSS, not self-XSS.
- **Fix:** Apply mime allow-lists appropriate to legal/evidence documents (PDF/JPEG/PNG/HEIC), and force `Content-Disposition: attachment` for anything outside a small safe-to-render allow-list.

#### H4 — Owner-hidden ("PRIVATE") passport sections still leak to buyers and share-link holders
- **Files:** `src/passport/passport.service.ts:1454-1571` (`getBuyerView`), `:1997-2134` (`getSharedPassport`), specifically the `visibleSections` filters at lines 1507-1509 and 2103-2107.
- **Description:** `PATCH /passport/section/:sectionId/visibility` lets an owner mark a section `PRIVATE`, documented as "owner-only even after publish." Neither `getBuyerView` nor `getSharedPassport` actually checks `section.visibility` — both only filter the `leasehold` section (and, for tenant-scope share links, non-tenant sections). A section the owner explicitly hid (e.g. containing a legal dispute) is still returned in full — including all answers and uploaded documents — to any buyer who paid for `buyer-unlock`, and to **anyone** holding a share link (including the public, unauthenticated `GET /passport/shared/:token` route).
- **Fix:** Add `s.visibility !== 'PRIVATE'` to the `visibleSections` filters in both `getBuyerView` and `getSharedPassport`.

#### H5 — `removeCollaborator` deletes any `PassportCollaborator` row by ID with no cross-check against the passport in the URL
- **Route:** `POST /passport/:id/collaborators/:collaboratorId/remove`
- **Files:** `src/passport/passport.service.ts:1573-1635`
- **Description:** The service verifies the requester owns the `passportId` from the URL, but then fetches and deletes the `PassportCollaborator` row using only `collaboratorId` — never checking that the row actually belongs to that `passportId`. `PassportCollaborator.id` is a global primary key, not scoped per-passport. A user who owns *any* passport (P1) and learns another passport's (P2's) collaborator-row ID `X` (a UUID, but not otherwise access-controlled once known) can call `POST /passport/P1/collaborators/X/remove` — the ownership check passes against P1, and collaborator `X` on P2 is silently deleted, revoking someone else's access to a passport the attacker has no relationship with.
- **Fix:** Scope both the lookup and the delete to `{ id: collaboratorId, passportId }`.

#### H6 — No ownership check on viewing-request creation enables impersonation/spam against arbitrary users
- **Route:** `POST /property/:id/viewing-request`
- **Files:** `src/conversations/conversations.controller.ts:109-127`, `src/conversations/viewing-requests.service.ts:59-147`
- **Description:** The service checks only that `propertyId` exists and `proposedById !== invitedUserId` — it never verifies the caller (acting as "the seller inviting a viewer") actually owns/manages/collaborates on that property. Any authenticated user can invite any other user to "view" any property in the database, triggering a real push notification and transactional email ("`<attacker>` invited you to view `<real address>`") and opening a persistent DM thread from the victim's inbox — scriptable against every property in the DB.
- **Fix:** Verify `proposedById` is the property's registered owner or an authorized collaborator before creating the invite.

#### H7 — `/auth/check-email` is an unthrottled user-enumeration oracle
- **Files:** `src/auth/auth.controller.ts:27-30` (no `@Throttle`), `src/auth/auth.service.ts:96-103`
- **Description:** Unlike every other auth route, `check-email` has no dedicated throttle and falls under the generic 300 req/min/IP (prod) bucket, directly returning `{ exists: boolean }`. Trivially scriptable (and distributable across IPs) to build phishing/credential-stuffing target lists of registered emails.
- **Fix:** Add the same `AUTH_THROTTLE` (5/min) decorator used on the other auth routes.

#### H8 — Property search endpoints are fully unthrottled and hit paid/rate-limited external APIs
- **Files:** `src/property/property.controller.ts:41` (`search`), `:139` (`search-areas`), `:255` (`for-you`), `:236` (`record-view`) — all explicitly `@SkipThrottle()`.
- **Description:** These fan out to OS Places/EPC. DEPLOYMENT.md already documents a real failure mode here ("Free Trial allowance exceeded", a 50 req/min OS API cap) — an unthrottled endpoint calling a quota-capped paid API is a direct cost/availability risk, exploitable by a single scripted client with no rate limit at all.
- **Fix:** Apply a real (if generous) per-IP cap to `search`/`search-areas` instead of skipping the throttler entirely; use a moderate per-user throttle on the JWT-gated `for-you`.

#### H9 — Frontend still ships the `apiSecret || '123'` weak-default pattern flagged in the prior external report
- **File:** `umu-website-integration/nuxt.config.ts:192` — `apiSecret: process.env.API_SECRET || '123'`
- **Description:** This is the exact issue DF4 Labs flagged previously; it was fixed on the backend (`ADMIN_SECRET` is boot-validated, ≥16 chars, rejects `"123"`) but **not** on the frontend. Currently no server route reads `runtimeConfig.apiSecret` (grep confirms zero consumers), so today's exploitability is nil — but it's a live landmine: the first server route that trusts this value for auth inherits a trivially-guessable default with no fail-fast guard, unlike every backend secret.
- **Fix:** Remove the `'123'` fallback (fail the build/boot if `API_SECRET` is unset in production), or delete the unused config key until it's actually needed.

#### H10 — Maintenance bulk-wipe endpoints have only one safety gate (`NODE_ENV` string check), no secondary control
- **Files:** `src/maintenance/maintenance.controller.ts:16-45`, `src/maintenance/maintenance.service.ts:20,26,31-43`, gating in `src/app.module.ts:43,98`
- **Description:** `DELETE /maintenance/all` and friends call `deleteMany({})` with **no filter** — wiping every passport/property in the database. This is currently excluded from production only by `const PROD_BUILD = process.env.NODE_ENV === 'production'`. Verified: `infra/lib/umu-stack.ts:369` hardcodes `NODE_ENV: 'production'` in the CDK stack that provisions the real App Runner service, so today's actual deployment reliably excludes this module. But it is the *only* gate — any future deploy path that doesn't go through this exact CDK stack (a manual `docker run`, a differently-configured environment reusing this image, a local build accidentally pointed at a prod `DATABASE_URL`) silently re-enables total-data-loss endpoints, protected only by the timing-unsafe secret comparison in H-below.
- **Fix:** Add a second, independent gate (a distinct env var never present in the prod secret bundle, or a `confirm` body field like `admin.controller.ts`'s founder-sequence reset already uses).

*(H10 continued — folded in as the same class of finding:)* **Timing-unsafe `x-admin-secret` comparison, repeated across 5 controllers** — `src/admin/admin.controller.ts:26-31`, `src/maintenance/maintenance.controller.ts:8-13`, `src/truevalue/truevalue.controller.ts:25-30`, `src/buyer-profile/buyer-profile.controller.ts:71-76`, `src/verifier-api/verifier-api.controller.ts:134-139` — all use plain `secret !== expected` rather than `crypto.timingSafeEqual`, a theoretical remote timing side-channel, copy-pasted into 5 places. Contrast with `files.service.ts`/`kyc.service.ts`/`verifier-api.service.ts`'s client-secret checks, which correctly use `timingSafeEqual`. Practical risk is reduced by `ADMIN_SECRET` being boot-enforced ≥16 chars, but the pattern should be fixed everywhere it's copy-pasted. **Fix:** `crypto.timingSafeEqual` with length-equalized buffers (or HMAC both sides first) at all 5 call sites.

---

### MEDIUM

#### M1 — JWTs are never revoked; logout/password-change/account-deletion don't invalidate outstanding tokens
- **Files:** `src/auth/jwt.guard.ts:27-33`, 7-day expiry (`auth.module.ts:14`)
- **Description:** The guard verifies the JWT signature and trusts `sub`/`email` from the payload directly — it never re-checks the user still exists, is still verified, or hasn't rotated their password since the token was issued. `logout` is purely client-side (token cleared in the browser only). A stolen bearer token remains fully valid for up to 7 days after the legitimate user changes their password believing they've locked out an attacker; deleting a user doesn't revoke their outstanding token either.
- **Fix:** Add a `tokenVersion`/`passwordChangedAt` claim checked against the DB on sensitive routes, and/or move to short-lived access tokens + a revocable refresh token.

#### M2 — `POST /collection/:id/add` lets a user link any passport ID into their own collection with no ownership check
- **Files:** `src/collection/collection.controller.ts:33-45`, `src/collection/collection.service.ts:66-83`
- **Description:** The endpoint verifies the *collection* belongs to the caller, but never checks the caller has any relationship to the *passport* being added — `PassportService.checkUserAccess` is never called here, unlike every other module reviewed. Any user who knows/obtains a passport UUID (via a leaked share link, screenshot, log line, etc.) can persistently attach it to their own collection and read its address, postcode, status, type, and property thumbnail via `GET /collection/my`.
- **Fix:** Call `passportService.checkUserAccess(passportId, userId)` before the upsert.

#### M3 — `GET /rewards/stamps/catalogue?passportId=` leaks answer-derived facts about another user's passport (BOLA)
- **Files:** `src/rewards/rewards.controller.ts:43-46`, `src/rewards/rewards.service.ts:379-442`
- **Description:** Guarded by `JwtAuthGuard` only — the service never checks the given `passportId` belongs to the caller. Returns per-stamp `applicable: true/false` computed from real section/question answers (e.g. leasehold status, solar-panel/drainage disclosures) for any passport ID an attacker supplies.
- **Fix:** Require and check `req.user.id` against the passport's owner/collaborator/buyer-access relationship before computing applicability.

#### M4 — HMLR "bypass" mode silently auto-verifies ownership with no environment guard
- **File:** `src/property/property.service.ts:6002-6075` (`verifyOwnershipWithLandRegistry`)
- **Description:** `bypassEnabled` is true when `HMLR_BYPASS==='true'` OR the endpoint contains `bgtest.`/`EOOV_StubService` OR `HMLR_OV_ENDPOINT` is simply unset — in any of those cases the code unconditionally upserts `status: 'VERIFIED'`. Per DEPLOYMENT.md, prod is currently correctly configured with live HMLR credentials, so this is dormant today — but the guard is purely env-var-shaped, with no `NODE_ENV` check. A secret-rotation mistake that drops `HMLR_OV_ENDPOINT`, or an errant `HMLR_BYPASS=true` in the prod secret bundle, silently auto-verifies every ownership claim with no error or distinguishing log signal.
- **Fix:** Gate the bypass explicitly on `NODE_ENV !== 'production'`, and alert (Sentry) loudly if `HMLR_OV_ENDPOINT` is unset while `NODE_ENV === 'production'`.

#### M5 — HMLR credentials silently fall back to public test/stub values, unchecked by env validation
- **File:** `src/land-registry/land-registry.service.ts:59-71` — `HMLR_OV_ENDPOINT`/`HMLR_USERNAME`/`HMLR_PASSWORD` each fall back to HMLR's published test-stub values (`bgtest.landregistry.gov.uk`, `BGUser001`/`landreg001`) if unset.
- **Description:** Not directly attacker-exploitable (these are HMLR's own public test credentials, not a real secret leak), but none of the three vars are checked in `src/common/env.validation.ts`. If production is ever deployed with them unset, ownership-verification calls silently hit the **test stub service** and treat its canned responses as real — a data-integrity risk on the same axis as C1/M4.
- **Fix:** Add a `prodOnly` env-validation check for these three vars, matching the existing pattern for `BASE_URL`.

#### M6 — Buyer-profile admin review endpoints authenticated only by the shared static secret, no JWT/role check
- **Files:** `src/buyer-profile/buyer-profile.controller.ts:78-95` (`admin/review-queue`, `admin/review/:profileId`)
- **Description:** Same pattern as the maintenance/admin modules generally, but here it gates approval of KYC/AML buyer documents specifically — higher-value than passport/property deletion. No JWT guard, no per-admin identity captured, no audit trail of which admin acted.
- **Fix:** Require both the header secret and a JWT belonging to a user with an admin claim; log the acting admin identity.

#### M7 — `/property/:id/llc/refresh` allows unbounded cost/quota exhaustion against a paid external HMLR API
- **File:** `src/llc/llc.controller.ts:16-39`
- **Description:** Intentionally open to any signed-in user by design (per the code's own comment — this is not a confidentiality bug), but `force: true` bypasses the 30-day cache and hits the paid HMLR External Search API on every call. The only limiter is 3/min **per IP** — no per-user or global daily cap — so a low-effort script rotating IPs/accounts against every property ID in the DB can burn real budget.
- **Fix:** Add a per-user or global daily cap independent of the IP-based throttle.

#### M8 — Chat and AI-summary endpoints have no dedicated throttle (LLM cost exposure)
- **Files:** `src/chat/chat.controller.ts:30-32`, `src/passport/passport.controller.ts:419-427`
- **Description:** Both JWT-gated but rely solely on the 300 req/min/IP global default. Each call is a paid Groq LLM invocation — up to 300 calls/min possible from one token before the guard trips.
- **Fix:** Add a modest dedicated `@Throttle` (~20-30/min), mirroring `AUTH_THROTTLE`.

#### M9 — Upload-filename XSS class overlap: documents.controller.ts/question.controller.ts route bypasses the shared storage abstraction
- **File:** `src/question/question.controller.ts:44-98`
- **Description:** These two upload routes still write directly to local disk via raw `diskStorage`, bypassing `createUploadStorage`/S3, even in production (App Runner) — meaning these uploads don't survive a redeploy and aren't protected by the private-bucket ACL model the rest of the app relies on. Filename generation itself is traversal-safe; this is a reliability/architecture gap that happens to touch the same upload code path as H1/H3.
- **Fix:** Migrate both routes onto `createUploadStorage({ bucket: 'passport-docs', mimePrefix: [...] })`.

#### M10 — KYC webhook HMAC check can throw an uncaught `RangeError` on a length-mismatched signature
- **File:** `src/kyc/kyc.service.ts:205-214`
- **Description:** `crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1))` has no length-equality check first; a differently-sized `v1` value throws a `RangeError` that isn't caught, producing an uncaught 500 instead of the intended 400. `files.service.ts` already handles this correctly with a length check — this file should match it. Not a bypass, just an error-handling robustness gap.
- **Fix:** Add `a.length !== b.length` guard before calling `timingSafeEqual`.

---

### LOW / INFO

- **L1 — OTP has no per-account attempt lockout, only per-IP throttling.** 6-digit numeric OTP, `Math.random()` (not a CSPRNG, low practical concern given the 10-minute expiry and small keyspace), 5 req/min/IP on verify. A distributed attacker rotating source IPs isn't limited by account. *(Auth agent)* Recommend an account-scoped attempt counter in addition to IP throttling.
- **L2 — `GET /profile/users/search` allows email harvesting via unthrottled substring search.** Authenticated-only, but any logged-in user can brute-force 2-character prefixes to enumerate other users' full email addresses; no rate limit, full-email disclosure rather than masked. *(Profile IDOR sub-agent)*
- **L3 — `AccessGrant.accessToken` (verifier-api) stored in plaintext in the DB**, unlike `verifierClient.clientSecretHash` which is correctly scrypt-hashed. A DB read/leak would hand out directly-usable bearer tokens. *(Files/KYC/verifier-api sub-agent)*
- **L4 — HMAC key reuse:** `JWT_SECRET` is reused to sign both JWTs and the `/files/...` HMAC-signed URLs (explicitly documented as intentional in-code). No live exploit path today; standard hygiene would derive a separate subkey. *(Files/KYC/verifier-api sub-agent)*
- **L5 — Marketplace `getOfferOrThrow` is a minor existence oracle** — distinguishes "offer doesn't exist" (404) from "exists but you're not a party" (403) with no data leak beyond that signal. *(Calendar/marketplace IDOR sub-agent)*
- **L6 — CORS `credentials: true` is unused surface area** — the app is Bearer-JWT-only (no cookie auth found anywhere), so this flag currently buys nothing but would widen risk if the allowlist logic ever regressed to something permissive. *(Web hygiene agent)*
- **L7 — Stale "Railway" reference in a `main.ts` CORS comment** — cosmetic, deploy target is AWS App Runner. *(Web hygiene agent)*
- **L8 — `FounderNumber` reset confirmation string is a hardcoded literal in source** (`'RESET-FOUNDER-SEQ'`), effectively public if the repo is ever public — low severity given it's a documented one-off migration op, still gated by the admin secret. *(Admin sub-agent)*
- **L9 — `passport.service.ts`'s `getPassport` performs no access check itself** — safe today because the controller always pairs it with `checkUserAccess` first, but it's a landmine for a future call site that forgets to. *(Passport IDOR sub-agent)*
- **L10 — `deleteQuestionCopy` reads another user's document metadata before the ownership check fires** — confirmed not exploitable (the downstream `ForbiddenException` fires before anything is returned to the client), code-quality nit only. *(Question/task IDOR sub-agent)*
- **Info — SQL injection:** the only unsafe raw-SQL call in the codebase (`$executeRawUnsafe` in `admin.service.ts:87-89`, sequence-reset admin endpoint) is safely guarded by a strict `Number.isInteger()` check before interpolation. All other data access is via typed Prisma calls. **Verified safe.**
- **Info — SSRF:** all outbound `fetch`/`axios` targets (Persona, EPC, OS Places, HMLR) are hardcoded hosts; no user-controllable URL/webhook feature exists anywhere in `src/`. **Verified safe.**
- **Info — Sort/orderBy injection:** no controller exposes a user-controlled `sort`/`orderBy` query param at all; every `orderBy` in the codebase is a hardcoded literal. **Verified safe (non-issue).**
- **Info — Frontend `v-html`:** all 36 usages in `umu-website-integration` reviewed; every sink is either a static author-authored SVG icon string or numeric-only template interpolation (scores, £ amounts, counts) — no user/API free-text (notes, chat, descriptions, answers) ever reaches a `v-html` sink. **Verified safe.**
- **Info — Sensitive field exposure:** every `prisma.user.find*` call site sampled either uses an explicit `select` excluding `password`, or destructures it out before use. No password/hash leak found in any response path checked. **Verified safe.**

---

## Dependency & secret audit

### npm audit — backend (`umu-backend`)
0 critical, **10 high**, 9 moderate, 1 low. Notable direct-dependency highs: `@nestjs/core`/`@nestjs/platform-express` (path-to-regexp/multer advisory chain), `multer` (multiple DoS advisories, ≤2.2.0), `nodemailer` (SSRF/file-read via `disableFileAccess` bypass, ≤9.1.0), plus Prisma-transitive advisories requiring a Prisma major-version bump (≥6.12.0).
**Recommendation:** `npm audit fix` for multer/nestjs (fix available), plan a scheduled Prisma major-version upgrade.

### npm audit — frontend (`umu-website-integration`)
**4 critical**, 27 high, 11 moderate, 5 low, against `package-lock.json`. The one **critical, production-shipped** dependency is `nuxt` itself (≤3.21.9) — pulls in an SSR RCE advisory (via server-island props), a reflected-XSS advisory (`navigateTo`/`<NuxtLink>`), and a route-middleware-bypass advisory. `@nuxt/ui` (moderate, SSR form-method leak) is also production-shipped. The single critical-severity *package* (`@nuxt/devtools`, unauthenticated RPC → arbitrary code execution, GHSA-279x-mwfv-vcqv) is **dev-only** — not shipped to production, but still exploitable against a developer's own machine via a malicious webpage while `nuxt dev` is running. Remaining critical/high entries (`tar`, `simple-git`, `shell-quote`, `toml`, `extract-zip`, `glob`) are transitive Netlify/Nitro build-tooling dependencies, not runtime-reachable in the deployed app.
**Recommendation:** upgrade `nuxt` to the latest 3.x patch (fix available) before launch — this is the one item in this section with real production exposure; upgrade `@nuxt/devtools` for developer-machine safety; the `@nuxt/ui` major bump needs a compatibility pass first.

### Gitleaks / secret history sweep
`gitleaks` binary was not available on this machine — a manual grep-based sweep of full tracked git history was substituted (pattern-matching AWS keys, Google API keys, Stripe live/test/webhook secrets, PEM private keys, Postgres connection strings). **No new real secrets found** beyond the three already known and allowlisted in `.gitleaks.toml` (Postgres password, Google Maps key, leaked JWT — all confirmed rotated/revoked). Remaining hits were either those three, or clearly-labeled documentation placeholders (`sk_test_dummy`, `AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX`, etc.).
**Recommendation:** run the real `gitleaks detect --config .gitleaks.toml` via CI (already wired per DEPLOYMENT.md) or install the binary locally — manual regex sweeps don't cover gitleaks' full default ruleset (e.g. generic high-entropy detection).

### Weak-default-secret grep sweep
- **Frontend — confirmed still present:** `nuxt.config.ts:192` — `apiSecret: process.env.API_SECRET || '123'` (see H9 above). This is the exact issue the prior external report flagged; it is fixed on the backend but not the frontend.
- **Backend:** no `SECRET`/`KEY`/`TOKEN`/`PASSWORD` env var anywhere in `src/` has an insecure `||` fallback — `JWT_SECRET` and `ADMIN_SECRET` are both required with no default and boot-validated for length/placeholder rejection.
- `.env.example` in both repos contains only placeholders; actual `.env` files are correctly gitignored and not tracked in either repo (verified via `git check-ignore` / `git ls-files`).

---

## What was verified as ALREADY FIXED (do not re-litigate)

- **`/auth/apple/mock` impersonation backdoor** — confirmed removed via git history (`51c1538`, `786164c`); Google/Apple OAuth were removed entirely rather than patched, eliminating the id_token/JWKS verification risk class outright (there's nothing left to verify because the feature doesn't exist server-side).
- **Rate limiting on auth endpoints** — `request-otp`, `verify-otp`, `register`, `login`, `forgot-password`, `verify-reset-otp`, `reset-password` all correctly throttled to 5 req/min/IP via the documented `default`-bucket-override pattern (not a second bucket, avoiding a previously-fixed bug where a second bucket accidentally rate-limited the entire API).
- **`JWT_SECRET`/`ADMIN_SECRET`** — no insecure fallback anywhere in the backend; both required at boot, `ADMIN_SECRET` explicitly rejects `"123"` and enforces ≥16 chars in production, process exits if violated.
- **Password reset cannot target an arbitrary user** — the reset target is derived exclusively from the server-verified `resetToken` JWT's `sub` claim; the request body has no `userId`/`email` override field.
- **User enumeration on `/auth/forgot-password`** — mitigated with a constant generic response regardless of account existence. (`/auth/check-email` is a separate, still-open enumeration surface — see H7.)
- **CORS** — confirmed a real env-driven allowlist (`CORS_ORIGINS`), not `origin: true`. The prior external report's finding is fixed.
- **Helmet + global exception filter** — both applied unconditionally in all environments; the exception filter (`all-exceptions.filter.ts`) never leaks Prisma internals, stack traces, or raw error messages to the client — verified by reading the full 92-line file.
- **Stripe webhook signature verification** — `stripe.webhooks.constructEvent` enforced with the raw request body and `STRIPE_WEBHOOK_SECRET`; signature failure throws before any DB write; `rawBody: true` is scoped correctly and doesn't disable JSON parsing for other routes.
- **Payment amounts cannot be influenced by the client** — all Stripe PaymentIntent amounts come from hardcoded server-side constants keyed off server-computed tier state; no client-supplied amount/tier field exists in the request path.
- **`createBuyerAccess` (buyer-unlock paywall)** — properly gated on both KYC verification and a re-fetched (not client-trusted) Stripe payment status. This closes the prior "paywall is decorative" finding.
- **Founder-number/certificate issuance** — protected by a genuine DB-level unique constraint on `FounderNumber.passportId` (not just app logic), with correct `P2002`-conflict handling for the race case, plus an explicit ownership check before minting.
- **No cookie-based auth path exists anywhere** — confirmed via repo-wide search; JWT is exclusively Bearer-header based, so CSRF risk is low by design, not just by assumption.
- **Frontend XSS (`v-html`)** — all 36 usages reviewed individually; none render user-controlled free text.
- **Sensitive data exposure** (password hashes, internal fields) — not found in any sampled response path.
- **File-serving HMAC scheme (`/files/...`)** — correctly timing-safe, length-checked, scoped to path+user+expiry, with a DB-level ownership re-check at serve time (so revoking a document invalidates a still-unexpired signed URL immediately). Well-implemented.
- **KYC/verifier-api ownership scoping** — every `:id`-param route checked traces into a service method that verifies caller ownership before reading/mutating; scope escalation is blocked on both the verifier-request side and the buyer-approval side.
- **Raw SQL / SSRF / sort-param injection** — all verified safe (see Low/Info section above).
- **Known-rotated secrets in git history** (Postgres password, Google Maps key, leaked JWT) — reconfirmed present-but-allowlisted in history, no new secrets found beyond them.

---

## Out of scope / not tested

- **Live dynamic exploitation against a running server** (actual OTP brute-force timing, live JWT replay, live Stripe payment-intent tampering, live CORS preflight probing) was **not performed** — this pass was a thorough static code review across six parallel tracks plus module-by-module IDOR analysis, not a live black-box pentest. Recommend a follow-up dynamic-testing pass against local dev instances (per the original scope) to empirically confirm the static findings above, particularly C1, H4, H5, H6, and the throttling findings.
- **Live AWS/Railway production systems** — explicitly excluded per instructions; nothing here was tested against a deployed environment.
- **`gitleaks` binary** — unavailable on this machine; substituted with a manual regex-based git-history sweep (see Dependency & Secret Audit above). Recommend running the real tool via CI or locally for a definitive sweep.
- **`bun audit`** against `umu-website-integration`'s `bun.lock`** — not run; `npm audit` against the parallel `package-lock.json` was used instead and is considered sufficient coverage for this pass.
- **Real calls to HMLR (live mode), Persona, or Stripe live-mode** were not exercised, to avoid cost/side effects and avoid creating test data against any real external system.
- **Native mobile (Capacitor/iOS/Android) attack surface** — not in scope for this review (the brief specified the backend + `umu-website-integration` only, not `umu-mobile-webapp` or native builds).

---

## Priority recommendation

1. **Fix C1 immediately** — it fully defeats the ownership-fraud protection the entire KYC/HMLR/payment stack exists to enforce, requires only a valid JWT (no special access), and has a live frontend page driving it today.
2. **Fix H1–H3 (upload XSS cluster) next** — root-causing in `storage.ts`'s `buildFilename`/`buildFileFilter` closes the exploit path for every affected bucket at once.
3. **Fix H4–H6** (private-section leak, collaborator-removal IDOR, viewing-request impersonation) — all are straightforward, scoped authorization-check additions.
4. **Fix H7–H10** (enumeration/cost-exposure throttling, frontend weak-secret fallback, maintenance secondary gate, timing-unsafe secret comparisons) — mostly small, mechanical changes reused across several files.
5. Work through the Medium list opportunistically — none block launch on their own, but M1 (JWT non-revocation) and M4/M5 (HMLR fallback behavior) are worth prioritizing given they touch the same trust boundary as C1.
6. Upgrade `nuxt` before launch (the one dependency finding with real production exposure); schedule the Prisma major-version bump.
