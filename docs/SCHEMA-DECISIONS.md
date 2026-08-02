# What changed between the export and this schema

The export held 16 tables and 383 field definitions. This schema holds 20 tables
and about 240 real columns. Nothing was dropped that carried information. Here is
every decision, so you can reverse any of them.

## 1. The base was built twice

Ten of the sixteen tables carry a duplicate link set — `CEU Records` and
`CEU Records 2`, `Vendors` and `Vendors 2`, `Renewals & Compliance Calendar` and
`Renewals & Compliance Calendar 2`. Alongside those sit two generations of the
same column under different names:

| First generation | Second generation | Kept as |
|---|---|---|
| Vehicle Name | Van Name / Unit Number | `vehicles.unit_number` |
| License Plate | Plate Number | `vehicles.plate_number` |
| Assigned Employee | Employee / Employees | `*.assigned_employee_id` |
| Linked Insurance Policy | Insurance Policy | `*.insurance_policy_id` |
| Training Records | CEU Records | `ceu_records` |
| Registration Expiration | Registration Renewal Date | `vehicles.registration_expiration` |

Reverse links (`Employees` sitting on the Vehicles table because Vehicles sits on
Employees) are not columns in a relational database. They are the same foreign key
read from the other side, and the app renders them as related lists.

## 2. Radon machines folded into equipment

`Radon Machines` and `Equipment` both tracked serial numbers, assignment,
calibration dates and calibration status. Two tables meant two places to check
whether a device was in tolerance.

Radon devices are now rows in `equipment` with `asset_category = 'Radon'` and
`requires_calibration = true`. The old shape is preserved as a view:

```sql
SELECT * FROM radon_machines;   -- same columns as the Airtable table
```

Radon calibration is treated as `Critical` priority on the compliance calendar,
where general equipment is `Normal`, so it still gets its own weight.

**To reverse:** drop the view, create a `radon_machines` table, and remove the
`Radon` value from the `asset_category` lookup list. Nothing else references it.

## 3. Maintenance consolidated

`Maintenance & Calibration Records` and the equipment-side maintenance links were
the same record type. They are now one table, `maintenance_records`, keyed to
equipment with a `service_type` of Calibration, Maintenance, Repair or Inspection.
Vehicle service stayed separate in `vehicle_maintenance` because it carries
mileage, which equipment does not.

Saving a calibration record now pushes the new due date onto the asset
automatically. That was previously two manual updates.

## 4. Inventory Transactions was missing

Four tables — Employees, Supplies, Vendors, Vehicles — link to an
`Inventory Transactions` table that does not exist in the export. It is now
`inventory_transactions`, a signed ledger. Receipts are positive, issues and waste
are negative, and a `Count` sets on-hand outright. A trigger keeps
`supplies.quantity_on_hand` correct, so nobody types a count in two places.

If this table was never actually built in Airtable, this is new capability rather
than a migration. Worth confirming before you map data across.

## 5. Attachments became one table

Roughly twenty attachment fields — Certificate Attachment, Policy Document,
Invoice Attachment, Photos / Documents, Vehicle Photos / Docs and the rest — are
now rows in `attachments`, tagged with the entity and record they belong to. One
upload path, one place to look, and adding a document type later needs no schema
change.

## 6. Selects became editable lists

Every single-select is a row in `lookup_values`. The office can add a service type
or a vendor category from Setup without a deploy. Seeded lists are in
`db/migrations/005_defaults.sql`.

## 7. The compliance calendar is generated, not typed

`Renewals & Compliance Calendar` was a table people re-entered dates into. Every
date in that table already existed on a license, a van, an asset, a policy, a
subscription or a supply lot.

`refresh_compliance()` sweeps all ten of those sources and upserts the calendar.
It runs on every dashboard load, after every field submission, and can be run
nightly. Manual entries are still allowed — they simply have a null
`source_entity`. Change an expiration date on a license and the calendar follows;
there is no second place to update and no way for the two to disagree.

## 8. Credentials are not stored

