# Baby Tracker

A private, self-hosted baby-tracking web app for two or more caregivers on separate
phones with realtime sync. Log feeds, pumping, sleep, diapers, medication and
growth; see a dashboard with intake vs. a weight-scaled target, formula share,
breast-milk supply, sleep and diaper adequacy.

Installs to the home screen as a progressive web app (PWA), runs free on Supabase +
Vercel, and every family's data stays in **their own** Supabase project.

<!-- TODO: screenshots — Dashboard, Log tab, Settings tab -->

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
  - **Vitamin D** — a shared daily checkbox, resets at the device's local midnight
  - **Paracetamol** — logs a timestamped dose, warns if it's given sooner than
    a fixed 4h gap, and a companion "Next paracetamol" card shows the next
    safe window and a rolling-24h dose count against your configured daily
    limit (see *Design decisions & known limitations* below)
  - **Daily remarks** — a shared, dated journal both caregivers can write to
  - **Daycare import** — a batch-entry card for a daycare's end-of-day
    summary; type rows manually, or upload/paste a screenshot and an AI call
    pre-fills the rows for you to review before saving (the parsing prompt is
    tuned to one specific Dutch daycare app's "Dagritme" format out of the
    box — see setup step 5 to adapt it to yours)
  - All of the above are retroactively loggable
- **Dashboard**: daily intake by source vs. a weight-scaled target
  (~150 mL/kg/day, ramped up over the first week — see limitations below),
  formula % (today / 7-day / all-time), breast-milk supply (direct estimate +
  pumped L/R), rolling-24h diaper adequacy, sleep (24h and a "last sleep"
  card), plus charts for intake vs. target, supply, and a sleep-per-day chart
  with a rolling average line
- **Timeline**: a filterable (chips reflect what's visible in Settings),
  editable, deletable log of every entry — nothing you log is permanent if
  you made a mistake
- Optional: import history from a previous tracker's CSV export

> **Not medical advice.** Estimates (especially direct-breast intake, which
> can't be measured) are modeled, not measured, and the paracetamol tracker is
> a reminder/logging tool, not a dosing calculator — always follow your
> product's label or your pediatrician's guidance for actual dose amounts and
> timing. Weight checks with your pediatrician remain the source of truth.

## Security model

- Every data table (feeds, pumps, diapers, sleeps, growth, settings, daily
  remarks, Vitamin D, paracetamol) is gated by Postgres row-level security on
  `is_caregiver(child_id)` — a caregiver is anyone explicitly added to a
  child's `caregivers` row, either automatically (whoever creates the baby
  record) or via an invite by email from an existing caregiver.
- Anyone who signs up **can** create their own `children` row — that's by
  design, so you don't need an admin to onboard a new family — but doing so
  only makes them a caregiver of *that new, empty record*. RLS means they can
  never read or write a child they weren't explicitly invited to; there's no
  "public" or anonymous read path to any family's data.
- For a genuinely private, invite-only deployment, turn off public sign-ups
  in Supabase once everyone's created their account (see setup step 1.3).
- `api/parse-daycare.ts` (the AI import) requires a valid Supabase session
  JWT and confirms the caller is a caregiver on at least one child before it
  will call Anthropic — the endpoint is publicly reachable by URL, but an
  unauthenticated or unrelated caller cannot spend your Anthropic budget
  through it. It also caps the uploaded image at 5MB and ignores everything
  in the screenshot except sleep/feed rows. The image is sent to Anthropic's
  API (model `claude-haiku-4-5-20251001`) for parsing — if you're not
  comfortable sending a daycare screenshot to a third-party API, skip that
  setup step and use the manual row-entry form instead, which never leaves
  your Supabase project.

## Design decisions & known limitations

- **Paracetamol's 4h minimum gap is a fixed constant in the code**
  (`PARACETAMOL_MIN_GAP_H` in `src/lib/settings.ts`), not configurable
  through the UI like the daily-dose-count limit is. It's a conservative
  floor, not sourced medical guidance — actual safe intervals depend on the
  product and the baby's age/weight, so treat the warning as a reminder to
  check, not as dosing advice.
- **The 150 mL/kg/day intake target** is a common rule of thumb for young
  infants, already ramped from 60→150 mL/kg over the first week
  (`src/lib/types.ts`) rather than applied flatly from day one, and is
  overridable per baby in Settings → Dashboard (manual target override) for
  when it stops fitting as the baby grows.
- **`schema.sql` is idempotent and safe to re-run** on an existing project —
  every statement is `IF NOT EXISTS` / `CREATE OR REPLACE` / guarded against
  already existing, so pulling a fork update that adds a table and re-pasting
  the whole file picks up only what's missing. There's no formal migration
  system beyond that — for anything beyond "run the latest schema.sql again",
  you're working directly in the SQL Editor.
- **Duplicate baby records**: if this ever happens (see *Notes* below), use
  the `merge_duplicate_child()` SQL function in `schema.sql` rather than
  hand-written `UPDATE` statements — it's kept in sync with every table that
  has a `child_id`, runs as one transaction, and re-attaches any caregiver
  who was only invited to the record being dropped (otherwise they'd
  silently lose access to the baby entirely).

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
   and realtime — one run sets up the whole app. It's idempotent, so if you
   pull a fork update later, re-running the whole file is safe.
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
your daycare app's daily summary, via `api/parse-daycare.ts` (see *Security
model* above for what this endpoint does and doesn't expose). Without this
step the card still works fine as a manual row-entry form — this just adds
the upload/paste shortcut.

1. Get an API key from console.anthropic.com. You'll need to fund the account
   (a small prepaid minimum) before a key actually works — usage itself is a
   fraction of a cent per screenshot, well under that.
2. Set a hard monthly spend cap on the key in the Anthropic console — the
   code caps `max_tokens` and uses the cheapest vision-capable model
   (`claude-haiku-4-5-20251001`), but the account-level cap is the real backstop.
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
data appears to vanish. The app warns you when it sees more than one. To fix,
run this in the SQL Editor (see `merge_duplicate_child()` in
[`supabase/schema.sql`](supabase/schema.sql) for exactly what it does):

```sql
select merge_duplicate_child('KEEP-uuid', 'DROP-uuid');
```

## Credits & forking

Forked from [MaxHasan/ai-tracker-app](https://github.com/MaxHasan/ai-tracker-app)
— credit to Max for the original two-axis feed model and dashboard. This fork
adds the Settings tab, Vitamin D and paracetamol dose tracking, the daily
remarks journal, AI-assisted daycare-screenshot import, and the fully
editable Timeline.

This is itself a fork, and you're welcome to fork it in turn — it's just a
self-hosted app with no shared backend, so every fork runs entirely on its
own free Supabase + Vercel + (optional) Anthropic account.

## License

MIT — see [LICENSE](LICENSE). Original work Copyright (c) 2026 Max Hasan;
later additions in this fork Copyright (c) 2026 Imre Scheffers.
