/**
 * Demo mode. Built with VITE_DEMO=1 it serves canned data in place of the
 * API so the app can be opened as a single file with no server or database.
 * Production builds never include this path.
 */
import { catalog } from './catalog-demo.js';

export const DEMO = import.meta.env.VITE_DEMO === '1';

const day = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

const people = [
  { id: 'e1', full_name: 'Mason Holloway', role: 'Owner', status: 'Active', email: 'mason@hmrichmond.com', phone: '8045550101', territory: 'Richmond', dl_expiration: day(420), job_title: 'Owner', home_location: 'Glen Allen' },
  { id: 'e2', full_name: 'Dale Whitfield', role: 'Inspector', status: 'Active', email: 'dale@hmrichmond.com', phone: '8045550102', territory: 'Richmond', dl_expiration: day(41), job_title: 'Lead Inspector', home_location: 'Midlothian' },
  { id: 'e3', full_name: 'Rosa Nunez', role: 'Inspector', status: 'Active', email: 'rosa@hmrichmond.com', phone: '8045550103', territory: 'Tri-Cities', dl_expiration: day(260), job_title: 'Inspector', home_location: 'Chester' },
  { id: 'e4', full_name: 'Trevor Banks', role: 'Radon Technician', status: 'Active', email: 'trevor@hmrichmond.com', phone: '8045550104', territory: 'Richmond', dl_expiration: day(-12), job_title: 'Radon Technician', home_location: 'Henrico' },
  { id: 'e5', full_name: 'Angela Pryor', role: 'CSR', status: 'Active', email: 'angela@hmrichmond.com', phone: '8045550105', territory: 'Office', dl_expiration: day(610), job_title: 'Client Services', home_location: 'Glen Allen' },
];

const vehicles = [
  { id: 'v1', unit_number: 'Van 1', make: 'Ford', model: 'Transit Connect', model_year: 2021, vin: '1FTBR1C87MKA12345', plate_number: 'VDT-4471', status: 'Active', primary_driver_id: 'e2', primary_driver_id__label: 'Dale Whitfield', current_mileage: 88410, registration_expiration: day(22), state_inspection_due: day(130), next_service_date: day(26) },
  { id: 'v2', unit_number: 'Van 2', make: 'Ford', model: 'Transit Connect', model_year: 2022, vin: '1FTBR1C87NKA55512', plate_number: 'VDT-5590', status: 'Active', primary_driver_id: 'e3', primary_driver_id__label: 'Rosa Nunez', current_mileage: 61240, registration_expiration: day(190), state_inspection_due: day(-6), next_service_date: day(70) },
  { id: 'v3', unit_number: 'Van 3', make: 'Chevrolet', model: 'Colorado', model_year: 2020, vin: '1GCGTCEN4L1234567', plate_number: 'VDT-2210', status: 'In Shop', primary_driver_id: 'e4', primary_driver_id__label: 'Trevor Banks', current_mileage: 121880, registration_expiration: day(78), state_inspection_due: day(44), next_service_date: day(4) },
];

const equipment = [
  ...Array.from({ length: 22 }, (_, i) => {
    const n = i + 1;
    const techs = ['Trevor Banks', 'Dale Whitfield', 'Rosa Nunez', 'Mason Holloway'];
    const vans = ['Van 1', 'Van 2', 'Van 3', null];
    return {
      id: `q${n}`,
      name: `Radon CRM #${n}`,
      asset_category: 'Radon',
      serial_number: `SN-10${27 + Math.floor(i / 3)}-${'ABCDEFGHIJKLMNOPQRSTUV'[i]}`,
      asset_tag: `HM-0${100 + n}`,
      status: n === 3 ? 'Needs Repair' : n === 17 ? 'In Calibration' : 'In Service',
      condition: n % 7 === 0 ? 'Fair' : 'Good',
      assigned_employee_id__label: techs[i % techs.length],
      assigned_vehicle_id__label: vans[i % vans.length],
      next_calibration_due: day([7, 65, -35, 120, 210, 300, 44, 88, 155, 240, 19, 330,
                                 400, 96, 130, 275, -8, 190, 260, 71, 145, 355][i]),
      purchase_price: 3450,
    };
  }),
  { id: 'q4', name: 'Thermal Camera — E8', asset_category: 'Moisture / Thermal', serial_number: 'FE8-99120', asset_tag: 'HM-0210', status: 'In Service', condition: 'Excellent', assigned_employee_id__label: 'Rosa Nunez', assigned_vehicle_id__label: 'Van 2', next_calibration_due: day(530), purchase_price: 2795 },
  { id: 'q5', name: 'Inspection Drone', asset_category: 'Drone', serial_number: 'DJ3E-44120', asset_tag: 'HM-0301', status: 'In Service', condition: 'Good', assigned_employee_id__label: 'Rosa Nunez', assigned_vehicle_id__label: 'Van 2', next_calibration_due: null, purchase_price: 4100 },
  { id: 'q6', name: 'Combustion Analyzer', asset_category: 'Gas / Combustion', serial_number: 'TS320-7781', asset_tag: 'HM-0401', status: 'In Service', condition: 'Good', assigned_employee_id__label: 'Dale Whitfield', assigned_vehicle_id__label: 'Van 1', next_calibration_due: day(25), purchase_price: 1290 },
  { id: 'q7', name: 'Moisture Meter — Pinless', asset_category: 'Moisture / Thermal', serial_number: 'DM-88210', asset_tag: 'HM-0501', status: 'In Service', condition: 'Good', assigned_employee_id__label: 'Dale Whitfield', assigned_vehicle_id__label: null, next_calibration_due: null, purchase_price: 420 },
  { id: 'q8', name: 'Telescoping Ladder 17ft', asset_category: 'Ladders & Access', serial_number: 'WR-MT17-2201', asset_tag: 'HM-0601', status: 'In Service', condition: 'Fair', assigned_employee_id__label: 'Rosa Nunez', assigned_vehicle_id__label: 'Van 2', next_calibration_due: null, purchase_price: 330 },
];

