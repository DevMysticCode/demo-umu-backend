# History Feature — GitHub Status & Merge Plan

**Date:** 2026-09-25
**Status:** Nothing has been committed or pushed yet. This is a plan for your go-ahead, not a record of actions taken.

---

## 1. Current GitHub status (all four repos, freshly fetched)

| Repo | Remotes | Branch | Behind origin | Uncommitted |
|---|---|---|---|---|
| `umu-backend` | `origin`/`fork` = `DevMysticCode/demo-umu-backend` (same repo, two names), `upstream` = `OpenProperty-umu/umu-backend` (client org) | `main` | 0 | 13 modified, 9 new files (mine) + several pre-existing untracked items (not mine) |
| `umu-website-integration` | `origin` = `vy848698-coder/Umoving-ClaimedProperty` (personal), `client` = `OpenProperty-umu/umovingu-website-stripped-down` (client org) | `main` | **Was 10 — pulled & merged clean just now, 0 remaining** | 10 modified, 2 deleted, 1 new file (mine) |
| `umu-website-new` | `origin` = `vy848698-coder/umovinguwebsite-new` (personal only, no client-org mirror) | `main` | 0 | 3 modified files (mine) |
| `umu-mobile-webapp` | `origin` = `DevMysticCode/demo-umu-frontend` (demo/TestFlight), `upstream` = `OpenProperty-umu/umu-mobile-webapp` (client org) | `main` | 0 | 4 modified (mine) + 1 modified (**not mine** — `pages/claim/[id].vue`, pre-existing before this session) + untracked items (not mine) |

**One live finding from this check:** `website-integration` had a new commit land on its remote since I last synced (a small, unrelated desktop-zoom CSS tweak, 10 lines, in an area of `[id].vue` completely separate from my changes). I pulled and merged it — auto-merged with zero conflicts, re-verified the app still compiles and renders. Nothing else changed.

---

## 2. What's mine vs. not mine, per repo

This matters because each repo has files sitting there that predate this session or belong to other in-progress work — the plan below only stages what I actually built.

### `umu-backend`
**Mine (stage for commit):**
- Modified: `prisma/schema.prisma`, `src/app.module.ts`, `src/auth/{auth.controller,auth.module,auth.service}.ts`, `src/auth/dto/index.ts`, `src/documents/{documents.module,documents.service}.ts`, `src/passport/{passport.controller,passport.module,passport.service}.ts`, `src/prisma/prisma.service.ts`, `src/question/question.service.ts`
- New: `src/auth/dto/refresh-token.dto.ts`, `src/passport/passport-actions.service.ts`, `src/passport/passport-event-types.ts`, `src/passport/passport-events.service.ts`, `src/scripts/seed-passport-rules.ts`, `src/scripts/export-seller-questions.ts`
- Docs: `HISTORY_FEATURE_PLAN.md`, `SECURITY_FOLLOWUP_2026-09-25.md`, `PRIVACY_TERMS_REVIEW_2026-09-25.md`

**Not mine — leave alone, do not stage:** `.claude/` (must never be committed — this is exactly the leaked-credential risk flagged in the earlier security review), `README_FIXES.md`, `src/scripts/seed-truevalue-worktypes.ts`, `src/truevalue/` (all pre-existing, untouched by this session).

**Deliverable files, not source — leave out of the commit:** `UmovingU_Privacy_Policy_DRAFT.docx`, `UmovingU_Seller_Passport_Questions.docx`. These were generated outputs for you, not application code; committing binary Word docs into a NestJS repo isn't the right home for them.

### `umu-website-integration`
**Mine:** all 13 changed files (`components/modals/AddCollaboratorModal.vue`, `composables/{useAuth,usePassportCollaborators,useSignOut,useVerificationCode}.ts`, deletion of the two dead OAuth callback pages + two dead server routes, `pages/onboarding/signin.vue`, `pages/passportview/[id].vue`, `pages/profile/index.vue`, new `plugins/auth-refresh.client.ts`). Everything here is mine — this repo has no stray pre-existing untracked files.

