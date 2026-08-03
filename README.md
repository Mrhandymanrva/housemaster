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

Open it and the sign-in screen asks you to create the owner account, because
the database has no logins yet. After that it is an ordinary sign-in screen and
everyone else is added in the app under **Logins**.

Sample records are optional and separate — employees, vehicles, policies and
radon sets, so the compliance horizon has something on it:

```bash
npm run seed:demo
```

Migrations in `db/migrations/` run in filename order on every boot and record
themselves in `schema_migrations`, so deploys are safe to repeat.

---

## Deploy to Railway

1. Push this repo to GitHub.
2. In Railway: **New Project → Deploy from GitHub repo**.
3. Add **Postgres** to the project: **+ Create → Database → Add PostgreSQL**.
4. Set two variables on the app service — Railway does *not* hand a database's
   URL to your other services, you have to point at it:

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` — a reference, typed literally, braces and all. Use your database service's own name if it is not `Postgres`. |
   | `JWT_SECRET` | `${{ secret(64) }}`, which Railway fills in with 64 random characters. |

   Without the first one the app falls back to a local Postgres that does not
   exist inside the container, and the deploy fails its healthcheck with nothing
   listening. The deploy log says which address it tried.
5. Deploy. Railway reads `railway.json`, builds the Dockerfile, and health-checks
   `/api/health`.
6. Open the URL and create the owner account on the sign-in screen. Do this as
   soon as the deploy goes green: until that account exists, anyone who reaches
   the URL could claim it. It closes permanently once one login exists.

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
- Logins are managed in the app under **Logins** (admin and up): add someone, move
  them between roles, switch them off, reset a password. Nobody can grant access
  above their own role, edit an account senior to their own, switch off their own
  login, or remove the last active owner. Every request re-reads the role from the
  database, so switching someone off takes hold on their next request rather than
  whenever their 12-hour token happens to expire.
- `JWT_SECRET` has a development fallback. Under `NODE_ENV=production` the server
  refuses to start without a real one instead of signing every session with a
  string that is printed in the source.
- Every column name that reaches SQL is checked against the catalog first, and all
  values are parameterized.
- Every create, update, delete and field submission is written to `audit_log`.

## The field app

`field/app/` is the phone app, served by the same process at **`/phone`**. Plain
browser JavaScript with no build step, because a tech's phone should get a
change the moment it deploys.

Getting it onto a phone: open `https://<your-host>/phone` and add it to the home
screen — Safari → Share → Add to Home Screen on iOS, Chrome → Install app on
Android. There is nothing in an app store. The address is also printed in the
desktop app under **Phone app**.

Signing in caches the modules, their questions, the dropdown choices and the
vehicle and equipment pick-lists, so losing signal mid-form costs nothing.
Submissions queue in the browser and go when service returns, each carrying a
uuid the phone generated, so a retry cannot post twice.

What a tech sees on the home screen, above the forms, is what is due against
*them* — their licences, the van they drive, the equipment signed out to them —
from `/api/ops/field/reminders`. The office keeps the whole horizon on the
desktop; the phone shows the few things that stop somebody working today.

A module whose submission names an existing record edits it: a van check puts
the odometer on the van. One that names none creates a record instead — a van
maintenance log becomes a new row in `vehicle_maintenance` rather than an edit
to the van.

Some records are more than a row. A radon deployment is a test, its monitors,
and a custody event for each, so `radon_tests` names a builder in the `INTAKE`
table in `server/routes/ops.js` and the set is assembled by the same
`radonIntake.js` the desktop uses. A set opened in a driveway and one opened at
a desk are the same set, made the same way — same sequence number, same custody
trail, same trigger deciding whether it may reach Deployed.

That module applies on arrival rather than waiting for review: chain of custody
starts in the house, not when somebody reaches the inbox. If the database
refuses it anyway — drift, a retired monitor — the submission stays pending
with the reason written on it and the phone is still told it arrived. Re-sending
would only fail the same way, and by then the tech has driven off.

Photos ride inside the submission, downscaled to 1024px JPEG on the phone. That
is interim: `attachments` exists as a table and the object storage behind it
does not, so photos live in the submission payload until it is wired.

`field/qa-guard.js` is the duplicate rule as the phone runs it — a pure module
with no imports, so the app, the tests and the phone all share one copy. The
server hands that same file out at `/phone/qa-guard.js` rather than keeping a
second one. `node field/qa-guard.test.js` runs its 18 checks.

The app decides the moment the tech picks the monitor. A set that owes a
duplicate gets a red banner and three more questions — second monitor, inches
apart, one photo of both — and will not send without them, or if the duplicate
is the same unit as the primary, or if the two are more than a hand's width
apart. An ordinary set says so in green and asks nothing extra.

Every uncertainty resolves toward taking two: a monitor this phone has never
synced, a ledger older than two weeks, more sets placed offline than the
interval. Each submission carries what the phone believed — the sequence it
thought it was on, when it last synced, whether it was offline — so a set that
turns out to have been wrong arrives with its reason attached instead of
leaving an unexplained gap.

A duplicate placed but not yet uploaded is the one thing the local ledger
cannot hold: `merge()` lets the server's count win. The consequence is that the
phone may ask for one more pair than it owed, which is the direction this whole
module leans anyway.

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

File upload storage (the `attachments` table is there, the S3/R2 wiring is not,
so phone photos sit in the submission payload meanwhile), CSV import, email and
SMS reminders on the compliance calendar, and Setup → Screens for renaming and
reordering columns — its endpoint is live and nothing calls it.

Photos are the open one: a radon set opened from a phone records where its
photos live (`field_submission:<id>#placement_photo`) rather than a file,
because there is no file store to put them in yet. Wiring object storage is one
line in `radonIntake.js` and a migration to rewrite the existing refs.