const licenses = [
  { id: 'l1', name: 'VA Home Inspector — Holloway', license_type: 'Home Inspector', employee_id__label: 'Mason Holloway', license_number: '3380001234', expiration_date: day(330), status: 'Active' },
  { id: 'l2', name: 'VA Home Inspector — Whitfield', license_type: 'Home Inspector', employee_id__label: 'Dale Whitfield', license_number: '3380004411', expiration_date: day(18), status: 'Pending Renewal' },
  { id: 'l3', name: 'VA NRS Endorsement — Whitfield', license_type: 'NRS Home Inspector', employee_id__label: 'Dale Whitfield', license_number: '3380004411-N', expiration_date: day(18), status: 'Pending Renewal' },
  { id: 'l4', name: 'VA Home Inspector — Nunez', license_type: 'Home Inspector', employee_id__label: 'Rosa Nunez', license_number: '3380007788', expiration_date: day(330), status: 'Active' },
  { id: 'l5', name: 'NRPP Radon Measurement — Banks', license_type: 'Radon Measurement', employee_id__label: 'Trevor Banks', license_number: 'RMT-220145', expiration_date: day(-4), status: 'Expired' },
  { id: 'l6', name: 'NRPP Radon Measurement — Whitfield', license_type: 'Radon Measurement', employee_id__label: 'Dale Whitfield', license_number: 'RMT-118820', expiration_date: day(225), status: 'Active' },
  { id: 'l7', name: 'FAA Part 107 — Nunez', license_type: 'Drone / Part 107', employee_id__label: 'Rosa Nunez', license_number: '4451102', expiration_date: day(64), status: 'Active' },
  { id: 'l8', name: 'Henrico Business License', license_type: 'Business License', employee_id__label: null, license_number: 'BL-2026-8841', expiration_date: day(148), status: 'Active' },
];

const supplies = [
  { id: 's1', item_name: 'Radon charcoal canisters', category: 'Radon Consumables', quantity_on_hand: 34, reorder_point: 40, unit_cost: 4.25, vendor_id__label: 'AccuStar Radon Labs', storage_location: 'Office shelf A', expiration_date: day(95) },
  { id: 's2', item_name: 'Radon tamper seals', category: 'Radon Consumables', quantity_on_hand: 6, reorder_point: 3, unit_cost: 12, vendor_id__label: 'AccuStar Radon Labs', storage_location: 'Office shelf A', expiration_date: null },
  { id: 's3', item_name: 'Chain-of-custody forms', category: 'Radon Consumables', quantity_on_hand: 2, reorder_point: 4, unit_cost: 8.5, vendor_id__label: 'AccuStar Radon Labs', storage_location: 'Office shelf A', expiration_date: null },
  { id: 's4', item_name: 'Shoe covers', category: 'Field Consumables', quantity_on_hand: 3, reorder_point: 2, unit_cost: 42, vendor_id__label: 'Inspector Tools Direct', storage_location: 'Van storage', expiration_date: null },
  { id: 's5', item_name: 'Yard signs', category: 'Marketing', quantity_on_hand: 18, reorder_point: 10, unit_cost: 11.75, vendor_id__label: 'Inspector Tools Direct', storage_location: 'Office closet', expiration_date: null },
  { id: 's6', item_name: 'Nitrile gloves', category: 'Safety / PPE', quantity_on_hand: 4, reorder_point: 6, unit_cost: 14, vendor_id__label: 'Inspector Tools Direct', storage_location: 'Van storage', expiration_date: null },
];

const vendors = [
  { id: 'd1', name: 'Bowman Fleet Service', category: 'Auto / Fleet', contact_name: 'Ken Bowman', phone: '8045550301', email: 'service@bowmanfleet.com', payment_terms: 'Net 15', preferred: true },
  { id: 'd2', name: 'Bowser Calibration Lab', category: 'Calibration Lab', contact_name: 'Priya Rao', phone: '8005550302', email: 'lab@bowsercal.com', payment_terms: 'Prepaid', preferred: true },
  { id: 'd3', name: 'AccuStar Radon Labs', category: 'Radon Lab', contact_name: 'Support', phone: '8005550303', email: 'support@accustar.com', payment_terms: 'Net 30', preferred: true },
  { id: 'd4', name: 'Colonial Risk Partners', category: 'Insurance', contact_name: 'Beth Salter', phone: '8045550304', email: 'beth@colonialrisk.com', payment_terms: 'Annual', preferred: true },
  { id: 'd5', name: 'Inspector Tools Direct', category: 'Equipment Supplier', contact_name: 'Sales', phone: '8885550305', email: 'sales@inspectortools.com', payment_terms: 'Net 30', preferred: false },
];

const policies = [
  { id: 'p1', name: 'General Liability', policy_type: 'General Liability', carrier: 'Hartford', policy_number: 'GL-4471902', effective_date: day(-320), expiration_date: day(45), premium_amount: 4820 },
  { id: 'p2', name: 'Errors & Omissions', policy_type: 'Errors & Omissions', carrier: "Lloyd's", policy_number: 'EO-99120', effective_date: day(-200), expiration_date: day(165), premium_amount: 6250 },
  { id: 'p3', name: 'Commercial Auto', policy_type: 'Commercial Auto', carrier: 'Progressive', policy_number: 'CA-338814', effective_date: day(-280), expiration_date: day(85), premium_amount: 7910 },
  { id: 'p4', name: 'Inland Marine — Equipment', policy_type: 'Inland Marine / Equipment', carrier: 'Hartford', policy_number: 'IM-55210', effective_date: day(-100), expiration_date: day(265), premium_amount: 1180 },
];

