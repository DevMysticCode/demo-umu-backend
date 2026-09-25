# Timeline → History: Findings & Implementation Plan

**Date:** 2026-09-25
**Update (same day, post-pull):** see §0 — a same-day commit on `website-integration` directly conflicts with one of the decisions already made below. Read §0 before treating §4's answers as final.
**Source documents:** `UMU_Passport_History_Developer_Handoff.md`/`.pdf` and `UMU_Passport_History_Design.html` (client-supplied, `D:\downloads_moved\Downloads\UMU_Passport_History_Developer_Pack\`)
**Scope:** backend (`umu-backend`), `umu-website-integration`, `umu-website-new`, `umu-mobile-webapp`

This is a plan, not a build — nothing has been implemented. Before writing code I want your (and ideally the client's) sign-off on the open questions in §4, because several of them change the shape of the work substantially.

---

## 0. New finding after pulling latest — a direct conflict, needs your call before anything else

Per your instruction, I pulled latest on all four repos before finalizing anything. `umu-backend`, `umu-website-new`, and `umu-mobile-webapp` had nothing new relevant to this feature. **`umu-website-integration` was 29 commits behind**, and the single newest commit — landed *today*, 2026-09-25 18:35, titled `"Passport: drop publishing, expert card and Y/N key chips"` — does the opposite of what this feature needs:

> commit message: *"This app never lets users publish a Passport, so everything built around publishing goes: Passport page: publish drawer, readiness checklist and publish/unpublish calls removed; hero copy and guided tour now talk about sharing only. Document access: no 'Show on published Passport' toggle; a document still set to PUBLISHED opens as, and is labelled, 'Included when shared'."*

Concretely, this commit **deleted** from `website-integration`: the `PublishPassportDrawer` component usage, the readiness-checklist fetch/gate, both `togglePublish()`/`onPublishConfirm()` functions and their `PUT /passport/:id/publish`/`/unpublish` calls, the "Ready to publish" band, the `PUBLISHED` document-access tier's distinct UI (now folds into "Included when shared," same as `ELIGIBLE`), and all related copy/CSS. The stated reasoning is that this specific app was never actually offering publish to users, so the half-built UI for it was dead weight.

**This directly contradicts two things at once:**
1. **Your answer to the repo-reconciliation question** — "port `website-new`'s hero work (Publish button, readiness band) to `website-integration` first" — is now asking me to bring back, in `website-integration`, the exact feature that repo's own team just deliberately removed today, for a stated reason ("this app never lets users publish").
2. **The client's own History spec**, which explicitly requires "Manage visibility controls private versus published public passport. Public publication is separate from granting a collaborator access" — i.e. a real public/private publish concept, which is precisely what was just stripped out of `website-integration`.

I don't know why this commit landed same-day as your request (possibly unrelated work by whoever maintains that repo, possibly a reaction to something I'm not aware of) — I'm flagging it rather than guessing. Two honest paths forward:

- **(a)** Treat this as a signal that `website-integration` is intentionally becoming a share-only, no-publish product, and adapt "Manage visibility" for that app to mean "control who can access a share link" rather than "public/private passport publication" — while `website-new` and `mobile-webapp` (which do have publish) get the full public/private version. This means the three apps end up with **genuinely different versions of Manage visibility**, not one consistent feature.
- **(b)** Treat today's commit as something to revisit/discuss with whoever made it before building on top of it, since it's now directly in tension with a client requirement that (per the dev-handoff doc's date) was written the same day. Confirm intent before re-adding publish machinery on top of a same-day deletion.

**Resolved (2026-09-25):** the removal was intentional — confirmed. We do not revert it. Resolution: the backend publish/unpublish capability and event model stay identical across all three apps (it's one shared backend regardless of which frontend a request comes from). Each frontend independently decides whether to *expose* publishing in its Manage visibility control:
- `website-new` and `umu-mobile-webapp`: Manage visibility shows both the public/private publish toggle *and* the share-link/document-selection flow.
- `website-integration`: Manage visibility shows only the share-link/document-selection flow — no public/private toggle rendered. A passport touched via this app can still technically be published (e.g. if the owner also uses another app, or an admin action), it's just not a control this app's UI surfaces.

This is a small, contained difference (one conditional in the Manage-visibility component, not a data-model fork) and unblocks Phase 6. §4.6's answer (port `website-new`'s hero groundwork to `website-integration`) still stands for everything except the publish *toggle* specifically — port the hero layout, readiness-band pattern, and Buyers-tab groundwork, but leave the publish-toggle UI out of `website-integration`'s Manage-visibility drawer per this resolution.

---

## 1. What the client is actually asking for

Trimmed to the essentials (the full spec is much more detailed — see the source doc):

1. Replace the **Timeline** tab's sale-stage tracker (`Issued → Matched → Published → Offer → Exchange → Complete`) with **History**: a filterable, paginated, chronological feed of *every meaningful passport event* — question answers changed, documents uploaded/replaced/removed, verification, publication, access changes — each with actor, source, before/after, and a linked action where relevant.
2. Move **Collaborators** and a new **Manage visibility** control side-by-side *inside* the hero, replacing today's separate collaborators strip and "Share Passport" button.
3. Add a **rule engine**: versioned rules that evaluate question answers + evidence and generate persistent "actions" (e.g. "Find your window paperwork") that show in a "Needs your attention" panel and in History, with supersede/reopen logic as answers change.
4. Proper **authorization scoping** on all of this: owner sees everything; a collaborator or buyer sees only what they've been granted, for as long as they've been granted it; a public visitor sees only the published projection.
5. Data integrity requirements: append-only event storage (in the "our own app can't silently edit it" sense, not cryptographic immutability — the client is explicit that the current "block-stamped" language is inaccurate and must go), before/after capture, no fabricated history on migration.

The client's own document is candid about scope: it says the ~500-question rule catalogue **cannot be mapped yet** ("does not claim all ~500 rules are already specified") and needs legal/content review before the rules and copy ship. That's their own scoping decision, not something I'm inferring — worth designing around it rather than trying to build the full rule catalogue now.

---

## 2. Current state — what actually exists today

### Backend (`umu-backend`)

- **Data model**: `PassportActivity` — a flat log line (`type, title, actor, icon, hash, metadata Json, createdAt`). No before/after capture, no foreign key to the specific question/document/collaborator it concerns, no "actor type" distinction (system vs human), no separate "action" entity at all. `hash` is explicitly cosmetic (the code comment says so directly).
- **Event coverage today is narrow**: only 6 event types ever actually fire, from exactly 2 trigger points in the whole codebase — `PUBLISHED`, `UNPUBLISHED`, `SECTION_COMPLETED`, `SECTION_PRIVATE`/`SECTION_PUBLIC`, and one lazily-seeded `ISSUED`. The stage-tracker labels `MATCHED`, `OFFER`, `EXCHANGE`, `COMPLETE` are referenced by the read endpoint's stage calculation but **nothing ever emits them** — they're dead/aspirational, never real data. Question answers, document upload/replace/delete, collaborator add/remove, verification/KYC, share-link creation, and buyer unlocks are **never logged today**.
- **Read API**: `GET /passport/:id/timeline` returns the entire unbounded event list, no pagination, no filtering, with a three-way binary access check (owner / any collaborator / anyone if published) — a collaborator or a buyer currently sees the identical full list an owner sees, no per-grant scoping.
- **No rule engine exists.** The closest thing, `src/common/passport-readiness.ts`, is a stateless completeness calculator that only powers the publish-readiness gate: it checks "is this required question answered," not value-based conditions, has no persistence, and has no concept of an action with a lifecycle (open/superseded/reopened). Its conditional-trigger evaluation logic is a reasonable starting point to extend, but it isn't a rule engine as the spec describes one.
- **No document/answer versioning at all.** Uploads overwrite in place, deletes are hard deletes, question answers are upserted with no prior-value retention. "Document replaced" and "previous answer" as distinct, retrievable history entries require a genuinely new data model, not just a new log line.
- **Access control is three separate, non-unified mechanisms**: `PassportCollaborator` is all-or-nothing (no role or section scope field exists on it at all — a collaborator gets full owner-equivalent access); `PassportSection.visibility` is a binary public/private flag per section; `DocumentAccessLevel` + `DocumentAccessGrant` give real per-document, per-person scoping but are siloed from the other two. The client's "Manage visibility" + "Collaborators" two-button model implies these need to be reasoned about as one coherent system, which they currently aren't.

**Bottom line: this is close to a new subsystem, not an extension.** New schema, write-path instrumentation across ~5 services (question, documents, files, passport collaborator methods, KYC/verification), a real rule engine, a document-versioning model, and a consolidated access/visibility layer.

### Frontend — `umu-website-integration` & `umu-website-new`

These two repos are **separate git remotes** (`vy848698-coder/Umoving-ClaimedProperty` + a client mirror vs. `vy848698-coder/umovinguwebsite-new`) that share a lot of historical code but have **diverged materially in exactly the area this feature touches** — roughly 950 changed lines in `pages/passportview/[id].vue` (4144 vs 4111 lines) concentrated in the hero and publish flow:

- The **Timeline tab itself is functionally identical** in both repos (same stage tracker, same hardcoded `['Issued','Matched','Published','Offer','Exchange','Complete']` default, same `GET .../timeline` call) — this part genuinely can be written once and ported with only line-offset changes.
- The **hero is not navy-background in either repo today** — it's a light teal/white gradient card. Navy (`#231d45`) is used for text and the `PassportCard` book-render art, not as a panel fill. (More on this in §4.)
- **`website-integration`** still has the old flow: hero's single action button is **"Share Passport"**, which opens `ShareReviewDrawer` → generates a public read-only link with an optional selected-document set (`POST /passport/:id/share`). This is a genuinely different mechanism from "publish" — it's an ad-hoc shareable link, not a public/private toggle.
- **`website-new`** has already replaced that: hero buttons are **Publish/Unpublish** (wired to the real `PUT /passport/:id/publish`) plus **Match to buyers**, there's a readiness band showing publish-blockers, a 5th **Buyers** tab, and `PublishPassportDrawer` already previews which documents will be visible on publish — i.e. `website-new` has already built a rough draft of roughly half of what "Manage visibility" needs to be. `website-integration` has not.
- Collaborators strip, `AddCollaboratorModal`, `DocumentAccessDrawer` (the existing per-document Private/Selected-people/Include-when-shared control), and the core composables are **byte-identical** across both repos — low-risk to touch once.
- Styling is hand-written scoped CSS per file (not Tailwind), hardcoded hex colors matching brand (`#231d45` navy, `#00A19A` teal), no shared design-token file for the page itself (though `website-new`'s `PublishPassportDrawer` does use a small set of CSS custom properties — worth finding and reusing their source).

### Frontend — `umu-mobile-webapp`

Confirmed (again, independently) as the older, superseded implementation: a single 2719-line monolithic page with mostly inline `$fetch` calls (bypassing the composable pattern used elsewhere, despite Pinia being available), an icon system that's visibly been patched incrementally (mixed custom 3D icons, raw PNGs, literal emoji), and the same fake "block-stamped hash" Timeline copy as the other two.

- **Hero is also not navy** here (light gradient, same as the other two repos) — the "navy hero" framing in the client's spec doesn't match *any* of the three live apps.
- **There is no "Share Passport" button in this app at all.** The closest analog is a Publish/Unpublish button (same underlying endpoint as `website-new`'s).
- Timeline tab: same stage tracker, same hardcoded stages, same shared backend endpoint — no divergence from the other two repos on this specific feature.

---

## 3. Effort/complexity reality check

| Piece | Size |
|---|---|
| Backend: new event/action data model + write-path instrumentation | Large — new schema, touches ~5 services |
| Backend: rule engine infrastructure (not the rule *content*) | Medium-large — new subsystem, but the readiness engine's conditional logic is a real head start |
| Backend: rule *catalogue* (the ~500 questions → rules) | **Explicitly out of scope per the client's own document** — needs content/legal work first; do not schedule this alongside the engineering build |
| Backend: document/answer versioning | Medium — new tables, changes to 3 services |
| Backend: consolidated access/visibility + scoped History reads | Medium-large — reconciling 3 existing mechanisms into one coherent model |
| Frontend: History tab UI (list, filters, drawers) | Medium per repo — but the Timeline tab is identical across all 3 repos today, so build once, port 3x with modest adaptation |
| Frontend: hero restructure (Collaborators + Manage visibility) | **Uneven** — `website-new` is ~80% there (Publish button, readiness band already exist); `website-integration` needs that groundwork built essentially from scratch (still has the old Share-link flow); `umu-mobile-webapp` needs it built in a structurally different, non-componentized codebase |

Three frontends sharing one backend, with two of the three frontends already diverged in exactly this UI area, means the frontend cost here is closer to 2.5–3x a single build, not a copy-paste across three targets.

---

## 4. Where the client's documentation doesn't match reality, or leaves a real decision open

These aren't nitpicks — each one changes what gets built, so I'd rather flag them now than guess and redo work later.

### 4.1 "Preserve the current navy hero" — DECIDED
**Answer: keep today's light hero styling in all three apps; just rearrange content (add Collaborators + Manage visibility into it) rather than recoloring it.** No visual redesign to navy.

### 4.2 The ad-hoc share-link feature — DECIDED, but now entangled with §0
**Answer: this capability should exist in all three apps**, not just `website-integration`. Reading this together with §0's discovery: `website-integration` currently treats "share a link" as the *only* access-granting mechanism (publish was just removed); `website-new`/`mobile-webapp` have both a share-adjacent flow and a real publish/unpublish toggle. Making the link-share feature consistent across all three, while also resolving §0's publish-vs-share tension, likely means: **Manage visibility becomes a single control that offers both** — "generate a share link with chosen documents" and (where the app supports it) "publish the whole passport publicly" — rather than one or the other. This needs to be confirmed once §0 is resolved, since it determines whether `website-integration` gets publish machinery added back or `website-new`/`mobile-webapp` keep publish alongside share.

### 4.3 The rule engine's first (and only fully specified) rule needs legal sign-off before it ships
The spec's own "illustrative example" (windows/FENSA paperwork) comes with explicit constraints on what the copy must *not* claim (no automatic retrospective planning permission, no guaranteed indemnity acceptance, no fixed resolution time). That's legal-liability-sensitive copy for a platform that isn't a solicitor. **Recommendation:** build the rule engine as generic, empty infrastructure first (can evaluate a rule, can create/supersede/reopen an action, ships with zero or one demo rule), and treat "write and legally review the actual rule catalogue" as a separate, ongoing content workstream that doesn't block the History ship. Trying to have real compliance-sensitive rule copy ready alongside the engineering work would meaningfully slow this down for the wrong reason.

### 4.4 "Manage visibility" needs to be defined against three existing, non-unified mechanisms
Today: section-level visibility (binary, per section), document-level access (four tiers: private/selected/eligible/published, already fairly granular), and whole-passport publish status are three separate things. The spec's "Manage visibility" (private/public selection + exact public preview + explicit confirmation) sounds like a generalization of the *existing* publish flow (which `website-new`'s `PublishPassportDrawer` already half-implements with its document-visibility preview) — not a replacement for the granular per-document access system, which should keep governing collaborator-scoped access. I'd model it as: **Manage visibility = owns public/private + the public projection review** (extends today's publish flow); **Collaborators = owns named-person invites + what scope they get** (needs a real role/scope field added to `PassportCollaborator`, which doesn't exist today). Flagging this now so it's an explicit design decision rather than something that gets implicitly decided by whoever writes the first PR.

### 4.5 Is `umu-mobile-webapp` actually still in scope? — DECIDED
**Answer: yes, still live, include it.**

### 4.6 `website-new` vs `website-integration` reconciliation — DECIDED, but see §0
**Answer: port `website-new`'s hero work (Publish button, readiness band) to `website-integration` first**, as the lower-total-effort path. This is the right call *if* `website-integration`'s removal of publish (§0) was incidental rather than deliberate. If it turns out to be a deliberate product decision specific to that app, this answer needs revisiting — porting publish machinery back in would directly undo a same-day, explicitly-reasoned commit. **This is the one open question I'd resolve before writing any frontend code.**

---

## 5. Proposed delivery plan

Structured to de-risk the biggest unknowns first and avoid building the frontend twice against a moving backend contract.

### Phase 0 — Decisions (this doc's §4, before any code)
Resolve 4.1–4.6 with you/the client. Everything below assumes those answers are in.

### Phase 1 — Backend: event model + instrumentation
1. New schema: a proper event table (or `PassportActivity` v2) with the fields the spec lists — actor type/id, entity type/id, section, source type, before/after refs, visibility class, correlation id, rule linkage — replacing the current flat shape rather than extending it.
2. New `PassportAction` entity: status (open/superseded/reopened/addressed), linked rule, linked answer/evidence, timestamps.
3. Instrument the real write paths that don't log anything today: question answer changes (`question.service.ts`), document upload/replace/remove (`documents.service.ts`, `files.service.ts`), collaborator add/remove and access-scope changes, verification/KYC status changes, publish/unpublish (already logs, needs the richer shape), share-link/buyer-access creation.
4. New paginated, filtered, permission-scoped `GET` history + event-detail endpoints per the spec's contract shapes.
5. Retire the stage-tracker calculation and the four dead stage types entirely (safe — confirmed nothing real ever populates them).

### Phase 2 — Backend: document/answer versioning
A `UserDocumentVersion`-style model (or soft-delete + supersession chain) so "replaced"/"removed from view" are real, retrievable states rather than overwrites. This is a prerequisite for Phase 1's document events to be meaningful, not optional polish.

### Phase 3 — Backend: access/visibility consolidation
Add role/scope to `PassportCollaborator` (currently has none). Define "Manage visibility" as the generalized public/private + projection-review flow per §4.4. Wire History's read scoping to actually respect grants (owner full access; collaborator scoped; buyer scoped + time-limited; public gets the approved projection only) — this is currently binary and needs to become real per-grant filtering.

### Phase 4 — Backend: rule engine (infrastructure only)
Versioned rule table/evaluator, wired into the answer-save path per the spec's evaluation sequence (save → evaluate → create/supersede action → return guidance → re-evaluate on future changes). Ship with zero or one demo rule (§4.3) — the catalogue is a separate, ongoing workstream.

### Phase 5 — Frontend: History tab (build once, port 3x)
Since the Timeline tab is functionally identical across all three repos today, build the new History list/filters/date-grouping/drawers once (against whichever repo is most convenient — I'd suggest `website-integration` or `website-new`, whichever Phase 0 decides is canonical), verify against the real backend, then port to the other two. `umu-mobile-webapp`'s port will need more adaptation given its different (inline, non-componentized) structure.

### Phase 6 — Frontend: hero restructure (Collaborators + Manage visibility)
Per §4.6, ideally after `website-new`'s existing hero groundwork is reconciled with `website-integration` (or a documented decision that they stay separate). Then: move Collaborators + Manage visibility into the hero side-by-side, remove the old collaborators strip and Share-Passport/old-publish-button, wire Manage visibility to the Phase 3 backend contract, add role/scope selection to the Collaborators invite flow.

### Phase 7 — QA against the client's own build checks
The spec's §8 lists 8 concrete acceptance checks (no invented history on a fresh passport, one event per real change with no duplicates on re-save, rule → action → supersede/reopen lifecycle, evidence upload records version+source, private data unreachable via public URL or unscoped collaborator, publish requires explicit review, pagination/filtering correctness at scale, no "immutable"/"block-stamped"/transaction-stage language anywhere in the UI). Use these as the literal test plan.

---

## 6. Implementation progress

**Phase 1 — backend event model + write-path instrumentation: DONE (2026-09-25), verified end-to-end.**

Built: `PassportEvent` (the new History log), `PassportAction`/`PassportRule` (rule engine + one real seeded demo rule on the actual windows/warranty question), `DocumentVersion` (retention on delete), role/scope fields on `PassportCollaborator`. New endpoints: `GET :id/history` (paginated, filtered, permission-scoped), `GET :id/history/:eventId` (detail, re-checks permission), `GET :id/actions`, `PATCH :id/actions/:id/addressed`, `PATCH :id/actions/:id/reopen`. Instrumented: passport creation/claim/activation, publish/unpublish, section visibility, collaborator add/remove, question answer add/change/clear, question file upload/replace, personal-vault document upload/delete (soft-delete + version row, no more hard deletes). `/timeline` was left completely untouched — still returns exactly what it did before, so none of the three live frontends broke.

Tested live against the local dev backend with two throwaway accounts: created a passport → confirmed `PASSPORT_CREATED` event; answered the seeded rule's question "no" → confirmed `QUESTION_ANSWER_ADDED` event AND an auto-created `PassportAction` AND its `ACTION_CREATED` event, all correctly linked via `correlationId`; changed the answer to "yes" → confirmed the action was superseded with a reason and the earlier events were retained; changed back to "no" then re-saved the same value → confirmed a fresh action was created and the duplicate save did NOT create a second one; marked the action addressed → confirmed status/actor/timestamp recorded; fetched event detail → confirmed before/after values returned correctly; fetched history as a completely unrelated second user → confirmed a clean 403. All test data cleaned up afterward.

Explicitly deferred (not silently dropped — see §3 for why): ownership-verification events (no passport exists yet at that point in the flow, so there's nowhere to attach the event until activation, which is already covered), and the rule catalogue beyond the one demo rule (per the client's own document, needs legal/content review first).

**Phase 5 — frontend History tab, built once and ported to all three apps: DONE (2026-09-25), compile-verified.**

Replaced the Timeline tab (sale-stage tracker + fake "block-stamped" copy) with the new History tab in `website-new`, `website-integration`, and `umu-mobile-webapp`: filterable feed (All/Information/Documents/Actions/Access), day-grouped events, a "Needs your attention" panel backed by the new Actions API, and a detail drawer for both events (before/after, source, linked action) and actions (explanation, suggested steps, mark-addressed). Built once against `website-new`, then ported to the other two with per-app adaptation:
- `website-new`: full sidebar layout (feed + "Needs your attention"/"You control access" side panel), matching its existing desktop two-column pattern.
- `website-integration`: same layout; "Manage visibility" link in the privacy panel points at the existing `ShareReviewDrawer` (its current closest equivalent) rather than a publish toggle, per the §0 resolution above — no publish/unpublish UI was added back.
- `umu-mobile-webapp`: adapted to its single-column mobile layout ("Needs your attention" as a panel above the feed, not a sidebar) and its rem-based CSS convention; left its pre-existing, unrelated uncommitted work (`pages/claim/[id].vue`, a `truevalue` feature) untouched.

All three repos were pulled fresh immediately before this work (confirmed no new upstream commits since §0). Each was booted with its real dev server afterward and the passport-view page fetched directly — all three compiled and rendered with zero Vue/Nuxt errors in the server log. `git status` in each repo confirms the diff is scoped to exactly the intended files.

**Phase 6 — hero restructure: DONE (2026-09-25) for the "move Collaborators + Manage visibility into the hero, remove the separate strip" part; compile-verified in all three repos.**

Removed the standalone collaborators row from below the hero in all three apps and folded it into a hero-actions button ("N collaborators", opens the existing invite modal) sitting beside a renamed "Manage visibility" button. Per-app:
- `website-new`: hero-actions now reads Collaborators / Manage visibility / Match to buyers — the old "Publish Passport"/"Unpublish" button was relabelled "Manage visibility" (a status badge shows Private/Public); underlying mechanism (`togglePublish`, `PublishPassportDrawer`, the readiness band) is untouched, only the trigger's framing changed. Removed the now-dead `publishButtonLabel` computed.
- `website-integration`: same pattern, but per §0's resolution there's no publish toggle here — "Manage visibility" opens the existing share-link review flow (`shareReviewOpen`), the closest equivalent this app offers.
- `umu-mobile-webapp`: same restructure adapted to its layout — Collaborators + Manage visibility moved from a separate action row + collaborators row into one row inside the hero card; Match to Buyers kept as a full-width button beneath it. Removed the now-dead `publishButtonLabel` computed here too.

All three re-verified the same way as Phase 5 — booted, fetched, checked server logs, zero compile errors. `git status` still shows only `pages/passportview/[id].vue` touched per repo (plus the unrelated refresh-token/mobile-webapp changes already noted).

**"Exact public preview" — DONE (2026-09-25) for all three apps, compile-verified.**

Checked each app's existing drawer against the spec's actual requirement ("exact public preview... never publish the vault, private answers, actions, or change history by default") rather than assuming a rebuild was needed:
- `website-integration`'s `ShareReviewDrawer` already did this correctly — an explicit, per-document checklist of exactly what's included, editable before confirming, with "everything else stays in your Vault" stated outright. No change needed.
- `website-new`'s `PublishPassportDrawer` already had a "Documents that will be visible" preview (sourced from the Vault tab's per-document Published tier). No change needed.
- `umu-mobile-webapp`'s `PublishPassportDrawer` was missing this entirely — it showed a generic private/public explainer with no actual preview of what would go public. Since this app's real visibility mechanism is section-level (not per-document, per the schema's own comment marking that model "mobile app, untouched"), added a "Sections that will be public" preview sourced from the Vault tab's real Public/Private section toggles, plus a fallback message if nothing is set to Public yet (so a seller can't be surprised by publishing to an empty passport). Also made sure vault data loads before the drawer opens even if the owner never visited the Vault tab first — `website-new` already did this, mobile-webapp didn't.

Re-verified with the same boot-and-fetch method; clean compile, `git status` scoped to the intended files only.

**Collaborator role/scope UI — DONE (2026-09-25), verified end-to-end against a live backend.**

Backend: `getCollaborators` now returns `role`/`sectionKeys`/`historyAccess`/`expiresAt`; `addCollaborator` accepts `historyAccess` at invite time (role/sectionKeys were already wired in Phase 1); added a new `PATCH :id/collaborators/:collaboratorId` endpoint (owner-only, scoped to the passport the same way `removeCollaborator` already was, per the H5 IDOR fix) that updates role/scope and logs a `COLLABORATOR_SCOPE_CHANGED` History event.

Frontend: extended `usePassportCollaborators` with `updateCollaboratorScope` in all three repos. In the invite modal:
- `website-new`/`website-integration` (identical modal): added a role dropdown (Solicitor/Estate agent/Co-owner/Buyer/Other) and a "Passport history" checkbox at invite time, plus a per-collaborator history-access toggle on the existing-collaborators list.
- `umu-mobile-webapp` (a structurally different multi-select/chip-based modal): added the same role dropdown + history checkbox, applied to the whole batch being added in one go (its flow adds several people at once, so a per-person picker wasn't a fit), plus the same per-collaborator toggle on the existing list.
Document-level scoping was deliberately left where it already lives (the per-document access drawer in each app's Vault tab) rather than duplicated into the invite flow — a collaborator's document access has always been chosen per-document after they're added, which this doesn't change.

Verified live end-to-end with two throwaway accounts: invited a collaborator with `role: "Solicitor"`, `historyAccess: false` → confirmed `getCollaborators` returns the stored role/scope → confirmed the collaborator's own `GET .../history` call correctly 403s ("This collaborator does not have history access") → owner `PATCH`es `historyAccess: true` → confirmed the same collaborator can now read History → confirmed a real `COLLABORATOR_SCOPE_CHANGED` event was logged and shows up under the `access` filter. Compile-verified in all three frontends (booted, fetched, checked logs) and the backend (`tsc --noEmit` clean). Test data cleaned up afterward.

**Phase 7 — QA against the client's 8 build checks: DONE (2026-09-25). Found and fixed one real bug.**

Went through the spec's §8 checklist literally, against a live backend with real test accounts, not just code review:

1. **Fresh passport shows only real events, no invented entries.** ✅ Verified live — a newly-created passport's history contains exactly one `PASSPORT_CREATED` event, nothing else.
2. **One event per real change, correct actor/timestamp/before-after, no duplicates on re-save.** ⚠️ → ✅ **This check caught a real bug**: `answerQuestion` was logging a new event on *every* call regardless of whether the value actually changed, so a duplicate/idempotent save (a double-click, a form re-render firing an unchanged autosave) would have polluted History with identical-looking entries — exactly what this build check exists to catch. Fixed by comparing the new value against the previous one (by value, not just presence) and skipping the event write when nothing changed. Verified live: 4 identical saves in a row → exactly 1 event; changing the value afterward → exactly 1 new `QUESTION_ANSWER_CHANGED` event with correct before/after/actor/timestamp, old event retained untouched.
3. **Rule match → guidance + one persistent action; answer change supersedes/reopens; earlier events kept.** ✅ Already verified live in Phase 1's testing (create → supersede → recreate → no duplicate on repeat save) — re-confirmed the pattern still holds after the check #2 fix.
4. **Evidence upload/replace records version + source, doesn't claim verification.** ✅ Verified live — first upload logs `DOCUMENT_UPLOADED`, a second upload to the same question logs `DOCUMENT_REPLACED` (not a silent overwrite); confirmed the "mark as addressed" copy in both the backend event metadata and all three frontend drawers explicitly says this is not a compliance verification.
5. **Private history unreachable via public URL or unscoped collaborator; revoked access fails on next read.** ✅ Verified live on three fronts: no-token request → clean 401; invited collaborator can read → owner removes them → their very next read (no caching, no delay) → clean 403.
6. **Publication requires explicit review; private fields/vault stay private.** ✅ Verified by code inspection (unchanged from before this project) — `onPublishClick` always opens the review drawer first; there is no direct one-click publish path. Combined with Phase 6's "exact preview" work, this now also shows real content, not just a readiness gate.
7. **Pagination/filtering stays correct at scale, no duplicates/gaps.** ✅ Verified live — walked a 10-event passport across 4 pages at `limit=3`, collected all returned IDs: exactly 10, all unique, no overlap between pages, cursor correctly terminates with `nextCursor: null`.
8. **No "immutable"/"block-stamped"/transaction-stage language anywhere in the UI.** ✅ Verified by grep across all three frontends' live templates and all backend response strings — the only matches anywhere are in my own code comments (never sent to a client or rendered).

All test data cleaned up afterward; `tsc --noEmit` clean.

**Still remaining, not blocking:** the old `.pp-collab-row`/`.pp-collab-*` CSS classes in `website-new` and `website-integration` are dead code (no longer referenced by any template) — harmless, worth a cleanup pass sometime.

---

## 7. Status — all phases complete

§0–§4's open questions were all resolved early (see above). Phases 1 through 7 are built, compile-verified in all four repos, and tested live against a real backend rather than assumed correct from code review alone. The one real bug this project's QA pass found (§6, check #2 — duplicate History events on unchanged re-saves) is fixed and re-verified.