### `umu-website-new`
**Mine:** all 3 changed files (`components/modals/AddCollaboratorModal.vue`, `composables/usePassportCollaborators.ts`, `pages/passportview/[id].vue`). Nothing else to exclude — cleanest of the four repos.

### `umu-mobile-webapp`
**Mine:** `components/modals/AddCollaboratorModal.vue`, `components/passport/PublishPassportDrawer.vue`, `composables/usePassportCollaborators.ts`, `pages/passportview/[id].vue`.

**Not mine — leave alone:** `pages/claim/[id].vue` (modified, but this predates the session — it's someone else's in-progress work; committing it as part of my changes would misattribute it and might ship something half-finished), `.claude/`, `components/truevalue/`, `pages/truevalue/` (all pre-existing untracked).

---

## 3. Proposed commit structure

Rather than one giant commit per repo, split by logical concern so the history stays reviewable — this also makes it easy to `git revert` just the History feature later if needed without touching the auth/security fixes.

**`umu-backend`** — two commits:
1. `security: JWT revocation via refresh tokens, publish-bypass fix, activation race fix` — the refresh-token DTO/auth changes, the `publishPassport`/`activatePassport` fixes, `passport.controller.ts`/`passport.module.ts` bits tied to those (from earlier in this session, not the History feature).
2. `feat: History event log, rule engine, document versioning, collaborator scoping` — the schema additions, `passport-events.service.ts`, `passport-actions.service.ts`, `passport-event-types.ts`, the `question.service.ts`/`documents.service.ts` instrumentation, the new controller endpoints, the seed script, and `HISTORY_FEATURE_PLAN.md`.

Given these landed in the same session and share some touched files (`passport.controller.ts` etc.), a clean two-way split may not be mechanically trivial — **if splitting turns out messy, one combined commit is a reasonable fallback**; I'll use my judgement when actually doing it, but will ask you first if it's not a clean split.

**Each frontend repo** — one commit each, e.g.:
`feat: History tab, hero restructure (Collaborators + Manage visibility), collaborator role/scope`

---

## 4. Where to push

Per the existing project convention (the backend already has this "push to both origin and upstream" pattern — see project memory), and matching what I found in the remotes table above:

| Repo | Push to |
|---|---|
| `umu-backend` | `origin` (=`fork`, same repo) **and** `upstream` (client org) |
| `umu-website-integration` | `origin` (personal) **and** `client` (client org) |
| `umu-website-new` | `origin` only — no client-org remote exists for this repo |
| `umu-mobile-webapp` | `origin` (demo/TestFlight) **and** `upstream` (client org) |

---

## 5. Suggested order

1. **`umu-backend` first.** The frontends' new History/collaborator-scope UI calls endpoints that only exist after this lands. My changes here are additive (`/timeline` untouched, new routes alongside it), so pushing this first is safe even before the frontends follow — nothing that currently works stops working.
2. **`umu-website-new`** — the repo I built the feature against first, cleanest diff, good canary.
3. **`umu-website-integration`** — already re-synced with its remote's latest commit; ready to go.
4. **`umu-mobile-webapp`** — last, since it needed the most adaptation and has that one unrelated file I'm leaving untouched.

---

## 6. Before I push anything

A few things worth your explicit call, since pushing to four repos (two of them client-owned) is exactly the kind of action I shouldn't just do on my own judgement:

1. **Direct push to `main`, or a branch + PR?** All four repos show a history of direct commits to `main` (no PR workflow evident in the logs I've seen this session). I'll match that pattern unless you'd rather I branch this.
2. **Should the two `.docx` deliverables be added to the backend repo at all**, even in a `docs/` folder, or kept purely as files handed to you outside of git? I'd lean toward leaving them out of the repo.
3. **Backend commit split** (§3) — fine as proposed, or do you want it as a single commit?
4. **Confirm the "not mine" exclusions above are correct** — in particular `pages/claim/[id].vue` in `umu-mobile-webapp`: I'm leaving it alone because it predates this session, but if that's actually stale/abandoned work you want cleared out, that's your call, not mine to silently drop or silently include.

I haven't run `git add`, `git commit`, or `git push` anywhere. Tell me how you want to handle the four points above and I'll execute the plan.