const software = [
  { id: 'w1', service_name: 'HouseMaster ReportHost', category: 'Inspection software', cost: 189, billing_frequency: 'Monthly', seats: 4, renewal_date: day(12), account_owner_id__label: 'Mason Holloway' },
  { id: 'w2', service_name: 'Inspection Support Network (ISN)', category: 'Operations', cost: 890, billing_frequency: 'Monthly', seats: 6, renewal_date: day(58), account_owner_id__label: 'Mason Holloway' },
  { id: 'w3', service_name: 'CompanyCam', category: 'Field photos', cost: 79, billing_frequency: 'Monthly', seats: 5, renewal_date: day(33), account_owner_id__label: 'Mason Holloway' },
  { id: 'w4', service_name: 'QUO', category: 'Communications', cost: 145, billing_frequency: 'Monthly', seats: 6, renewal_date: day(9), account_owner_id__label: 'Angela Pryor' },
];

const claims = [
  { id: 'c1', incident_number: 'INC-2026-014', incident_type: 'Vehicle Accident', incident_date: day(-18), status: 'Under Review', employee_id__label: 'Trevor Banks', vehicle_id__label: 'Van 3', cost_reserve: 1200 },
  { id: 'c2', incident_number: 'INC-2026-015', incident_type: 'Client Complaint', incident_date: day(-9), status: 'Open', employee_id__label: 'Dale Whitfield', vehicle_id__label: null, cost_reserve: 0 },
];

const rowsFor = {
  employees: people, vehicles, equipment, licenses, supplies, vendors,
  insurance_policies: policies, software_subscriptions: software, claims_incidents: claims,
  ceu_records: [
    { id: 'u1', course_name: 'Standards of Practice Refresher', employee_id__label: 'Dale Whitfield', ceu_hours: 4, completion_date: day(-120), category: 'Standards of Practice', provider: 'InterNACHI' },
    { id: 'u2', course_name: 'Ethics for Inspectors', employee_id__label: 'Dale Whitfield', ceu_hours: 2, completion_date: day(-95), category: 'Ethics', provider: 'InterNACHI' },
    { id: 'u3', course_name: 'Advanced Moisture Diagnostics', employee_id__label: 'Rosa Nunez', ceu_hours: 6, completion_date: day(-60), category: 'Technical', provider: 'ASHI' },
    { id: 'u4', course_name: 'Radon Measurement Update', employee_id__label: 'Trevor Banks', ceu_hours: 8, completion_date: day(-380), category: 'Radon', provider: 'AARST' },
  ],
  vehicle_maintenance: [
    { id: 'm1', vehicle_id__label: 'Van 1', service_type: 'Oil Change', service_date: day(-74), mileage_at_service: 83200, cost: 92.4, vendor_id__label: 'Bowman Fleet Service', next_service_due_date: day(26) },
    { id: 'm2', vehicle_id__label: 'Van 2', service_type: 'Tires', service_date: day(-40), mileage_at_service: 57900, cost: 812, vendor_id__label: 'Bowman Fleet Service', next_service_due_date: day(300) },
    { id: 'm3', vehicle_id__label: 'Van 3', service_type: 'Brakes', service_date: day(-5), mileage_at_service: 121600, cost: 640, vendor_id__label: 'Bowman Fleet Service', next_service_due_date: day(360) },
  ],
  maintenance_records: [
    { id: 'k1', equipment_id__label: 'Radon CRM #2', service_type: 'Calibration', service_date: day(-300), passed: true, performed_by: 'Bowser Lab', next_due_date: day(65) },
    { id: 'k2', equipment_id__label: 'Radon CRM #3', service_type: 'Calibration', service_date: day(-400), passed: false, performed_by: 'Bowser Lab', next_due_date: day(-35) },
  ],
  sops: [
    { id: 'o1', title: 'Radon deployment and retrieval', category: 'Radon', version: '2.1', effective_date: day(-210), owner_id__label: 'Mason Holloway' },
    { id: 'o2', title: 'Daily van check', category: 'Fleet', version: '1.3', effective_date: day(-90), owner_id__label: 'Mason Holloway' },
    { id: 'o3', title: 'Report QA before delivery', category: 'Inspection', version: '3.0', effective_date: day(-45), owner_id__label: 'Dale Whitfield' },
  ],
  ceu_requirements: [
    { id: 'r1', name: 'VA Home Inspector biennial', license_type: 'Home Inspector', state_jurisdiction: 'VA', credits_required: 16, period_years: 2 },
    { id: 'r2', name: 'NRPP Radon biennial', license_type: 'Radon Measurement', state_jurisdiction: 'National', credits_required: 16, period_years: 2 },
  ],
  radon_tests: [
    { id: 'rt1', test_number: 'RT-2026-00112', property_address: '4412 Oakmont Dr, Midlothian', isn_order_id: '88214', status: 'Deployed', inspector_id__label: 'Trevor Banks', deployed_at: day(-2), qa_duplicate_required: false, result_pci_l: null },
    { id: 'rt2', test_number: 'RT-2026-00113', property_address: '1207 Bellgrade Pl, Richmond', isn_order_id: '88231', status: 'Deployed', inspector_id__label: 'Dale Whitfield', deployed_at: day(-1), qa_duplicate_required: true, result_pci_l: null },
    { id: 'rt6', test_number: 'RT-2026-00106', property_address: '55 Ridgefield Pkwy, Henrico', isn_order_id: '88090', status: 'Reported', inspector_id__label: 'Dale Whitfield', deployed_at: day(-15), qa_duplicate_required: true, result_pci_l: 3.9 },
    { id: 'rt5', test_number: 'RT-2026-00108', property_address: '712 Winterfield Rd, Midlothian', isn_order_id: '88121', status: 'Reported', inspector_id__label: 'Trevor Banks', deployed_at: day(-7), qa_duplicate_required: false, result_pci_l: 6.4 },
    { id: 'rt4', test_number: 'RT-2026-00109', property_address: '3300 Kensington Ave, Richmond', isn_order_id: '88140', status: 'Reported', inspector_id__label: 'Dale Whitfield', deployed_at: day(-5), qa_duplicate_required: false, result_pci_l: 2.1 },
  ],
  radon_deployments: [
    { id: 'rd1', radon_test_id__label: '55 Ridgefield Pkwy, Henrico', role: 'Primary', equipment_id__label: 'Radon CRM #2', placement_floor: 'Basement', start_at: day(-15), result_pci_l: 3.9 },
    { id: 'rd2', radon_test_id__label: '55 Ridgefield Pkwy, Henrico', role: 'Duplicate', equipment_id__label: 'Radon CRM #2', placement_floor: 'Basement', start_at: day(-15), result_pci_l: 6.1 },
    { id: 'rd3', radon_test_id__label: '4412 Oakmont Dr, Midlothian', role: 'Primary', equipment_id__label: 'Radon CRM #3', placement_floor: 'Basement', start_at: day(-2), result_pci_l: null },
  ],
  radon_custody_events: [
    { id: 'ce1', radon_test_id__label: '55 Ridgefield Pkwy, Henrico', event_type: 'Placed', occurred_at: day(-15), employee_id__label: 'Dale Whitfield', party_name: null },
    { id: 'ce4', radon_test_id__label: '55 Ridgefield Pkwy, Henrico', event_type: 'Retrieved', occurred_at: day(-12), employee_id__label: 'Dale Whitfield', party_name: null },
    { id: 'ce6', radon_test_id__label: '55 Ridgefield Pkwy, Henrico', event_type: 'Reported to client', occurred_at: day(-11), employee_id__label: 'Angela Pryor', party_name: 'K. Alvarez' },
  ],
  inventory_transactions: [
    { id: 't1', supply_id__label: 'Radon charcoal canisters', txn_type: 'Issue', quantity: -6, occurred_at: day(-2), employee_id__label: 'Trevor Banks', vehicle_id__label: 'Van 3', reference: 'Chesterfield job' },
    { id: 't2', supply_id__label: 'Shoe covers', txn_type: 'Receive', quantity: 4, occurred_at: day(-6), employee_id__label: 'Angela Pryor', vehicle_id__label: null, reference: 'PO-3391' },
  ],
};