`Admin Login Stored In` became `credential_vault_ref` and holds the *name* of the
entry in your password manager. This database never holds a password, and the
field help text says so.

## Tables, final list

**People:** employees, licenses, ceu_records, ceu_requirements
**Assets:** vehicles, vehicle_drivers, vehicle_maintenance, equipment, maintenance_records, supplies, inventory_transactions
**Business:** vendors, insurance_policies, claims_incidents, software_subscriptions, sops
**Cross-cutting:** compliance_items, attachments, users, audit_log, lookup_lists, lookup_values
**Field app:** field_modules, field_module_access, field_forms, field_form_fields, field_submissions
**UI catalog:** meta_entities, meta_fields, saved_views

## Open questions for you

1. **Inventory Transactions** — did this exist in Airtable, or was it only ever a
   planned link? Changes whether we migrate or start clean.
2. **Employees vs users** — should every inspector get a login, or only the ones
   who will use the phone? Right now they are separate tables joined by
   `users.employee_id`, so you can have either.
3. **Territory** — Richmond and Hampton–Newport News are one franchise record
   here. If HouseMaster reporting needs them split, `territory` should become a
   real `territories` table before you load data, not after.
4. ~~**Radon lab results**~~ — **answered and built.** See
   `006_radon.sql`: `radon_tests`, `radon_deployments`, `radon_custody_events`,
   and the duplicate rule. Chain of custody lives here, not in ISN.

---

## Radon (migration 006)

### The shape

A **set** is one test at one property (`radon_tests`). A set carries one or more
**devices** (`radon_deployments`) — a Primary, and on a QA set a Duplicate placed
beside it. Every hand-off is a row in `radon_custody_events`.

Splitting devices out of the set is what makes the duplicate rule expressible at
all. A duplicate is not a flag on the test; it is a second detector with its own
serial, its own seal number, its own reading. Modeling it as a column would have
made the pair unprovable.

### The duplicate rule

`radon_qa_rules` holds one active row: interval (10), what it counts (per
monitor, per inspector, or company-wide), the disagreement tolerance (36%), the
action level (4.0 pCi/L), and the minimum deployment hours (48). Nothing about
the rule is hard-coded anywhere else.

Enforcement is deliberately in three layers:

1. **The phone** calls `/api/radon/qa-check` before the form opens. On a QA set
   it shows a red banner and reveals four extra required questions — second
   monitor, spacing, a photo of both, second seal number.
2. **The API** re-checks on submit and returns 422 with the reason if the
   duplicate is missing. It does not trust the phone.
3. **The database** re-derives the sequence number at the moment the set flips to
   `Deployed` and raises if the duplicate row is absent. This is the layer that
   holds when someone imports a CSV, runs a manual `UPDATE`, or writes a new
   client against the API.

The sequence is derived by counting, never stored as a counter that can drift:
`radon_qa_next()` counts non-voided Primary deployments in scope and returns the
next number. Recomputing at deploy time excludes the set being deployed, so the
number the tech was shown is the number that gets stamped.

### Comparing the pair

When both readings land, a trigger computes relative percent difference —
`|a−b| / mean × 100` — and marks the pair in or out of tolerance. Out-of-tolerance
pairs surface on the Radon screen under "Pairs that disagree," which is the
signal to pull that monitor for calibration.

### What is deliberately not here

- **Lab integration.** `lab_report_number` and `lab_vendor_id` are fields, not a
  feed. Wiring AccuStar (or whoever) to post results back is a later job.
- **Blanks and spikes.** The roles exist in `radon_deployments` and
  `blank_interval` sits in the rules table, but only duplicates are enforced. Say
  the word and blanks enforce the same way.
- **The client-facing report.** This tracks the measurement and its custody. The
  report the buyer receives is still produced elsewhere.

---

## System of record: ISN, not ServiceTitan

HouseMaster of Richmond runs on **Inspection Support Network**
(inspectionsupport.com). Earlier drafts of this schema assumed ServiceTitan;
that was wrong and has been corrected in the seed data and in every field label.

