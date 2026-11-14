# Archive

One-off data-migration/content-correction scripts that already ran
against the database (dev, demo, and/or production) and are not meant
to run again — the starting state they corrected no longer exists, so
re-running most of them would be a no-op at best.

Kept for history (what changed, when, and why — see each file's own
header comment) rather than deleted outright. Moved out of
`src/scripts/` proper (security/launch review finding #17, 2026-11-14)
so the scripts still worth running again (seeding, backfills on a
fresh environment, HMLR test harnesses — see the `package.json`
`scripts` entries and the remaining files in the parent folder) aren't
buried alongside ~20 that aren't.

If you need to re-run one of these, read it first — check what it
assumes about the current data shape before pointing it at anything
that isn't a disposable local database.