// horizon built from the same records the real refresh_compliance() would pick up
const horizon = [
  ...licenses.filter((l) => l.expiration_date).map((l) => ({
    id: 'h-' + l.id, category: 'License', title: `${l.name} expires`,
    subject: l.employee_id__label || 'Business', due_date: l.expiration_date,
    priority: 'Critical', responsible_name: l.employee_id__label,
  })),
  ...people.filter((p) => p.dl_expiration).map((p) => ({
    id: 'h-dl-' + p.id, category: 'License', title: "Driver's license expires",
    subject: p.full_name, due_date: p.dl_expiration, priority: 'High', responsible_name: p.full_name,
  })),
  ...vehicles.flatMap((v) => [
    { id: 'h-reg-' + v.id, category: 'Vehicle', title: 'Registration expires', subject: v.unit_number, due_date: v.registration_expiration, priority: 'High', responsible_name: v.primary_driver_id__label },
    { id: 'h-si-' + v.id, category: 'Vehicle', title: 'State inspection due', subject: v.unit_number, due_date: v.state_inspection_due, priority: 'High', responsible_name: v.primary_driver_id__label },
    { id: 'h-sv-' + v.id, category: 'Vehicle', title: 'Scheduled service due', subject: v.unit_number, due_date: v.next_service_date, priority: 'Normal', responsible_name: v.primary_driver_id__label },
  ]),
  ...equipment.filter((q) => q.next_calibration_due).map((q) => ({
    id: 'h-cal-' + q.id, category: 'Equipment', title: 'Calibration due',
    subject: `${q.name} · ${q.serial_number}`, due_date: q.next_calibration_due,
    priority: q.asset_category === 'Radon' ? 'Critical' : 'Normal', responsible_name: q.assigned_employee_id__label,
  })),
  ...policies.map((p) => ({
    id: 'h-pol-' + p.id, category: 'Insurance', title: `${p.name} renews`,
    subject: p.carrier, due_date: p.expiration_date, priority: 'Critical', responsible_name: 'Mason Holloway',
  })),
  ...software.map((s) => ({
    id: 'h-sw-' + s.id, category: 'Software', title: `${s.service_name} renews`,
    subject: s.billing_frequency, due_date: s.renewal_date, priority: 'Low', responsible_name: s.account_owner_id__label,
  })),
  ...supplies.filter((s) => s.expiration_date).map((s) => ({
    id: 'h-sup-' + s.id, category: 'Supplies', title: `${s.item_name} lot expires`,
    subject: 'LOT-2261', due_date: s.expiration_date, priority: 'Normal', responsible_name: 'Angela Pryor',
  })),
].map((h) => {
  const d = Math.round((new Date(h.due_date) - new Date().setHours(0, 0, 0, 0)) / 86400000);
  return {
    ...h, days_out: d, completed_date: null,
    state: d < 0 ? 'Overdue' : d <= 30 ? 'Due Soon' : d <= 90 ? 'On Deck' : 'Scheduled',
  };
}).sort((a, b) => a.days_out - b.days_out);

