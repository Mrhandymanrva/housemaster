# HouseMaster Ops — Richmond

Compliance, fleet, equipment and credential tracking for a HouseMaster franchise,
with a desktop app and a field app whose forms are configured from the desktop.

Node 20 · Express · Postgres · React · deploys to Railway from GitHub.

---

## What it does

**Desktop.** Every record type gets a list view, filters, search and an edit
drawer, generated from one catalog definition. The home screen is a compliance
horizon: every dated obligation in the business — license expirations, vehicle
registrations, state inspections, calibrations, insurance renewals, software
renewals, supply lot expirations — plotted on a single rail, overdue to the left
of today.

**Radon.** Sets, results, and chain of custody live here. Every 10th set on a
monitor goes out as a duplicate pair — the phone shows it, the API rejects a
deployment without it, and the database refuses to let the set reach Deployed
either way. Pairs that disagree by more than the tolerance get flagged so the
unit can be pulled.

**Field.** Techs get a phone app whose tiles and questions are rows in the
database. Turn a tile on in Setup → Field app and it appears on the phone the next
time it opens. Answers can map to a real column, so a van check writes the odometer
straight onto the vehicle record. Submissions queue offline and post when signal
comes back.

---

## Run it locally

```bash
createdb housemaster
cp .env.example .env          # set DATABASE_URL and JWT_SECRET
npm install                   # also installs web/
npm run dev:server            # migrations run automatically on boot
npm run dev:web               # http://localhost:5173
```

Load sample data and create the first login:

```bash
SEED_ADMIN_PASSWORD='pick-something-strong' npm run seed
```

Migrations in `db/migrations/` run in filename order on every boot and record
themselves in `schema_migrations`, so deploys are safe to repeat.

---

## Deploy to Railway

1. Push this repo to GitHub.
2. In Railway: **New Project → Deploy from GitHub repo**.
3. Add the **Postgres** plugin to the project. `DATABASE_URL` is injected for you.
4. Set one variable: `JWT_SECRET` (any 64 random characters).
5. Deploy. Railway reads `railway.json`, builds the Dockerfile, and health-checks
   `/api/health`.
6. Create your login once, from the Railway shell:

```bash
SEED_ADMIN_PASSWORD='pick-something-strong' npm run seed
```

The server serves the API and the built desktop app from the same service, so
there is one deployment and no CORS to manage.

---

## Adding a field to a screen

There is no screen code. Add the column, add one line to
`server/catalog/entities.js`, redeploy:

```js
F('inspection_zone', 'Zone', 'select', {
  list: 1, order: 45, w: 120, list_key: 'zone', section: 'Assignment'
})
```

The list view, the search, the filters, the edit form and the API all pick it up.
Labels and column order can then be adjusted in the app under Setup → Screens
without touching code — those edits set `user_modified` and survive the next
deploy.

---

## Layout

```
db/migrations/     schema, run in order on boot
db/seed/           sample data
server/
  catalog/         entity definitions — the source of truth for every screen
  routes/          auth, records (generic CRUD), ops (dashboard, compliance, field)
  lib/             db pool, auth, error helpers
web/src/
  components/      Horizon, DataTable, RecordDrawer, Icons
  pages/           Dashboard, Records, Compliance, FieldStudio, Inbox, Login
docs/              schema decisions, field app guide
```

---

## Security notes

- Passwords are bcrypt hashed. The database never stores a third-party credential —
  `credential_vault_ref` holds the *name* of your password manager entry.
- Four roles: owner, admin, office, field. Writes need office or higher, deletes
  need admin, field app configuration needs admin.
- Every column name that reaches SQL is checked against the catalog first, and all
  values are parameterized.
- Every create, update, delete and field submission is written to `audit_log`.

## The field app

`field/qa-guard.js` is the duplicate rule as the phone runs it — a pure module
with no imports, so the app, the service worker and the tests all share one copy.
`node field/qa-guard.test.js` runs its 18 checks.

`field/prototype.html` opens in any browser and shows what the tech sees: the
flagged tile, the red banner, the extra questions, and a send button that will
not light up until the pair is recorded. Switch the monitor and the signal to
watch the decision change.

The phone caches one row per monitor from `/api/radon/ledger` and decides
locally, so no signal never means no rule. When it cannot be sure — a monitor it
has never synced, a ledger older than two weeks — it asks for the duplicate
anyway. An extra pair costs one monitor-day; a missed one cannot be filled in
after the house has been tested.

## ISN

Inspection Support Network is the system of record for the job. This system reads
orders from it and never writes one back.

Setup, in order:

1. Ask ISN for an **access key and secret access key on a dedicated integration
   user** — not a person's login. ISN's change feed is consumed per user, so a
   shared login eats notifications other tools still need.
2. Put them in `ISN_ACCESS_KEY` and `ISN_SECRET_ACCESS_KEY`. They never go in the
   database.
3. Set the company key and switch the connection on:
   `PATCH /api/isn/connection {"company_key":"...","enabled":true}`
4. `POST /api/isn/sync` for a first pull, then run it on a schedule.

Each pull reads the footprint queue, follows every stub to its order, caches it,
drafts a radon set for any order with radon on it, and only then tells ISN it can
drop the footprint. Every run is recorded in `isn_sync_log`.

Once it is on, `GET /api/isn/my-jobs` is what the phone downloads: the day's radon
jobs with address, client, agent and order number already filled in, plus the
device ledger so the duplicate rule is decided before the tech leaves the
driveway. `field/prototype.html` shows it — flip "ISN link" to see the same form
with and without it.

## Not built yet

File upload storage (the `attachments` table is there, the S3/R2 wiring is not),
CSV import, email and SMS reminders on the compliance calendar, and the phone
client itself — the desktop configures it and the API accepts its submissions, so
it can be a thin React Native or PWA shell over `/api/ops/field/*`.
