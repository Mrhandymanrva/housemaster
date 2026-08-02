/**
 * Plain English for the whole app.
 *
 * The catalog gives every record type a technical-ish name. This file gives
 * each one a name a new hire would use out loud, plus one sentence saying what
 * it is for. If a record type is missing here the catalog name is used, so
 * adding a table never breaks the screen.
 */

export const PLAIN = {
  employees:              ['Team',                  'Everyone who works here, with contact details and start dates.'],
  licenses:               ['Licenses',              'Inspector licenses, radon certifications and business licenses.'],
  ceu_records:            ['Training taken',        'Classes your people have completed toward their license renewal.'],
  ceu_requirements:       ['Training rules',        'How many hours each license type needs, and how often.'],
  vehicles:               ['Vans',                  'Your fleet — registration, inspection dates and who drives what.'],
  vehicle_maintenance:    ['Van service history',   'Oil changes, tires, repairs and what they cost.'],
  equipment:              ['Equipment',             'Radon monitors, cameras, ladders — anything you own and track.'],
  maintenance_records:    ['Calibration history',   'Every time a piece of equipment was calibrated or serviced.'],
  supplies:               ['Supplies',              'Canisters, forms, gloves — what you keep on hand and when to reorder.'],
  inventory_transactions: ['Supplies in and out',   'A running log of what got used, received or counted.'],
  vendors:                ['Vendors',               'Who you buy from and who services your equipment.'],
  insurance_policies:     ['Insurance',             'Policies, carriers, renewal dates and premiums.'],
  claims_incidents:       ['Incidents',             'Accidents, complaints and claims, and where each one stands.'],
  software_subscriptions: ['Software',              'Every subscription you pay for, what it costs and when it renews.'],
  sops:                   ['Procedures',            'Your written checklists and standard operating procedures.'],
  radon_tests:            ['Radon sets',            'Every radon test, where it was placed and what it came back at.'],
  radon_deployments:      ['Monitors placed',       'Each device on each set, including the QA duplicates.'],
  radon_custody_events:   ['Chain of custody',      'Who touched each set, when, and where — the paper trail.'],
};

/** Three plain buckets on the Records screen, in the order they appear. */
export const GROUPS = [
  ['Your people', ['employees', 'licenses', 'ceu_records', 'ceu_requirements']],
  ['Vans and equipment', ['vehicles', 'vehicle_maintenance', 'equipment', 'maintenance_records', 'supplies', 'inventory_transactions']],
  ['Radon', ['radon_tests', 'radon_deployments', 'radon_custody_events']],
  ['The business', ['vendors', 'insurance_policies', 'claims_incidents', 'software_subscriptions', 'sops']],
];

export const plainName = (e) => PLAIN[e.key]?.[0] || e.label_plural;
export const plainDesc = (e) => PLAIN[e.key]?.[1] || '';

/** "Add a ___" wording for the button on a list screen. */
export const singular = (e) => ({
  employees: 'person', licenses: 'license', ceu_records: 'training record',
  ceu_requirements: 'training rule', vehicles: 'van', vehicle_maintenance: 'service record',
  equipment: 'piece of equipment', maintenance_records: 'calibration record',
  supplies: 'supply item', inventory_transactions: 'movement', vendors: 'vendor',
  insurance_policies: 'policy', claims_incidents: 'incident',
  software_subscriptions: 'subscription', sops: 'procedure',
  radon_tests: 'radon set', radon_deployments: 'monitor placement',
  radon_custody_events: 'custody entry',
}[e.key] || e.label.toLowerCase());
