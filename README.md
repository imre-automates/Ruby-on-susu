# Baby Tracker

> Forked from [MaxHasan/ai-tracker-app](https://github.com/MaxHasan/ai-tracker-app) —
> credit to Max for the original two-axis feed model and dashboard. This fork adds
> a configurable Settings tab, Vitamin D and paracetamol dose tracking, a shared
> daily-remarks journal, AI-assisted daycare-screenshot import, and a fuller
> editable Timeline. See [License](#license) for attribution details.

A private, self-hosted baby-tracking web app for two or more caregivers on separate
phones with realtime sync. Log feeds, pumping, sleep, diapers, medication and
growth; see a dashboard with intake vs. a weight-scaled target, formula share,
breast-milk supply, sleep and diaper adequacy.

Installs to the home screen as a progressive web app (PWA), runs free on Supabase +
Vercel, and every family's data stays in **their own** Supabase project.

## Why it exists

Most trackers model a feed as a single "type", which loses information. This app
keeps feeds on **two independent axes**:

- **Delivery** — direct at the breast vs. bottle
- **Substance** — expressed breast milk vs. formula

A bottle of expressed milk shares its *substance* with a direct latch but its
*delivery* with formula. Keeping these separate is what makes the KPIs (formula
share, supply vs. demand, direct-vs-bottle balance) meaningful.

## Features

- Multi-caregiver access with realtime sync (Supabase Realtime + row-level
  security) — invite a partner, grandparent, or anyone else by email
- **Settings tab**, per baby: show/hide and drag-reorder every log item, set
  bottle defaults/presets, tune the next-feed interval window, configure how
  many paracetamol doses are allowed per day, and toggle each Dashboard card
- Quick-add for:
  - Bottle and direct breastfeed (with a per-side nursing timer)
  - Pump (L/R), diaper, sleep (including a backdated "asleep now" start with
    no end time yet), and weigh-ins
  - **Vitamin D** — a shared daily checkbox, resets automatically at midnight
  - **Paracetamol** — logs a timestamped dose, warns if it's given sooner than
    the clinical 4h minimum gap, and a companion "Next paracetamol" card shows
    the next safe window and a rolling-24h dose count against your configured
    daily limit
  - **Daily remarks** — a shared, dated journal both caregivers can write to
  - **Daycare import** — a batch-entry card for a daycare's end-of-day
    summary; type rows manually, or upload/paste a screenshot of the
    daycare's own summary and an AI call pre-fills the rows for you to review
    before saving
  - All of the above are retroactively loggable
- **Dashboard**: daily intake by source vs. a weight-scaled target
  (~150 mL/kg/day), formula % (today / 7-day / all-time), breast-milk supply
  (direct estimate + pumped L/R), rolling-24h diaper adequacy, sleep (24h and
  a "last sleep" card), plus charts for intake vs. target, supply, and a
  sleep-per-day chart with a rolling average line
- **Timeline**: a filterable (chips reflect what's visible in Settings),
  editable, deletable log of every entry — nothing you log is permanent if
  you made a mistake
- Optional: import history from a previous tracker's CSV export

> **Not medical advice.** Estimates (especially direct-breast intake, which
> can't be measured) are modeled, not measured, and the paracetamol tracker is
> a reminder/logging tool, not a dosing calculator — always follow your
> product's label or your pediatrician's guidance for actual dose amounts.
> Weight checks with your pediatrician remain the source of truth.

## Tech

Vite + React + TypeScript, Tailwind, Recharts, `vite-plugin-pwa`,
`@dnd-kit` (Settings drag-reorder); Supabase (Postgres + Auth + Realtime)
backend; deploys on Vercel. The optional daycare screenshot parser
(`api/parse-daycare.ts`) is a Vercel serverless function calling the
Anthropic API.

## Self-host it

You need free **Supabase** and **Vercel** accounts, and Node 20+.

### 1. Supabase

1. Create a project at supabase.com.
2. **SQL Editor → New query** → paste all of [`supabase/schema.sql`](supabase/schema.sql) → run.
   This creates every table, row-level security policy, the caregiver model,
   and realtime — one run sets up the whole app, including Vitamin D,
   paracetamol, daily remarks, and per-baby settings.
3. **Authentication → Sign In / Providers → Email**: for a private family app,
   turn **off** "Allow new users to sign up" after everyone's created their
   account (invite-only). Optionally disable email confirmation for known users.
4. **Project Settings → API**: copy the Project URL and the publishable (anon)
   key.

### 2. Run locally

```bash
cp .env.example .env.local     # fill in VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

Sign up. The **first** caregiver fills in the baby's name / DOB / birth weight
once. Anyone else signs up, then the first caregiver opens **Caregivers** at
the bottom of the Log tab and invites them by email — this links both
accounts to the one baby. Don't create a second baby record (see *Duplicate
records* below).

### 3. Deploy

Push to GitHub, import the repo in Vercel (framework auto-detects Vite), add the
two `VITE_*` environment variables, and deploy. On each phone, open the URL and
**Add to Home Screen** (iOS Safari) / **Install app** (Android Chrome) for the
standalone PWA.

### 4. Optional — import history from a CSV

If your previous tracker exports a CSV (see the column format in
[`src/lib/csv-import.ts`](src/lib/csv-import.ts)), you can bulk-import it:

```bash
# dry run — parses and prints a daily summary, writes nothing
npm run import:dry -- "path/to/export.csv"
# apply — needs SUPABASE_SERVICE_ROLE_KEY in .env.local
npm run import -- "path/to/export.csv" --apply
```

Timestamps in these exports are local wall-clock with no timezone, so run the
import on a machine set to the timezone the log was recorded in. Imports are
idempotent — re-running on an overlapping export only adds new rows.

### 5. Optional — AI daycare screenshot import

The "🏫 Daycare import" card can pre-fill its sleep/feed rows from a photo of
your daycare app's daily summary, via `api/parse-daycare.ts`. Without this
step the card still works fine as a manual row-entry form — this just adds
the upload/paste shortcut.

1. Get an API key from console.anthropic.com. You'll need to fund the account
   (a small prepaid minimum) before a key actually works — usage itself is a
   fraction of a cent per screenshot, well under that.
2. Set a hard monthly spend cap on the key in the Anthropic console — the
   code caps `max_tokens` and uses the cheapest vision-capable model, but the
   account-level cap is the real backstop.
3. In Vercel → Settings → Environment Variables, add `ANTHROPIC_API_KEY`
   (server-only — **no** `VITE_` prefix) and redeploy.
4. The prompt in `api/parse-daycare.ts` is tuned to one specific daycare
   app's "Dagritme" summary format — edit its "Conventions" section to match
   yours.
5. On the Daycare import card, either tap the upload button or just paste a
   screenshot from your clipboard (Cmd/Ctrl+V) directly into the card.

## Notes

**Duplicate records.** The app never auto-creates a baby, but if two records
ever exist for one baby (e.g. two caregivers both tapped "create" before
inviting each other), logging and viewing can land on different ones and
data appears to vanish. The app warns you when it sees more than one. To fix:
pick the record to keep and re-point the others' rows to it in SQL, e.g.

```sql
-- replace with the id to KEEP and the id to MERGE from
update feeds              set child_id = 'KEEP' where child_id = 'DROP';
update pumps               set child_id = 'KEEP' where child_id = 'DROP';
update diapers             set child_id = 'KEEP' where child_id = 'DROP';
update sleeps              set child_id = 'KEEP' where child_id = 'DROP';
update growth              set child_id = 'KEEP' where child_id = 'DROP';
update paracetamol_doses   set child_id = 'KEEP' where child_id = 'DROP';
update daily_remarks       set child_id = 'KEEP' where child_id = 'DROP';
-- vitamin_d_doses is keyed on (child_id, dose_date) — drop DROP's rows for
-- any date KEEP already has one, then move the rest
delete from vitamin_d_doses where child_id = 'DROP'
  and dose_date in (select dose_date from vitamin_d_doses where child_id = 'KEEP');
update vitamin_d_doses     set child_id = 'KEEP' where child_id = 'DROP';
-- baby_settings is keyed on child_id alone (one row per baby) — KEEP's row
-- already covers it, so just drop DROP's instead of moving it
delete from baby_settings where child_id = 'DROP';
delete from children where id = 'DROP';
```

## Forking this

This is itself a fork, and you're welcome to fork it in turn — it's just a
self-hosted app with no shared backend, so every fork runs entirely on its
own free Supabase + Vercel + (optional) Anthropic account. See *Self-host it*
above for the full setup. If you add something worth sharing back, a PR is
welcome; if you'd rather just take it in your own direction, that's exactly
what the MIT license is for.

## License

MIT — see [LICENSE](LICENSE). Original work Copyright (c) 2026 Max Hasan;
later additions in this fork by Imre Scheffers.
