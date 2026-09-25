# UmovingU — Follow-up Review: External Tester Feedback (2026-09-25)

**Context:** An external testing company reviewed the platform and raised five points secondhand, in non-technical language. This document translates each point into a concrete technical claim, verifies it against the actual code, and gives a verdict + fix plan. It also surfaces one **new Critical finding** discovered while investigating point 4 that the testers likely hit and described imprecisely as "only happy flow tested."

Companion document: [SECURITY_REVIEW_2026-09-22.md](SECURITY_REVIEW_2026-09-22.md) (prior full static review — referenced throughout, not repeated).

---

## Verdict summary

| # | Tester's complaint | Verdict | Real issue found |
|---|---|---|---|
| 1 | "Token fetched from console" | **Partly real** | Google login leaks the live JWT via a URL redirect (history/log exposure) |
| 2 | "Not using regress" (→ refresh tokens) | **Real** | No refresh-token flow; 7-day JWTs, no server-side revocation on logout |
| 3 | "Missing API rate limiting" | **Partly stale, one real gap** | Per-endpoint throttling is actually already in place; the limiter's storage is in-memory, so it doesn't hold once the app scales past 1 instance |
| 4 | "Only happy flow tested" | **Real, and worse than implied** | Found a live paywall/KYC/HMLR **bypass** via the publish endpoint, plus a race condition that can permanently wedge a passport |
| 5 | "Different apps, increased load, not scalable" | **Mostly overstated, but real underlying scalability gaps exist** | The two frontends aren't actually both live (one supersedes the other); but in-memory caching/rate-limiting and unset DB pool limits are real scale-out risks |

**Bottom line on "not production ready at all":** justified. Point 4 alone (the publish-bypass) is a materially serious paywall/verification bypass that should block launch on its own, independent of anything in the original report.

---

## FIXED (2026-09-25, same day)

The four highest-priority items from the plan below have been implemented, tested against a local dev instance, and verified:

1. **`publishPassport` bypass (point 4, Critical) — FIXED.** Added an explicit `passport.status !== 'IN_PROGRESS'` guard before the readiness check (`passport.service.ts`). Verified live: created a claim on a property with a pre-existing EPC rating (the exact bypass scenario), attempted to publish immediately without paying/KYC/HMLR — now correctly rejected with `403 "This passport must be activated (payment, KYC, and ownership verification complete) before it can be published."` Previously this would have succeeded.
2. **`completeVerification` (C1 from the 2026-09-22 report) — already fixed, confirmed still fixed.** Re-read the current code: it now requires a real `status: 'VERIFIED'` + `landRegistryMatchResult: 'SINGLE_MATCH'` row set only by the genuine HMLR flow, not a bare client claim. No action needed. (The dead legacy frontend page that used to drive the old vulnerable version only exists in the superseded `umu-mobile-webapp`, not the live `umu-website-integration` — flagged for cleanup when that repo is retired, not urgent.)
3. **`activatePassport` race condition — FIXED.** Wrapped the status check, section/task/question seeding, and final status update in a single DB transaction with an explicit `SELECT ... FOR UPDATE` row lock on the passport (`passport.service.ts`). A losing concurrent call now cleanly no-ops instead of racing into a partial seed; a failure partway now rolls back entirely instead of leaving an unrecoverable stuck passport. Verified the normal single-caller flow still works correctly (set-type → activate-without-payment still correctly rejects with a clean 403, no crash).
4. **Google-login token-in-URL leak — FIXED by removal.** Confirmed the Google/Apple OAuth surface (`/auth/google`, `/auth/apple`, `/auth/apple/mock`) doesn't exist on the backend at all (removed in an earlier commit) and nothing in the live UI triggers it — it was entirely dead code. Rather than leave a landmine that becomes live again the moment OAuth is reintroduced, deleted it outright: `googleLogin`/`appleLogin`/`appleLoginMock` from `useAuth.ts`, and the four dead files (`pages/auth/{google,apple}/callback.vue`, `server/routes/auth/{google,apple}/*.ts`) in `umu-website-integration`.
5. **Refresh tokens (point 2) — implemented.** New `RefreshToken` Prisma model (hashed storage, never raw); access-token lifetime shortened from 7d to 1h; new `POST /auth/refresh` with rotation-on-use and reuse-detection (a replayed/already-rotated token revokes every other outstanding session for that account as a precaution); `logout` now actually revokes the presented refresh token server-side instead of being a client-side no-op; `changePassword`/`resetPassword` now revoke all outstanding refresh tokens, not just future access tokens. Frontend: `useAuth.ts` gained `refreshAccessToken()`/`logout()`, all three token-storing call sites (`signin.vue`, `useVerificationCode.ts`) and all three sign-out paths (`useSignOut.ts`, `pages/profile/index.vue` ×2) updated to store/send/clear the refresh token; a new background plugin (`plugins/auth-refresh.client.ts`) silently keeps the access token alive every 45 minutes so an active session never hits the 1h expiry cliff. Verified live end-to-end: issue → refresh → rotate → reuse-of-old-token correctly rejected AND correctly revoked the rotated replacement too → logout correctly revokes.