const modules = [
  { id: 'fm1', key: 'van_check', name: 'Van check', description: 'Start-of-day walkaround, mileage and fuel', icon: 'van', accent: 'steel', target_entity: 'vehicles', enabled: true, require_photo: true, require_gps: true, require_signature: false, auto_apply: true, allow_offline: true,
    form: { id: 'ff1', fields: [
      { key: 'vehicle', label: 'Which van', input_type: 'ref_vehicle', required: true, maps_to_column: null },
      { key: 'current_mileage', label: 'Odometer', input_type: 'integer', required: true, maps_to_column: 'current_mileage', help_text: 'Read it off the dash before you pull out.' },
      { key: 'fuel_level', label: 'Fuel level', input_type: 'select', required: true, maps_to_column: null },
      { key: 'tires_ok', label: 'Tires look right', input_type: 'toggle', required: true, maps_to_column: null },
      { key: 'lights_ok', label: 'Lights and signals work', input_type: 'toggle', required: true, maps_to_column: null },
      { key: 'fluids_ok', label: 'No leaks underneath', input_type: 'toggle', required: true, maps_to_column: null },
      { key: 'damage_photo', label: 'Any new damage', input_type: 'photo', required: false, maps_to_column: null },
      { key: 'notes', label: 'Anything else', input_type: 'textarea', required: false, maps_to_column: 'notes' },
    ] } },
  { id: 'fm2', key: 'radon_deploy', name: 'Radon deployment', description: 'Log placement, device and start time', icon: 'gauge', accent: 'red', target_entity: 'radon_tests', qa_rule: 'radon_duplicate', enabled: true, require_photo: true, require_gps: true, require_signature: false, auto_apply: false, allow_offline: true,
    form: { id: 'ff2', fields: [
      { key: 'device', label: 'Which monitor', input_type: 'ref_equipment', required: true },
      { key: 'address', label: 'Property address', input_type: 'text', required: true },
      { key: 'placement_floor', label: 'Floor placed on', input_type: 'select', required: true },
      { key: 'placement_photo', label: 'Photo of placement', input_type: 'photo', required: true, help_text: 'Show the device and the room it sits in.' },
      { key: 'closed_house_confirmed', label: 'Closed-house conditions explained to client', input_type: 'toggle', required: true },
      { key: 'start_time', label: 'Start time', input_type: 'time', required: true },
      { key: 'notes', label: 'Notes', input_type: 'textarea', required: false },
      { key: 'duplicate_device', label: 'Second monitor (duplicate)', input_type: 'ref_equipment', required: true,
        visible_if: { qa: 'duplicate_required' }, help_text: 'This is a QA set. Place a second monitor beside the first one.' },
      { key: 'duplicate_distance', label: 'Inches between the two', input_type: 'number', required: true,
        visible_if: { qa: 'duplicate_required' }, help_text: 'Keep them close — within about four inches, same height, same room.' },
      { key: 'duplicate_photo', label: 'Photo of both monitors together', input_type: 'photo', required: true,
        visible_if: { qa: 'duplicate_required' } },
      { key: 'duplicate_seal', label: 'Second tamper seal number', input_type: 'text', required: false,
        visible_if: { qa: 'duplicate_required' } },
    ] } },
  { id: 'fm3', key: 'radon_retrieve', name: 'Radon retrieval', description: 'Pick up devices and record readings', icon: 'gauge', accent: 'red', target_entity: 'radon_tests', qa_rule: 'radon_duplicate', enabled: true, require_photo: true, require_gps: true, require_signature: false, auto_apply: false, allow_offline: true,
    form: { id: 'ff3', fields: [
      { key: 'device', label: 'Which monitor', input_type: 'ref_equipment', required: true },
      { key: 'avg_pci', label: 'Average pCi/L', input_type: 'number', required: true },
      { key: 'end_time', label: 'End time', input_type: 'time', required: true },
      { key: 'photo', label: 'Photo of readout', input_type: 'photo', required: true },
      { key: 'duplicate_pci', label: 'Duplicate reading (pCi/L)', input_type: 'number', required: true,
        visible_if: { qa: 'duplicate_required' }, help_text: 'The second monitor from this set.' },
    ] } },
  { id: 'fm4', key: 'equipment_check', name: 'Equipment check-out', description: 'Take an asset out or bring it back', icon: 'toolbox', accent: 'amber', target_entity: 'equipment', enabled: true, require_photo: false, require_gps: false, require_signature: false, auto_apply: true, allow_offline: true,
    form: { id: 'ff4', fields: [
      { key: 'asset', label: 'Scan the asset tag', input_type: 'barcode', required: true },
      { key: 'direction', label: 'Out or back', input_type: 'select', required: true },
      { key: 'condition', label: 'Condition', input_type: 'select', required: true, maps_to_column: 'condition' },
    ] } },
  { id: 'fm5', key: 'supply_count', name: 'Supply count', description: 'Count what is on the van', icon: 'boxes', accent: 'green', target_entity: 'supplies', enabled: true, require_photo: false, require_gps: false, require_signature: false, auto_apply: true, allow_offline: true,
    form: { id: 'ff5', fields: [
      { key: 'supply', label: 'Item', input_type: 'ref_supply', required: true },
      { key: 'quantity', label: 'Count on hand', input_type: 'number', required: true, help_text: 'What is physically on the van right now.' },
      { key: 'vehicle', label: 'Counted on', input_type: 'ref_vehicle', required: false },
      { key: 'notes', label: 'Notes', input_type: 'textarea', required: false },
    ] } },
  { id: 'fm6', key: 'incident_report', name: 'Incident report', description: 'Something happened. Capture it now.', icon: 'alert', accent: 'red', target_entity: 'claims_incidents', enabled: false, require_photo: true, require_gps: true, require_signature: false, auto_apply: false, allow_offline: true,
    form: { id: 'ff6', fields: [
      { key: 'incident_type', label: 'What kind', input_type: 'select', required: true, maps_to_column: 'incident_type' },
      { key: 'description', label: 'What happened', input_type: 'textarea', required: true, maps_to_column: 'description' },
      { key: 'photos', label: 'Photos', input_type: 'photo', required: true },
      { key: 'anyone_hurt', label: 'Anyone hurt', input_type: 'toggle', required: true },
    ] } },
];