`radon_tests.isn_order_id` and `isn_order_url` are the link back to the job. They
are plain text for now — type the order number, or paste the link.

ISN publishes a JSON API at a per-account URL with HTTP basic auth using an API
key. When you want the link automated rather than typed, the shape is:

- pull the day's orders, match on address, and prefill the radon set
- push the result and the report-delivered timestamp back onto the order

That belongs in its own migration with a `isn_sync_state` table so a failed pull
can be retried without duplicating sets. Read the current endpoint list at
json.inspectionsupport.net before building against it.

---

## The field app and the offline problem (migration 007)

The desktop can ask the database what set number is next. A phone in a
crawlspace cannot. That gap is where the duplicate rule could quietly fail, so
it is handled explicitly rather than left to the network.

**The phone carries a ledger.** One row per monitor, pulled from
`radon_device_ledger` on every sync: which monitor, how many sets it has
finished, the interval. `field/qa-guard.js` decides from that cache, so the rule
works underground.

**Uncertainty resolves toward taking two.** A monitor this phone has never
synced, a ledger older than two weeks, or more queued sets than the interval all
force a duplicate. The two mistakes are not symmetrical: a spare pair costs one
monitor-day, while a missed one leaves a hole that cannot be filled once the
house has been tested.

**Extra duplicates are never wasted.** `radon_qa_next()` counts from the last
duplicate, so a cautious pair resets the cycle exactly like a scheduled one. A
trigger notes in the custody log why it happened.

**An offline set that turns out to owe a duplicate is not rejected.** This is the
one deliberate softening of the rule. Rejecting the upload does not produce a
duplicate — the house was tested hours ago — it produces a lost record. So a set
with `source = 'field_offline'` may pass, but only by carrying
`qa_exception = true` and a reason, which a CHECK constraint requires to be
non-null. It lands in `radon_qa_exceptions` and shows on the Radon screen under
"Needs a look" until someone clears it with a resolution.

Anything created online still hits the hard refusal. The tech is standing in the
house and can go get the second monitor.

---

## ISN integration (migration 008)

### How ISN works, and why it shapes the design

Every ISN account gets its own sandboxed REST endpoint at *service domain +
company key + /rest*. Auth is HTTP basic; ISN asks integrations to use an
access key / secret access key pair rather than a person's login, because keys
can be revoked without a password reset.

The change feed is **footprints** — stubs pointing at upcoming orders for the
authenticating user. You GET them, follow each to the order, and then you *must*
DELETE the footprint. Two consequences drive `server/integrations/isn.js`:

1. **The read is destructive.** Nothing is deleted until the order is committed
   locally. A crash mid-run leaves the footprint for the next pass. Repeating
   work is free; losing it is not.
2. **Footprints belong to the authenticating user.** Running this on a person's
   login would consume notifications that person — or another tool on the same
   account, like a report writer — still needed. The integration needs its own
   ISN user. This is the single most important setup detail.

### What is built

`isn_orders` caches the orders we care about; ISN wins on every field, always.
`isn_draft_radon_set()` turns an order with radon on it into a Scheduled set —
idempotent, and it refuses to overwrite a set a tech has already touched. A
partial unique index guarantees one live set per order, so a re-pull cannot
create the job twice.

`field_todays_radon_jobs` is what the phone downloads: the job with address,
client, agent, foundation and order number already filled in, alongside the
device ledger so the QA answer is known before the tech leaves the driveway.

`isn_radon_orders_without_sets` is the one that pays for itself — radon booked
on an order with no set ever placed.

### The arrow points one way

We read orders from ISN. We do not write an address, a client, or a fee back
into it. ISN owns the job; this system owns what happens to the equipment. The
one write worth adding later is posting the result and report link onto the
order, and that path should be confirmed against the live endpoint list at
api.inspectionsupport.net before anyone builds it — the pull side is documented,
the write side is not, in the material available publicly.

### Credentials

`ISN_ACCESS_KEY` and `ISN_SECRET_ACCESS_KEY` live in the environment. The
`isn_connection` table records only which environment variable holds them, the
company key, and how the last run went.