**Not yet done from the plan below:** point 3's Redis-backed throttler storage and point 5's DB connection-pool/autoscaling sizing both involve provisioning real AWS infrastructure (ElastiCache, CDK changes to a stack that manages production resources) — these weren't made unilaterally since they touch shared/production infrastructure config; flagging for a deliberate go/no-go rather than doing it silently. Retiring `umu-mobile-webapp` is a repo-level decision, also left to you. The remaining Medium-priority DTO/validation cleanup items were not part of this pass.

---

## 1. "Token can be fetched from the console"

**What's true and NOT a bug:** the app uses standard Bearer-JWT auth — the token lives in `localStorage` and is visible in DevTools (Application tab, Network tab). This is normal for a stateless JWT SPA and is not, by itself, a vulnerability. If this is all the testers observed, it's a misunderstanding of the auth model, not a finding.

**What's true and IS a bug — confirmed real:**
- **File:** `umu-website-integration/server/routes/auth/google/gis-callback.post.ts:26-34`, `umu-website-integration/pages/auth/google/callback.vue:28-37`
- After Google sign-in, the server route takes the real backend-issued JWT (7-day, full-account access) and 302-redirects the browser to `/auth/google/callback?token=<jwt>...`. The callback page then reads `token` from the URL and stores it.
- **Impact:** the live session token lands in browser history, and in any server/proxy/CDN access log along the request path (Vercel edge logs, any reverse proxy) — a real, replayable credential leak, not a DevTools non-issue. This is very plausibly what the testers actually captured and used to "hit the API directly."
- Confirmed specific to `umu-website-integration` — the older sibling app doesn't have this Google flow at all. The Apple login flow does not have this issue (the real JWT there only ever comes from the login response body, never the URL).
- No other leaks found: no `console.log` of tokens anywhere, no secrets in `runtimeConfig.public` (client bundle), no hardcoded admin/API secrets in frontend source, no endpoint returns another user's token.

**Fix:** stop passing the JWT through the redirect URL. Either set it as an httpOnly cookie from the server route (then have the SPA read auth state via a `/auth/me` check instead of localStorage-from-URL), or use a short-lived one-time exchange code in the URL that's swapped server-side for the real token — never the token itself. Clear the URL via `router.replace` regardless.

**Severity:** Medium. **Effort:** small (one flow, one file pair).

---

## 2. "We are not using regress" → refresh tokens