const submissions = [
  { id: 'sb1', module_key: 'van_check', module_name: 'Van check', submitted_by_name: 'Dale Whitfield', received_at: new Date(Date.now() - 36e5).toISOString(), status: 'pending', payload: { current_mileage: 88410, fuel_level: '3/4', tires_ok: true, lights_ok: true, fluids_ok: false, notes: 'Small drip under the front, looks like coolant.' } },
  { id: 'sb2', module_key: 'supply_count', module_name: 'Supply count', submitted_by_name: 'Trevor Banks', received_at: new Date(Date.now() - 9e6).toISOString(), status: 'pending', payload: { supply: 'Radon charcoal canisters', quantity: 34, vehicle: 'Van 3' } },
  { id: 'sb3', module_key: 'radon_deploy', module_name: 'Radon deployment', submitted_by_name: 'Trevor Banks', received_at: new Date(Date.now() - 1.7e7).toISOString(), status: 'pending', payload: { device: 'Radon CRM #1', address: '4412 Oakmont Dr, Midlothian', placement_floor: 'Basement', closed_house_confirmed: true, start_time: '08:40' } },
];

const readiness = [
  { employee_id: 'e4', full_name: 'Trevor Banks', role: 'Radon Technician', licenses_expired: 1, licenses_due_60: 0, ceu_hours_required: 16, ceu_hours_completed: 0, dl_expired: true },
  { employee_id: 'e2', full_name: 'Dale Whitfield', role: 'Inspector', licenses_expired: 0, licenses_due_60: 2, ceu_hours_required: 40, ceu_hours_completed: 6, dl_expired: false },
  { employee_id: 'e3', full_name: 'Rosa Nunez', role: 'Inspector', licenses_expired: 0, licenses_due_60: 0, ceu_hours_required: 16, ceu_hours_completed: 9, dl_expired: false },
  { employee_id: 'e1', full_name: 'Mason Holloway', role: 'Owner', licenses_expired: 0, licenses_due_60: 0, ceu_hours_required: 16, ceu_hours_completed: 0, dl_expired: false },
];


// ---------------------------------------------------------------- radon
const hoursAgo = (h) => new Date(Date.now() - h * 3.6e6).toISOString();

const QA_RULE = {
  scope: 'device', duplicate_interval: 10, blank_interval: 10,
  rpd_tolerance_pct: 36, action_level_pci: 4.0, min_hours_deployed: 48,
  closed_house_hours: 12, enforce_in_field: true,
};

// CRM #1 has run nine sets since its last duplicate — the next one is the tenth.
const qaStatus = Array.from({ length: 22 }, (_, i) => {
  // where each unit sits in its ten-set cycle
  const position = [10, 4, 7, 1, 10, 6, 3, 9, 2, 5, 8, 10, 6, 1, 4, 7, 3, 9, 2, 5, 8, 6][i];
  const techs = ['Trevor Banks', 'Dale Whitfield', 'Rosa Nunez', 'Mason Holloway'];
  return {
    equipment_id: `q${i + 1}`,
    name: `Radon CRM #${i + 1}`,
    serial_number: `SN-10${27 + Math.floor(i / 3)}-${'ABCDEFGHIJKLMNOPQRSTUV'[i]}`,
    assigned_to: techs[i % techs.length],
    next_set_number: position,
    next_set_needs_duplicate: position === 10,
    interval_n: 10,
    sets_since_last: position - 1,
    last_duplicate_at: hoursAgo(24 * (position * 4 + i)),
    rpd_failures: i === 1 ? 1 : i === 11 ? 1 : 0,
  };
});

const OPEN_SEED = [
  ['4412 Oakmont Dr, Midlothian', '88214', 'Trevor Banks', 3, 51, false],
  ['1207 Bellgrade Pl, Richmond', '88231', 'Dale Whitfield', 2, 19, true],
  ['9 Sycamore Ct, Chester', '88240', 'Rosa Nunez', null, null, false],
  ['806 Hioaks Rd, Richmond', '88243', 'Trevor Banks', 5, 62, false],
  ['3115 Cedarfield Pkwy, Henrico', '88247', 'Dale Whitfield', 8, 27, false],
  ['77 Braddock Ln, Midlothian', '88251', 'Rosa Nunez', 12, 49, false],
  ['1440 Gaskins Rd, Henrico', '88254', 'Trevor Banks', 6, 8, false],
  ['205 Cherokee Rd, Richmond', '88259', 'Dale Whitfield', 14, 55, true],
  ['6612 Ironbridge Rd, Chester', '88263', 'Rosa Nunez', 9, 33, false],
  ['18 Millrace Dr, Powhatan', '88266', 'Trevor Banks', 20, 71, false],
  ['902 Forest Hill Ave, Richmond', '88270', 'Dale Whitfield', 15, 14, false],
  ['3300 Old Gun Rd, Midlothian', '88272', 'Rosa Nunez', 4, 46, false],
  ['55 Winding Brook Dr, Ashland', '88275', 'Trevor Banks', 18, 22, false],
  ['1290 Robious Rd, Midlothian', '88279', 'Dale Whitfield', 7, 5, false],
];

const openTests = OPEN_SEED.map(([addr, isn, tech, dev, hrs, dup], i) => ({
  id: `rt${100 + i}`,
  test_number: `RT-2026-00${112 + i}`,
  property_address: addr,
  isn_order_id: isn,
  status: hrs == null ? 'Scheduled' : 'Deployed',
  inspector_name: tech,
  devices: dev == null ? null : dup ? `Radon CRM #${dev} + Radon CRM #${dev}` : `Radon CRM #${dev}`,
  has_duplicate: dup,
  device_count: dup ? 2 : dev == null ? 0 : 1,
  deployed_at: hrs == null ? null : hoursAgo(hrs),
  hours_out: hrs,
  min_hours: 48,
}));

const recentTests = [
  { id: 'rt4', test_number: 'RT-2026-00109', property_address: '3300 Kensington Ave, Richmond',
    status: 'Reported', result_pci_l: 2.1, duplicate_pci_l: null, rpd_pct: null,
    rpd_within_tolerance: null, result_status: 'Below Action Level', qa_duplicate_required: false,
    retrieved_at: hoursAgo(24 * 3), inspector_name: 'Dale Whitfield' },
  { id: 'rt5', test_number: 'RT-2026-00108', property_address: '712 Winterfield Rd, Midlothian',
    status: 'Reported', result_pci_l: 6.4, duplicate_pci_l: null, rpd_pct: null,
    rpd_within_tolerance: null, result_status: 'At or Above Action Level', qa_duplicate_required: false,
    retrieved_at: hoursAgo(24 * 5), inspector_name: 'Trevor Banks' },
  { id: 'rt6', test_number: 'RT-2026-00106', property_address: '55 Ridgefield Pkwy, Henrico',
    status: 'Reported', result_pci_l: 3.9, duplicate_pci_l: 6.1, rpd_pct: 44,
    rpd_within_tolerance: false, result_status: 'Below Action Level', qa_duplicate_required: true,
    retrieved_at: hoursAgo(24 * 12), inspector_name: 'Dale Whitfield' },
  { id: 'rt7', test_number: 'RT-2026-00104', property_address: '2201 Grove Ave, Richmond',
    status: 'At Lab', result_pci_l: 1.4, duplicate_pci_l: null, rpd_pct: null,
    rpd_within_tolerance: null, result_status: null, qa_duplicate_required: false,
    retrieved_at: hoursAgo(24 * 15), inspector_name: 'Rosa Nunez' },
  { id: 'rt8', test_number: 'RT-2026-00101', property_address: '18 Falling Creek Rd, Chester',
    status: 'Reported', result_pci_l: 4.2, duplicate_pci_l: 4.0, rpd_pct: 4.9,
    rpd_within_tolerance: true, result_status: 'At or Above Action Level', qa_duplicate_required: true,
    retrieved_at: hoursAgo(24 * 22), inspector_name: 'Trevor Banks' },
];

const qaExceptions = [
  { id: 'rx1', test_number: 'RT-2026-00097', property_address: '640 Cardinal Ridge Ct, Powhatan',
    inspector_name: 'Trevor Banks', monitor_name: 'Radon CRM #12', source: 'field_offline',
    deployed_at: hoursAgo(30), device_believed_sequence: 8, qa_sequence_number: 10,
    hours_since_sync: 74,
    qa_exception_reason: 'Captured offline. The phone believed this was set 8 and did not ask for a duplicate; it was actually set 10. No duplicate was placed.' },
];

const testDetail = {
  rt6: {
    test: { id: 'rt6', test_number: 'RT-2026-00106', property_address: '55 Ridgefield Pkwy, Henrico',
            inspector_name: 'Dale Whitfield', qa_duplicate_required: true,
            qa_reason: 'Set number 10 on this device — every 10th set is a duplicate pair.',
            rpd_pct: 44, rpd_within_tolerance: false, result_pci_l: 3.9, duplicate_pci_l: 6.1 },
    devices: [
      { id: 'rd1', role: 'Primary', equipment_name: 'Radon CRM #2', placement_room: 'Family room',
        placement_floor: 'Basement', result_pci_l: 3.9, tamper_seal_number: 'TS-88401' },
      { id: 'rd2', role: 'Duplicate', equipment_name: 'Radon CRM #2', placement_room: 'Family room',
        placement_floor: 'Basement', distance_inches: 4, result_pci_l: 6.1, tamper_seal_number: 'TS-88402' },
    ],
    custody: [
      { id: 'ce1', event_type: 'Placed', occurred_at: hoursAgo(24 * 15), employee_name: 'Dale Whitfield',
        gps_lat: 37.6, notes: 'Both units set on the basement bookshelf, 4 inches apart.' },
      { id: 'ce2', event_type: 'Sealed', occurred_at: hoursAgo(24 * 15), employee_name: 'Dale Whitfield' },
      { id: 'ce3', event_type: 'Client briefed', occurred_at: hoursAgo(24 * 15), employee_name: 'Dale Whitfield',
        notes: 'Closed-house conditions explained to the seller.' },
      { id: 'ce4', event_type: 'Retrieved', occurred_at: hoursAgo(24 * 12), employee_name: 'Dale Whitfield',
        gps_lat: 37.6, notes: 'Seals intact on both.' },
      { id: 'ce5', event_type: 'Result received', occurred_at: hoursAgo(24 * 12), employee_name: 'Angela Pryor',
        notes: 'Pair is 44% apart — outside the 36% tolerance. CRM #2 pulled for calibration check.' },
      { id: 'ce6', event_type: 'Reported to client', occurred_at: hoursAgo(24 * 11), employee_name: 'Angela Pryor',
        party_name: 'K. Alvarez' },
    ],
  },
};