Confirmed: **no refresh-token mechanism exists anywhere.** Login issues one flat 7-day JWT (`auth.module.ts` — `expiresIn: '7d'`), there is no `/auth/refresh` endpoint, and `logout` is client-side only — it does not invalidate anything server-side. (One partial mitigation already exists from the prior review: the guard now checks `passwordChangedAt` against the token's issue time, so a password change does kill outstanding tokens — but logout and "revoke this device" do not.)

**Why this matters:**
- **UX:** users get force-logged-out weekly with no silent renewal, rather than a smooth background refresh.
- **Security:** a stolen/leaked token (e.g. via finding #1 above, or an XSS, or device theft) is valid and unrevocable for up to 7 days. Logout gives the user false confidence that their session actually ended.

**Recommended architecture:**
- Short-lived access token (15–60 min), same as today but shorter.
- New `RefreshToken` Prisma model: `id, userId, tokenHash (SHA-256, never store raw), expiresAt, revokedAt, createdAt, lastUsedAt`.
- `POST /auth/refresh` — validates + rotates the refresh token (issue new, revoke old — this also detects reuse-after-theft, since a stolen-then-used-twice token immediately signals compromise).
- `logout` now actually revokes the refresh-token row for that device.
- `changePassword`/`resetPassword` revoke *all* outstanding refresh tokens for the user (extends the existing `passwordChangedAt` pattern to the refresh layer).
- Frontend: on a 401 from an expired access token, silently call `/auth/refresh` and retry once; only fully log out if refresh itself fails.

**Effort estimate:** ~1–2 days. Touches `auth.module.ts`, `auth.controller.ts`, `auth.service.ts`, one new Prisma model + migration, and the frontend's `useAuth.ts`/API client (add a 401-retry interceptor). Not architecturally hard — a well-trodden pattern — but needs care around rotation/reuse-detection to actually close the revocation gap, not just add convenience.

**Severity:** Medium-High (compounds with #1 and with the fact that logout is currently theater). **Effort:** medium.

---

## 3. "Missing API rate limiting"

**Narrower than stated, but with one real teeth:**

- **Not the cause:** `NODE_ENV=production` is hardcoded in both the Dockerfile and the CDK infra config, so there's no path to a deployed instance running the lenient 10,000/min dev limit. If testers saw "no limiting," it wasn't this.
- **Already fixed, contrary to the complaint:** every sensitive endpoint (`/auth/*`, `/property/search`, `/property/for-you`, chat, AI-summary) already carries its own dedicated `@Throttle` bucket — this was addressed in the 2026-09-22 review and is visible in the current code today. The complaint as stated is stale here.
- **The real gap:** `@nestjs/throttler` uses **in-memory storage** with no Redis/distributed backing (confirmed — no Redis package anywhere in the repo). App Runner is configured to scale across multiple instances. Each instance tracks its own rate-limit counters independently — a client whose requests get load-balanced across N instances can achieve roughly **N× the configured limit** before being consistently throttled. This is exactly the kind of thing a load-based tester would notice as "rate limiting doesn't seem to work" — it works, just not *globally*, once there's more than one instance running.
- No AWS WAF or API Gateway sits in front of App Runner as a backstop either.

**Fix:** swap the throttler's storage provider for a Redis-backed one (`nestjs-throttler-storage-redis` or similar) against a small ElastiCache instance, so limits hold across all instances. Consider adding AWS WAF rate-based rules in front of App Runner as defense-in-depth.

**Effort estimate:** ~0.5–1 day — the NestJS code change is small (swap the storage provider in `app.module.ts`), but provisioning Redis/ElastiCache in the CDK stack and wiring the connection secret into App Runner is the larger half of the work.

**Severity:** Medium (real, but bounded — the limiter isn't absent, it's just not globally consistent at scale).

---

## 4. "Only the happy flow was tested" — CONFIRMED, and more serious than implied

This is the most important section. Investigating this complaint surfaced a genuine, exploitable **bypass of the entire payment/KYC/HMLR ownership-verification gate**, independent of the Critical finding (C1) already documented in the 2026-09-22 report.

### NEW — CRITICAL: `publishPassport` has no status guard and can be reached directly from `PENDING_PAYMENT`

- **File:** `src/passport/passport.service.ts:1764-1793` (`publishPassport`)
- **Description:** Publishing a passport is gated *only* by a "readiness" computation (`computeReadiness()`), never by an explicit check that the passport has actually been activated (`status === 'IN_PROGRESS'`). Readiness is computed from the passport's sections/questions/answers plus one system-level check on the linked property's EPC rating.
- **The bypass:** a passport is created in `PENDING_PAYMENT` status with **zero sections** (sections are only seeded inside `activatePassport`, which is the function that enforces payment + KYC + HMLR checks). For a `PENDING_PAYMENT` passport with no sections, the entire question-level readiness check contributes nothing — the *only* remaining blocker is whether the linked property has an EPC rating on file. Since EPC data is fetched at **property search time**, long before any claim exists, most properties already have one.
- **Consequence:** for the (common) case of claiming a property that already has an EPC rating, `PUT /passport/:id/publish` will flip the passport straight from `PENDING_PAYMENT` to `PUBLISHED` — **skipping payment, KYC verification, HM Land Registry ownership verification, and all section/question content seeding entirely.** The only remaining check is that the caller owns the passport row (trivially true — anyone can create a `PENDING_PAYMENT` passport claim for any property for free, per the `createPassport` flow, before ever paying).
- **Why the testers likely hit this:** a "happy path only" test suite exercises the intended sequence (claim → pay → verify → activate → publish) and never tries calling `publish` immediately after `create`. A negative/adversarial tester calling endpoints out of intended order finds this immediately.
- **Severity:** Critical — this is a live, zero-cost, zero-verification path to a published (buyer-facing) property passport, on par with the C1 finding from the prior report (forged ownership verification) but reached via a completely different route that doesn't even require forging anything.
- **Fix:** add `if (passport.status !== 'IN_PROGRESS') throw new ForbiddenException('Passport must be activated before it can be published.')` at the top of `publishPassport`, before the readiness computation.

### NEW — HIGH: `activatePassport` race condition can permanently wedge a passport

- **File:** `src/passport/passport.service.ts:643-824` (`activatePassport` / `seedPassportContent`)
- **Description:** Activation is a check-then-act sequence with no database transaction: read status → (several awaited external calls later) → seed sections/tasks/questions in a plain loop → write `status: 'IN_PROGRESS'`. Two near-simultaneous activation calls (a double-click, or a client retry after a timeout) can both pass the initial status check. `PassportSection`/`PassportSectionTask` have unique constraints that will reject the losing call's duplicate rows — but there's no idempotency check to *skip* already-created sections, and no transaction wrapping the whole operation. A call that fails partway (from this race, or any transient DB error) leaves the passport with partially-seeded sections while `status` is never flipped to `IN_PROGRESS`. Every subsequent retry immediately hits the same unique-constraint conflict on the first already-created section and fails again — the passport is **permanently stuck** in `PENDING_PAYMENT` with no automatic recovery path, despite the user having paid and been verified.
- **Fix:** wrap the status check + seeding + final status update in `prisma.$transaction(...)`, and/or make `seedPassportContent` idempotent (`skipDuplicates: true`, or check-existing-and-skip per section) so retries converge instead of wedging.

### Other negative-path gaps found (lower severity, still real)

- **Validation bypass on `/questions/:questionId/answer`:** `AnswerQuestionDto` is a plain TypeScript `interface` (`{ value: any }`), not a `class` — interfaces are erased at runtime, so NestJS's global `ValidationPipe` does **no validation at all** on this endpoint. Any JSON shape passes through.
- **Several passport-controller bodies use raw inline interfaces with no class-validator**, including `setPassportType`, which silently **defaults an invalid `type` value to `'SELLER'`** instead of rejecting it (`passport.controller.ts:104`) — a malformed request silently mis-classifies a passport rather than erroring.
- **No length/size caps** on free-text fields like `addressLine1`/`postcode`, or on the JSON blob stored for question answers, beyond the 15MB global body-size limit.
- **No `@Min(0)` bounds** on numeric preference fields (`budgetMin`/`budgetMax`/`propertyValue`) — negative values pass validation cleanly.
- On the positive side: the global exception filter is solid (nothing reaches the client as a raw stack trace regardless of these gaps), external-API failure handling (HMLR, Persona, Stripe) is well-implemented with proper try/catch and fail-closed behavior, and `FounderNumber`/`BuyerPassportAccess`/Stripe-webhook paths all have correct concurrency protection via DB unique constraints.

**Fix priority for this section:**
1. `publishPassport` status guard — **do this immediately**, it's a one-line fix closing a live bypass.
2. `activatePassport` transaction/idempotency — prevents permanently-stuck paid customers.
3. Convert the interface-typed DTOs (`AnswerQuestionDto`, `setPassportType`, `sharePassportWithBuyer`, `setSectionVisibility`, `CreatePassportDto`) to real class-validator DTOs.
4. Add numeric bounds and string-length caps where missing.

---

## 5. "Different apps, increased load, scalability"

**The literal complaint is mostly overstated:** `umu-mobile-webapp` and `umu-website-integration` are not two parallel production clients hitting the backend differently — git history shows `umu-website-integration` began the day after `umu-mobile-webapp`'s last commit. This is a sequential rewrite/handoff, not a dual-maintained pair. Where they overlap, the client code (auth, API calls) is essentially identical — same `localStorage` token pattern, same direct-to-`NUXT_PUBLIC_API_BASE` calls, no production proxy/BFF layer adding hops (the one Nuxt server-route proxy that exists is explicitly dev-only, to dodge local CORS).

**But real, underlying scalability gaps exist independent of the "two apps" framing** — these are likely what the testers were actually sensing:

- **In-memory, per-instance state that doesn't survive horizontal scaling**, found in two places:
  1. The rate limiter (already covered in #3).
  2. `property.service.ts`'s external-API enrichment cache (`enrichmentCache = new Map(...)`, 24h TTL) — a genuinely good idea (it does cache, contrary to a naive "no caching" worry) but being in-process means every new App Runner instance starts cold and independently re-hits Overpass/OS Places/Land Registry/Ofcom, multiplying external API load roughly by instance count, and the cache resets on every redeploy.
- **No explicit database connection pool sizing.** `DATABASE_URL` has no `connection_limit` param and Prisma is instantiated with defaults. Each App Runner instance (1 vCPU) defaults to a small pool, but that multiplies with instance count against RDS's single `t4g.small` instance's connection ceiling — untested territory once real concurrent traffic arrives, and no `AutoScalingConfiguration` is explicitly set in the CDK stack (running on AWS App Runner's implicit defaults instead).
- **Every container boot runs `prisma db push`** (including every new instance spun up during a scaling event) against the shared RDS instance — documented as fast/idempotent and has an opt-out flag, but concurrent `db push` calls from multiple simultaneously-booting instances during a real scale-out event is an unexamined edge case.
- **Uploads are correctly stateless in production** — S3-backed (`S3_UPLOADS_BUCKET` is a required prod secret), local disk is dev-only. This part is fine.

**Fix priority, highest leverage first:**
1. Formally retire `umu-mobile-webapp` (archive/redirect it) — removes the "two different apps" concern outright and stops anyone accidentally shipping to the dead app.
2. Move the enrichment cache and the rate limiter to Redis/ElastiCache — the one finding that actually matches "increased load, not sure it scales," just not for the reason guessed.
3. Set an explicit `connection_limit` on `DATABASE_URL` sized against RDS's `max_connections`, and add an explicit `AutoScalingConfiguration` in the CDK stack rather than relying on AWS defaults.
4. Confirm `PRISMA_SKIP_DB_PUSH=true` is used for routine scale-out boots, reserving `db push` for actual deploys.

**Severity:** Medium (not a security hole, but a real "will this hold up under real concurrent load" gap). **Effort:** small-medium, mostly infra (CDK) changes plus one small ElastiCache provisioning task shared with #3.

---

## Consolidated priority plan (do these in order)

1. **[Critical, do today]** Add the missing status guard to `publishPassport` (`passport.service.ts:1764`) — closes a live, zero-cost, zero-verification paywall bypass.
2. **[Critical, from the 2026-09-22 report, still open]** Fix `completeVerification` — same class of bypass, different endpoint. If you haven't fixed C1 from the prior report yet, do it alongside #1 since they're the same root problem (a claim-flow gate that doesn't actually gate).
3. **[High]** Wrap `activatePassport`/`seedPassportContent` in a transaction with idempotency, so a race doesn't permanently strand a paying customer.
4. **[High]** Fix the Google-login token-in-URL leak (httpOnly cookie or one-time exchange code).
5. **[Medium-High]** Implement short-lived access tokens + revocable refresh tokens; make `logout` actually revoke something.
6. **[Medium]** Move the throttler (and ideally the enrichment cache) to Redis-backed storage so rate limits and caching hold under horizontal scaling.
7. **[Medium]** Convert the interface-typed request bodies to real class-validator DTOs (question answers, passport type/visibility/share fields); fix the silent `setPassportType` mis-default.
8. **[Medium]** Size the Prisma connection pool and set an explicit App Runner autoscaling configuration before real concurrent traffic arrives.
9. **[Low, housekeeping]** Formally retire `umu-mobile-webapp`; add numeric/length bounds to remaining unvalidated fields.

Items 1–4 are the ones that justify "not production ready" most directly — they're either live bypasses of the paywall/verification stack or a credential-leak path, and all four are small, well-scoped fixes (hours to low-single-digit days each), not a rebuild.