const anyDetail = (id) => testDetail[id] || {
  test: { id, test_number: 'RT-2026-00000',
          property_address: [...openTests, ...recentTests].find((t) => t.id === id)?.property_address || 'Radon set',
          inspector_name: 'Trevor Banks', qa_duplicate_required: false },
  devices: [{ id: 'x1', role: 'Primary', equipment_name: 'Radon CRM #3',
              placement_room: 'Basement', placement_floor: 'Basement',
              result_pci_l: null, tamper_seal_number: 'TS-88510' }],
  custody: [
    { id: 'x2', event_type: 'Placed', occurred_at: hoursAgo(51), employee_name: 'Trevor Banks',
      gps_lat: 37.5, notes: 'Lowest livable level, away from exterior walls.' },
    { id: 'x3', event_type: 'Sealed', occurred_at: hoursAgo(51), employee_name: 'Trevor Banks' },
    { id: 'x4', event_type: 'Client briefed', occurred_at: hoursAgo(51), employee_name: 'Trevor Banks',
      notes: 'Closed-house conditions explained.' },
  ],
};

const DEMO_ME = {
  id: 'u1', name: 'Mason Holloway', role: 'owner', email: 'mason@hmrichmond.com',
};

const demoLogins = [
  { id: 'u1', email: 'mason@hmrichmond.com', full_name: 'Mason Holloway', job_title: 'Owner',
    app_role: 'owner', active: true, last_login_at: hoursAgo(2) },
  { id: 'u2', email: 'angela@hmrichmond.com', full_name: 'Angela Pryor', job_title: 'Client Services',
    app_role: 'office', active: true, last_login_at: hoursAgo(26) },
  { id: 'u3', email: 'dale@hmrichmond.com', full_name: 'Dale Whitfield', job_title: 'Lead Inspector',
    app_role: 'field', active: true, last_login_at: hoursAgo(9) },
  { id: 'u4', email: 'trevor@hmrichmond.com', full_name: 'Trevor Banks', job_title: 'Radon Technician',
    app_role: 'field', active: true, last_login_at: null },
];

const val = (n, label, sort, active = true) =>
  ({ id: `lv${n}`, value: label, label, sort, color: null, active });

const demoLists = [
  { key: 'asset_category', label: 'Asset categories', used_by: ['Equipment — Category'],
    values: [
      val(1, 'Radon monitors', 10), val(2, 'Sewer scopes', 20), val(3, 'Thermal cameras', 30),
      val(4, 'Moisture meters', 40), val(5, 'Drones', 50), val(6, '360 cameras', 60),
      val(7, 'Ladders & access', 70), val(8, 'Electrical testers', 80),
    ] },
  { key: 'asset_condition', label: 'Asset condition', used_by: ['Equipment — Condition'],
    values: [val(9, 'Excellent', 10), val(10, 'Good', 20), val(11, 'Fair', 30), val(12, 'Replace Soon', 40)] },
  { key: 'employee_role', label: 'Employee roles', used_by: ['Employees — Role'],
    values: [val(13, 'Owner', 10), val(14, 'Inspector', 30), val(15, 'Radon Technician', 40),
             val(16, 'Apprentice', 70, false)] },
];

export async function demoFetch(path, opts = {}) {
  await new Promise((r) => setTimeout(r, 90));
  const [p] = path.split('?');

  if (p === '/auth/setup') return { needs_first_owner: false };
  if (p === '/auth/login') return { token: 'demo', user: DEMO_ME };
  if (p === '/auth/me') return { user: DEMO_ME };
  if (p === '/users') return { users: demoLogins, roles: ['field', 'office', 'admin', 'owner'] };
  if (p === '/records/catalog') return { entities: catalog };
  if (p === '/ops/lookups') return { lookups: {} };
  if (p === '/ops/lookup-lists') return { lists: demoLists };
  if (p === '/ops/field/config') return { modules };
  if (p === '/ops/dashboard') {
    const buckets = horizon.reduce((a, h) => ({ ...a, [h.state]: (a[h.state] || 0) + 1 }), {});
    return {
      horizon, buckets, readiness,
      fleet: { total: 3, active: 2, reg_soon: 1 },
      lowStock: supplies.filter((s) => s.quantity_on_hand <= s.reorder_point),
      pendingFieldSubmissions: submissions.length,
    };
  }
  if (p === '/ops/compliance') return { items: horizon };
  if (p === '/radon/board') return { open: openTests, recent: recentTests, qa: qaStatus,
    rule: QA_RULE, exceptions: qaExceptions };
  if (p === '/radon/exceptions') return { exceptions: qaExceptions };
  if (p === '/radon/qa-status') return { devices: qaStatus, rule: QA_RULE,
    outOfTolerance: recentTests.filter((t) => t.rpd_within_tolerance === false) };
  if (p === '/radon/qa-check') return { ...qaStatus[0], tolerance_pct: 36, enforced: true };
  if (p.startsWith('/radon/tests/')) return anyDetail(p.split('/')[3]);
  if (p.startsWith('/ops/field/submissions')) return { submissions };
  if (p.startsWith('/records/')) {
    const key = p.split('/')[2];
    const rows = rowsFor[key] || [];
    const search = new URLSearchParams(path.split('?')[1] || '').get('search');
    const filtered = search
      ? rows.filter((r) => JSON.stringify(r).toLowerCase().includes(search.toLowerCase()))
      : rows;
    return { entity: key, total: filtered.length, rows: filtered, limit: 50, offset: 0 };
  }
  return {};
}
