/* HouseMaster Field — the phone app.
 *
 * Plain browser JavaScript on purpose: it has to run from a cold cache on a
 * phone with one bar in somebody's crawlspace, and a build step is one more
 * thing between a change and a tech seeing it.
 *
 * Everything the tech needs to fill a form in — the modules, the fields, the
 * dropdown choices, the vehicle list — is cached the moment they sign in, so
 * losing signal mid-form costs nothing. Submissions queue and go when service
 * comes back, keyed by a uuid the phone makes, so a retry cannot double-post.
 */
import { decide, validateDeployment, advance, merge } from './qa-guard.js';

const API = '/api';
const LS = {
  token: 'hm_field_token',
  user: 'hm_field_user',
  config: 'hm_field_config',
  reminders: 'hm_field_reminders',
  options: 'hm_field_options',
  ledger: 'hm_field_ledger',
  today: 'hm_field_today',
  kit: 'hm_field_kit',
  scope: 'hm_field_scope',
  queue: 'hm_field_queue',
  device: 'hm_field_device',
};

const read = (k, fallback = null) => {
  try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; }
};
const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));

const state = {
  token: localStorage.getItem(LS.token) || null,
  user: read(LS.user),
  modules: read(LS.config, []),
  reminders: read(LS.reminders, []),
  options: read(LS.options, {}),
  ledger: read(LS.ledger, []),
  today: read(LS.today, null),
  jobs: null,
  kit: read(LS.kit, null),
  scope: localStorage.getItem('hm_field_scope') || null,
  route: { name: 'home' },
  draft: {},
  busy: false,
  err: null,
  flash: null,
  online: navigator.onLine,
};

if (!localStorage.getItem(LS.device)) {
  localStorage.setItem(LS.device, (crypto.randomUUID?.() || String(Date.now())).slice(0, 18));
}

// ------------------------------------------------------------------- api
async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    method: opts.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { signOut(); throw new Error(data.error || 'Sign in again.'); }
  if (!res.ok) throw new Error(data.error || 'That did not go through.');
  return data;
}

function signOut() {
  state.token = null; state.user = null;
  localStorage.removeItem(LS.token); localStorage.removeItem(LS.user);
}

// ------------------------------------------------------------ the queue
const queue = {
  all: () => read(LS.queue, []),
  add(item) { write(LS.queue, [...queue.all(), item]); },
  drop(id) { write(LS.queue, queue.all().filter((q) => q.client_uuid !== id)); },
};

let flushing = false;
async function flush() {
  if (flushing || !state.token || !navigator.onLine) return;
  const pending = queue.all();
  if (!pending.length) return;
  flushing = true;
  for (const item of pending) {
    try {
      await api('/ops/field/submissions', { method: 'POST', body: item });
      queue.drop(item.client_uuid);
    } catch (e) {
      if (/sign in/i.test(e.message)) break;   // auth — stop, do not burn the queue
      if (!navigator.onLine) break;            // signal went again
      queue.drop(item.client_uuid);            // server refused it; holding it forever helps nobody
      state.err = 'One queued form was refused: ' + e.message;
    }
  }
  flushing = false;
  render();
}

// --------------------------------------------------------------- loading
async function refresh() {
  const [cfg, rem, led, day, kit] = await Promise.allSettled([
    api('/ops/field/config'),
    api('/ops/field/reminders'),
    api('/radon/ledger'),
    api(`/ops/field/today${state.scope === 'me' ? '?scope=me' : ''}`),
    api(`/ops/field/equipment${state.scope === 'me' ? '?scope=me' : ''}`),
  ]);
  if (day.status === 'fulfilled') {
    state.today = day.value;
    write(LS.today, state.today);
  }
  if (kit.status === 'fulfilled') {
    state.kit = kit.value;
    write(LS.kit, state.kit);
  }
  if (cfg.status === 'fulfilled') {
    state.modules = cfg.value.modules || [];
    write(LS.config, state.modules);
    cacheRefOptions();
  }
  if (rem.status === 'fulfilled') {
    state.reminders = rem.value.reminders || [];
    write(LS.reminders, state.reminders);
  }
  // Fold the server's count into the local one. merge() keeps sets this phone
  // has queued but not yet sent, because the server has not seen those.
  if (led.status === 'fulfilled') {
    state.ledger = merge(state.ledger, led.value.devices || [], led.value.syncedAt);
    write(LS.ledger, state.ledger);
  }
  render();
}

/**
 * Where a module stands on the duplicate rule.
 *
 *   none     — this form has nothing to do with radon QA
 *   pending  — it does, but no monitor is chosen yet, so there is nothing to decide
 *   decided  — qa-guard has ruled on the monitor in hand
 */
function qaContext(mod) {
  if (mod.qa_rule !== 'radon_duplicate') return { mode: 'none' };
  const id = state.draft.primary_device;
  if (!id) return { mode: 'pending' };
  const entry = state.ledger.find((e) => e.equipmentId === id) || null;
  return { mode: 'decided', entry, qa: decide(entry) };
}

const REF_ENTITY = {
  ref_vehicle: 'vehicles', ref_equipment: 'equipment', ref_supply: 'supplies',
  ref_vendor: 'vendors', ref_employee: 'employees',
};

/** Pull the pick-lists down while there is still signal. */
async function cacheRefOptions() {
  const wanted = new Set();
  for (const m of state.modules) {
    for (const f of m.form?.fields || []) if (REF_ENTITY[f.input_type]) wanted.add(REF_ENTITY[f.input_type]);
  }
  for (const entity of wanted) {
    try {
      const d = await api(`/records/${entity}/_options/list`);
      state.options[entity] = d.options || [];
    } catch { /* keep whatever was cached */ }
  }
  write(LS.options, state.options);
}

// ----------------------------------------------------------------- photo
/** Shrink to something a phone can post over one bar. */
function shrink(file, max = 1024, quality = 0.55) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that photo.'));
    reader.onload = () => { img.src = reader.result; };
    img.onerror = () => reject(new Error('That file is not a photo.'));
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    reader.readAsDataURL(file);
  });
}

// ------------------------------------------------------------------ bits
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Money, short enough for a stat tile: $12.4k rather than $12,431.00. */
const money0 = (n) => {
  const v = Number(n) || 0;
  if (v >= 100000) return `$${Math.round(v / 1000)}k`;
  if (v >= 10000) return `$${(v / 1000).toFixed(1)}k`;
  return `$${Math.round(v).toLocaleString()}`;
};

const dueText = (d) => {
  if (d < 0) return d === -1 ? '1 day late' : `${-d} days late`;
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  return `in ${d} days`;
};

/**
 * A question tagged {"qa":"duplicate_required"} only appears on a set that owes
 * a duplicate. On a form with no QA rule — retrieval, where the phone cannot
 * know offline whether that set went out as a pair — the question is shown
 * anyway but not insisted on, so a duplicate reading is never impossible to
 * record and an ordinary one is never blocked.
 */
const visible = (f, draft, ctx = { mode: 'none' }) => {
  const rule = f.visible_if;
  if (!rule) return true;
  if (rule.qa === 'duplicate_required') {
    if (ctx.mode === 'decided') return ctx.qa.requiresDuplicate;
    return ctx.mode === 'none';
  }
  if (!rule.field) return true;
  const v = draft[rule.field];
  if ('equals' in rule) return v === rule.equals;
  return !!v;
};

/** Optional when we are only showing it in case it is wanted. */
const requiredHere = (f, ctx) =>
  f.required && !(f.visible_if?.qa && ctx.mode === 'none');

const el = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};

// --------------------------------------------------------------- screens
function loginScreen() {
  const box = el(`
    <div class="login">
      <div class="mark">HM</div>
      <h1>HouseMaster Field</h1>
      <p>Sign in with the email your office set up.</p>
      <div class="err"></div>
      <div class="field">
        <label for="e">Email</label>
        <input id="e" type="email" autocomplete="username" inputmode="email" autocapitalize="off" />
      </div>
      <div class="field">
        <label for="p">Password</label>
        <input id="p" type="password" autocomplete="current-password" />
      </div>
      <button class="btn primary" id="go">Sign in</button>
    </div>`);

  const err = box.querySelector('.err');
  if (state.err) err.append(el(`<div class="banner">${esc(state.err)}</div>`));

  const go = async () => {
    const email = box.querySelector('#e').value.trim();
    const password = box.querySelector('#p').value;
    box.querySelector('#go').disabled = true;
    state.err = null;
    try {
      const d = await api('/auth/login', { method: 'POST', body: { email, password } });
      state.token = d.token; state.user = d.user;
      localStorage.setItem(LS.token, d.token);
      write(LS.user, d.user);
      render();
      refresh();
    } catch (e) {
      state.err = e.message;
      render();
    }
  };
  box.querySelector('#go').onclick = go;
  box.querySelectorAll('input').forEach((i) => {
    i.onkeydown = (ev) => { if (ev.key === 'Enter') go(); };
  });
  return box;
}

async function loadKit() {
  try {
    const d = await api(`/ops/field/equipment${state.scope === 'me' ? '?scope=me' : ''}`);
    state.kit = d;
    write(LS.kit, d);
  } catch (e) {
    state.err = e.message;
    state.kit = state.kit || { equipment: [], statuses: [], conditions: [] };
  }
  render();
}

/** Anything a tech should look twice at before driving off. */
const kitFlagged = (list = []) =>
  list.filter((x) => x.status === 'Needs Repair' || x.status === 'In Calibration'
    || (x.calibration_days != null && Number(x.calibration_days) <= 14));

async function loadJobs() {
  const { kind, period } = state.route;
  try {
    const d = await api(`/ops/field/jobs?kind=${encodeURIComponent(kind)}&period=${period}${
      state.scope === 'me' ? '&scope=me' : ''}`);
    state.jobs = d.jobs || [];
  } catch (e) {
    state.jobs = [];
    state.err = e.message;
  }
  render();
}

const clock = (iso) => {
  if (!iso) return 'No time set';
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};
const dayName = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Today';
  return d.toLocaleDateString([], { weekday: 'long' });
};

/**
 * The kit signed out to this person.
 *
 * Tapping one opens what a tech actually needs to say about it: it is broken,
 * it is away being calibrated, here is what happened to it. The status lands
 * straight away — a bent ladder should stop being usable now, not when the
 * office next opens the inbox.
 */
function kitScreen() {
  const wrap = el('<div></div>');
  wrap.append(el(`
    <div class="top">
      <button class="back" id="b">‹ Back</button>
      <h1>Your equipment</h1>
    </div>`));
  wrap.querySelector('#b').onclick = () => {
    state.route = { name: 'home' }; state.err = null; render();
  };

  const body = el('<div class="wrap"></div>');
  if (state.err) body.append(el(`<div class="banner">${esc(state.err)}</div>`));
  if (state.flash) body.append(el(`<div class="ok">${esc(state.flash)}</div>`));

  const kit = state.kit;
  if (!kit) {
    body.append(el('<div class="empty"><div class="spinner" style="margin:0 auto 12px"></div>Loading…</div>'));
    wrap.append(body);
    return wrap;
  }
  if (!kit.equipment?.length) {
    body.append(el(`<div class="empty">
      <h3>Nothing signed out to you</h3>
      <p>The office assigns equipment to a person on the Records screen.</p>
    </div>`));
    wrap.append(body);
    return wrap;
  }

  const open = state.route.itemId;
  for (const item of kit.equipment) {
    const due = item.calibration_days == null ? null : Number(item.calibration_days);
    const flagged = item.status === 'Needs Repair' || item.status === 'In Calibration'
      || (due != null && due <= 14);

    // One fact per row, labelled. Everything on one line was unreadable at
    // arm's length, which is the only distance this gets read at.
    const rows = [
      ['Condition', item.condition],
      ['Category', item.asset_category],
      ['On van', item.on_vehicle],
      ['Where', item.current_location],
      ['Serial', item.serial_number, 'mono'],
      ['Asset tag', item.asset_tag, 'mono'],
      ['Calibration', due == null ? null
        : due < 0 ? `${-due} days overdue`
        : due === 0 ? 'due today'
        : `due in ${due} days`, due != null && due <= 14 ? 'warn' : ''],
    ].filter(([, v]) => v != null && v !== '');

    const card = el(`
      <div class="kit ${flagged ? 'flag' : ''}">
        <button class="kit-head">
          <span class="name">${esc(item.name)}</span>
          <span class="pip ${item.status === 'Needs Repair' ? 'bad'
            : item.status === 'In Calibration' ? 'wait' : ''}">${esc(item.status)}</span>
          <span class="chev">${open === item.id ? '⌄' : '›'}</span>
        </button>
        <dl class="spec">
          ${rows.map(([k, v, cls]) => `
            <div><dt>${esc(k)}</dt><dd class="${cls || ''}">${esc(v)}</dd></div>`).join('')}
        </dl>
      </div>`);

    card.querySelector('.kit-head').onclick = () => {
      state.route = { ...state.route, itemId: open === item.id ? null : item.id };
      state.draft = open === item.id ? {} : { status: item.status, condition: item.condition, note: '' };
      render();
    };

    if (open === item.id) {
      const form = el('<div class="kit-form"></div>');

      const pick = (label, key, options) => {
        const box = el(`<div class="field"><label>${esc(label)}</label></div>`);
        const sel = el('<select></select>');
        for (const o of options) {
          const opt = el(`<option value="${esc(o.value)}">${esc(o.label)}</option>`);
          if (state.draft[key] === o.value) opt.selected = true;
          sel.append(opt);
        }
        sel.onchange = (e) => { state.draft[key] = e.target.value; };
        box.append(sel);
        return box;
      };

      form.append(pick('Status', 'status', kit.statuses));
      if (kit.conditions.length) form.append(pick('Condition', 'condition', kit.conditions));

      const noteBox = el(`
        <div class="field">
          <label>What happened</label>
          <textarea placeholder="Rung is bent, taped it off. Needs replacing before the next attic."></textarea>
          <div class="help">Added to this item's history. Nothing is overwritten.</div>
        </div>`);
      const ta = noteBox.querySelector('textarea');
      ta.value = state.draft.note || '';
      ta.oninput = (e) => { state.draft.note = e.target.value; };
      form.append(noteBox);

      const save = el(`<button class="btn primary">${state.busy === item.id ? 'Saving…' : 'Save it'}</button>`);
      save.disabled = state.busy === item.id;
      save.onclick = async () => {
        state.busy = item.id; state.err = null; render();
        try {
          await api(`/ops/field/equipment/${item.id}`, {
            method: 'PATCH',
            body: {
              status: state.draft.status,
              condition: state.draft.condition,
              note: state.draft.note,
            },
          });
          state.flash = `${item.name} updated.`;
          state.route = { name: 'kit' };
          state.draft = {};
        } catch (e) {
          state.err = e.message;
        }
        state.busy = false;
        render();
        loadKit();
      };
      form.append(save);
      card.append(form);
    }

    body.append(card);
  }

  wrap.append(body);
  return wrap;
}

/** The jobs behind a tile. Grouped by inspector when looking at the branch. */
function jobsScreen() {
  const { label, heading } = state.route;
  const wrap = el('<div></div>');
  wrap.append(el(`
    <div class="top">
      <button class="back" id="b">‹ Back</button>
      <h1>${esc(label)}</h1>
    </div>`));
  wrap.querySelector('#b').onclick = () => {
    state.route = { name: 'home' }; state.jobs = null; state.err = null; render();
  };

  const body = el('<div class="wrap"></div>');
  body.append(el(`<div class="section-label">${esc(heading)}</div>`));

  if (state.jobs === null) {
    body.append(el('<div class="empty"><div class="spinner" style="margin:0 auto 12px"></div>Loading…</div>'));
    wrap.append(body);
    return wrap;
  }
  if (!state.jobs.length) {
    body.append(el('<div class="empty">Nothing here.</div>'));
    wrap.append(body);
    return wrap;
  }

  // One heading per inspector when this is the whole branch; a flat list when
  // it is one person's own day, because repeating their name adds nothing.
  const byPerson = new Map();
  for (const j of state.jobs) {
    const key = j.inspector || 'Nobody here yet';
    if (!byPerson.has(key)) byPerson.set(key, []);
    byPerson.get(key).push(j);
  }
  const grouped = state.today?.scope === 'branch' && byPerson.size > 1;

  const jobCard = (j) => el(`
    <div class="job">
      <div class="when">
        <b>${esc(clock(j.scheduled_start))}</b>
        <span>${esc(dayName(j.scheduled_start))}</span>
      </div>
      <div class="what">
        <div class="addr">${esc(j.property_address || 'No address')}</div>
        <div class="meta">${esc([j.property_city, j.client_name].filter(Boolean).join(' · '))}${
          j.order_number ? ` · #${esc(j.order_number)}` : ''}</div>
        ${(j.crew || []).length > 1
          ? `<div class="meta">With ${esc(j.crew.join(' and '))}</div>` : ''}
      </div>
      ${j.has_radon ? '<span class="pip">radon</span>' : ''}
    </div>`);

  if (grouped) {
    for (const [person, jobs] of [...byPerson.entries()].sort((a, b) => b[1].length - a[1].length)) {
      body.append(el(`<div class="who-head">${esc(person)} <span>${jobs.length}</span></div>`));
      for (const j of jobs) body.append(jobCard(j));
    }
  } else {
    for (const j of state.jobs) body.append(jobCard(j));
  }

  wrap.append(body);
  return wrap;
}

/** Today's work and this week's, in the order a tech would ask for them. */
function countBlock() {
  const t = state.today;
  const box = el('<div></div>');
  if (!t) return box;

  if (!t.linked) {
    box.append(el('<div class="section-label">Your day</div>'));
    box.append(el(`<div class="rem"><div class="what">
      <div class="title">This login is not tied to a person yet</div>
      <div class="sub">The office links it under Logins, and then your jobs and
        deadlines show up here.</div>
    </div></div>`));
    return box;
  }

  const kinds = t.kinds || [];
  const row = (heading, period, data) => {
    const cells = [
      { key: 'inspections', label: 'Inspections', n: data.inspections, lead: true },
      { key: 'radon', label: 'Radon', n: data.radon, lead: true },
      ...kinds.map((k) => ({ key: k.key, label: k.label, n: data[k.key] ?? 0 })),
    ];
    const grid = el('<div class="stats"></div>');
    for (const c of cells) {
      const tile = el(`<button class="stat ${c.n ? (c.lead ? 'lead' : '') : 'none'}">
        <b>${c.n ?? 0}</b><span>${esc(c.label)}</span></button>`);
      // A number you cannot open is a number taken on trust.
      tile.disabled = !c.n;
      tile.onclick = () => {
        state.route = { name: 'jobs', kind: c.key, period, label: c.label, heading };
        state.jobs = null;
        render();
        loadJobs();
      };
      grid.append(tile);
    }
    const wrapper = el(`<div><div class="section-label">${esc(heading)}</div></div>`);
    wrapper.append(grid);
    return wrapper;
  };

  box.append(row(t.scope === 'branch' ? 'Today — everyone' : 'Today', 'day', t.today));
  box.append(row(t.scope === 'branch' ? 'This week — everyone' : 'This week', 'week', t.week));

  if (t.placed?.week) {
    box.append(el(`<div class="hint">${t.placed.day} radon ${
      t.placed.day === 1 ? 'set' : 'sets'} actually placed today, ${t.placed.week} this week.</div>`));
  }

  // Money is the owner's question, not the tech's.
  if (t.revenue) {
    box.append(el('<div class="section-label">Booked</div>'));
    const money = el('<div class="stats"></div>');
    money.append(el(`<div class="stat lead"><b>${esc(money0(t.revenue.week))}</b>
      <span>This week</span></div>`));
    money.append(el(`<div class="stat lead"><b>${esc(money0(t.revenue.month))}</b>
      <span>This month</span></div>`));
    money.append(el(`<div class="stat"><b>${esc(money0(t.revenue.monthUnpaid))}</b>
      <span>Not yet paid</span></div>`));
    box.append(money);
    box.append(el(`<div class="hint">What the jobs were booked at, not what has landed
      in the bank. Cancelled and deleted orders are left out.</div>`));
  }

  // Who did what. Only an owner sees this, and only when looking at the branch
  // rather than at themselves.
  if (t.scope === 'branch' && t.crew?.length) {
    box.append(el('<div class="section-label">By inspector, this week</div>'));
    const list = el('<div></div>');
    for (const p of t.crew) {
      list.append(el(`
        <div class="crew">
          <div class="who">${esc(p.name)}</div>
          <div class="tally">
            <b>${p.jobsWeek}</b><span>jobs</span>
            <b>${p.radonWeek}</b><span>radon</span>
          </div>
        </div>`));
    }
    box.append(list);
  }

  if (t.maySeeAll) {
    const toggle = el(`<button class="btn" style="margin-top:14px">${
      t.scope === 'branch' ? 'Just my own' : 'Show everyone'}</button>`);
    toggle.onclick = () => {
      state.scope = t.scope === 'branch' ? 'me' : 'branch';
      write(LS.scope, state.scope);
      refresh().catch(() => {});
    };
    box.append(toggle);
  }

  // Radon comes from our own sets and is always true. The rest is ISN's, and
  // a confident zero from a link that is switched off would be a lie.
  if (!t.isn?.connected) {
    box.append(el(`<div class="hint">Job counts need the ISN link, which is off —
      radon sets are counted from your own placements.</div>`));
  }
  return box;
}

function homeScreen() {
  const wrap = el('<div></div>');
  wrap.append(el(`
    <div class="top">
      <div class="mark">HM</div>
      <h1>${esc(state.user?.name || 'Field')}</h1>
      <button class="back" id="out">Sign out</button>
    </div>`));
  wrap.querySelector('#out').onclick = () => { signOut(); render(); };

  if (!state.online) wrap.append(el('<div class="offline-bar">No signal — forms will send when it comes back</div>'));

  const body = el('<div class="wrap"></div>');

  const queued = queue.all().length;
  if (queued) {
    body.append(el(`<div class="queued">${queued} form${queued > 1 ? 's' : ''} waiting to send.
      ${state.online ? 'Sending now…' : 'They go out when you have signal.'}</div>`));
  }
  if (state.err) body.append(el(`<div class="banner">${esc(state.err)}</div>`));
  if (state.flash) body.append(el(`<div class="ok">${esc(state.flash)}</div>`));

  // ---------------------------------------------------------------- count
  body.append(countBlock());

  // ------------------------------------------------------------ equipment
  const kit = state.kit?.equipment || [];
  if (kit.length) {
    const repair = kit.filter((x) => x.status === 'Needs Repair').length;
    const away = kit.filter((x) => x.status === 'In Calibration').length;
    const dueSoon = kit.filter((x) => x.calibration_days != null
      && Number(x.calibration_days) <= 14 && x.status !== 'In Calibration').length;
    const flagged = kitFlagged(kit);

    // The counts that would make a tech stop and check something, as separate
    // chips rather than a sentence to be parsed.
    const chips = [
      repair && `<span class="chip bad">${repair} needs repair</span>`,
      away && `<span class="chip wait">${away} being calibrated</span>`,
      dueSoon && `<span class="chip warn">${dueSoon} calibration due</span>`,
      !flagged.length && '<span class="chip ok">All in service</span>',
    ].filter(Boolean).join('');

    const tile = el(`
      <button class="wide-tile ${flagged.length ? 'flag' : ''}">
        <div class="what">
          <div class="name">Your equipment
            <span class="tally">${kit.length}</span>
          </div>
          <div class="chips">${chips}</div>
        </div>
        <div class="chev">›</div>
      </button>`);
    tile.onclick = () => {
      state.route = { name: 'kit' }; state.flash = null; state.err = null;
      render();
      loadKit();
    };
    body.append(el('<div class="section-label">Equipment</div>'));
    body.append(tile);
  }

  // ------------------------------------------------------------ deadlines
  // /today carries a wider horizon than /reminders; prefer it and fall back
  // so the screen still works from whatever was cached last.
  const dates = state.today?.deadlines?.length ? state.today.deadlines : state.reminders;
  const overdue = dates.filter((r) => r.days_out < 0);
  const soon = dates.filter((r) => r.days_out >= 0);
  const ceu = state.today?.ceu;

  if (dates.length || ceu) {
    body.append(el('<div class="section-label">Needs your attention</div>'));
    const list = el('<div class="reminders"></div>');

    if (ceu) {
      const done = Math.min(100, Math.round((ceu.completed / ceu.required) * 100));
      list.append(el(`
        <div class="ceu">
          <div class="row">
            <b>Continuing education</b>
            <span>${ceu.completed} of ${ceu.required} hours</span>
          </div>
          <div class="meter ${ceu.short > 0 ? 'short' : ''}"><i style="width:${done}%"></i></div>
          <div class="hint" style="margin-top:8px">${
            ceu.short > 0
              ? `${ceu.short} more ${ceu.short === 1 ? 'hour' : 'hours'} before your next renewal.`
              : 'Enough hours on the board for your next renewal.'
          }</div>
        </div>`));
    }

    for (const r of [...overdue, ...soon]) {
      list.append(el(`
        <div class="rem ${r.days_out < 0 ? 'overdue' : r.days_out <= 30 ? 'soon' : ''}">
          <div class="what">
            <div class="title">${esc(r.title)}</div>
            <div class="sub">${esc(r.subject || r.category)}</div>
          </div>
          <div class="when">${esc(dueText(r.days_out))}</div>
        </div>`));
    }
    body.append(list);
  } else if (state.today) {
    body.append(el('<div class="section-label">Needs your attention</div>'));
    body.append(el(`<div class="rem"><div class="what">
      <div class="title">Nothing is due</div>
      <div class="sub">No licence, van or equipment deadline in the next three months.</div>
    </div></div>`));
  }

  // --------------------------------------------------------------- tiles
  const role = state.user?.role || 'field';
  const mine = state.modules.filter((m) => m.enabled && (m.roles || []).includes(role));

  body.append(el('<div class="section-label">Forms</div>'));
  if (!mine.length) {
    body.append(el('<div class="empty">Nothing is turned on for you yet. The office sets this up under Phone app.</div>'));
  } else {
    const tiles = el('<div class="tiles"></div>');
    for (const m of mine) {
      const tile = el(`
        <button class="tile accent-${esc(m.accent || 'steel')}">
          <div class="dot">${esc((m.name || '?').slice(0, 1))}</div>
          <div class="name">${esc(m.name)}</div>
          <div class="desc">${esc(m.description || '')}</div>
        </button>`);
      tile.onclick = () => {
        state.route = { name: 'form', key: m.key };
        state.draft = {}; state.err = null; state.flash = null;
        render();
      };
      tiles.append(tile);
    }
    body.append(tiles);
  }

  body.append(el(`<div class="muted" style="margin-top:26px;text-align:center">
    ${state.online ? 'Up to date' : 'Working from what was saved last time you had signal'}</div>`));

  wrap.append(body);
  return wrap;
}

function formScreen(mod) {
  const wrap = el('<div></div>');
  wrap.append(el(`
    <div class="top">
      <button class="back" id="b">‹ Back</button>
      <h1>${esc(mod.name)}</h1>
    </div>`));
  wrap.querySelector('#b').onclick = () => {
    state.route = { name: 'home' }; state.err = null; render();
  };

  if (!state.online) wrap.append(el('<div class="offline-bar">No signal — this will send when it comes back</div>'));

  const body = el('<div class="wrap"></div>');
  if (state.err) body.append(el(`<div class="banner">${esc(state.err)}</div>`));

  const fields = (mod.form?.fields || []).filter((f) => f.input_type !== 'section');
  if (!fields.length) {
    body.append(el('<div class="empty">This form has no questions on it yet. The office adds them under Phone app.</div>'));
    wrap.append(body);
    return wrap;
  }

  const ctx = qaContext(mod);
  if (ctx.mode === 'pending') {
    body.append(el(`<div class="note">Pick the monitor first. This phone works out
      whether the set needs a duplicate as soon as it knows which unit you have.</div>`));
  }
  if (ctx.mode === 'decided') body.append(qaBanner(ctx.qa));

  for (const f of fields) {
    if (!visible(f, state.draft, ctx)) continue;
    body.append(fieldControl(f, ctx));
  }

  const foot = el('<div class="foot"></div>');
  const send = el(`<button class="btn primary">${state.busy ? 'Sending…' : 'Send it in'}</button>`);
  send.disabled = state.busy;
  send.onclick = () => submit(mod, fields);
  foot.append(send);
  body.append(foot);

  wrap.append(body);
  return wrap;
}

/** The one thing the tech has to read before they walk into the house. */
function qaBanner(qa) {
  if (qa.requiresDuplicate) {
    return el(`
      <div class="qa stop">
        <div class="qa-title">${esc(qa.short)}</div>
        <div class="qa-body">${esc(qa.reason)}</div>
        ${qa.confident ? '' :
          '<div class="qa-note">This phone is not certain where the monitor is in its cycle, '
          + 'so it is asking for a pair. An extra duplicate costs one monitor-day. A missing '
          + 'one cannot be filled in after the house is tested.</div>'}
      </div>`);
  }
  return el(`
    <div class="qa ok">
      <div class="qa-title">${esc(qa.short)}</div>
      <div class="qa-body">${esc(qa.reason)}</div>
    </div>`);
}

function fieldControl(f, ctx = { mode: 'none' }) {
  const need = requiredHere(f, ctx);
  const box = el(`
    <div class="field">
      <label for="f_${esc(f.key)}">${esc(f.label)}${need ? ' <span class="need">— needed</span>' : ''}</label>
    </div>`);
  const set = (v) => { state.draft[f.key] = v; };
  const t = f.input_type;

  if (t === 'toggle') {
    const on = !!state.draft[f.key];
    const b = el(`<button class="toggle ${on ? 'on' : ''}"><i></i><span>${on ? 'Yes' : 'No'}</span></button>`);
    b.onclick = () => { set(!on); render(); };
    box.append(b);

  } else if (t === 'select' || REF_ENTITY[t]) {
    const opts = REF_ENTITY[t]
      ? (state.options[REF_ENTITY[t]] || []).map((o) => ({ value: o.id, label: o.label }))
      : (f.options || []);
    const sel = el(`<select id="f_${esc(f.key)}"></select>`);
    sel.append(el('<option value="">Choose one…</option>'));
    for (const o of opts) {
      const opt = el(`<option value="${esc(o.value)}">${esc(o.label)}</option>`);
      if (state.draft[f.key] === o.value) opt.selected = true;
      sel.append(opt);
    }
    if (!opts.length) {
      sel.disabled = true;
      sel.firstElementChild.textContent = 'Nothing to choose from yet';
    }
    // Redraw on a pick, not just on a keystroke: choosing the monitor is what
    // decides whether this set owes a duplicate, and the questions that come
    // with it have to appear the moment it is chosen. A select commits a whole
    // value at once, so redrawing here costs no half-typed input.
    sel.onchange = (e) => { set(e.target.value); render(); };
    box.append(sel);

  } else if (t === 'photo' || t === 'signature') {
    const shot = state.draft[f.key];
    if (shot) {
      const s = el(`<div class="shot"><img src="${shot}" alt="" /><button>Retake</button></div>`);
      s.querySelector('button').onclick = () => { set(undefined); render(); };
      box.append(s);
    } else {
      const b = el('<button class="photo-btn">Tap to take a photo</button>');
      const input = el('<input type="file" accept="image/*" capture="environment" hidden />');
      b.onclick = () => input.click();
      input.onchange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try { set(await shrink(file)); state.err = null; }
        catch (err) { state.err = err.message; }
        render();
      };
      box.append(b, input);
    }

  } else if (t === 'textarea') {
    const ta = el(`<textarea id="f_${esc(f.key)}"></textarea>`);
    ta.value = state.draft[f.key] || '';
    ta.oninput = (e) => set(e.target.value);
    box.append(ta);

  } else {
    const type = t === 'integer' || t === 'number' || t === 'currency' ? 'number'
      : t === 'date' ? 'date' : t === 'time' ? 'time' : 'text';
    const i = el(`<input id="f_${esc(f.key)}" type="${type}" />`);
    if (type === 'number') i.inputMode = 'decimal';
    i.value = state.draft[f.key] ?? '';
    i.oninput = (e) => set(e.target.value);
    box.append(i);
  }

  if (f.help_text) box.append(el(`<div class="help">${esc(f.help_text)}</div>`));
  return box;
}

// ---------------------------------------------------------------- submit
async function submit(mod, fields) {
  const ctx = qaContext(mod);
  const shown = fields.filter((f) => visible(f, state.draft, ctx));
  const missing = shown.filter((f) => requiredHere(f, ctx) &&
    (state.draft[f.key] === undefined || state.draft[f.key] === '' ||
     (f.input_type === 'toggle' && state.draft[f.key] !== true)));
  if (missing.length) {
    state.err = `Still needed: ${missing.map((f) => f.label).join(', ')}`;
    render();
    return;
  }

  // The duplicate rule, decided on this phone with whatever it last knew.
  // Nothing leaves until it passes — an incomplete pair is not recoverable
  // once the tech has driven away.
  if (ctx.mode === 'decided') {
    const check = validateDeployment(ctx.entry, {
      primary_device: state.draft.primary_device,
      duplicate_device: state.draft.duplicate_device,
      duplicate_distance: state.draft.duplicate_distance,
      duplicate_photo: state.draft.duplicate_photo,
    });
    if (!check.ok) {
      state.err = check.problems.join(' ');
      render();
      return;
    }
  }

  // A ref field that points at the module's own entity and maps to no column
  // is naming the record being reported on, not answering a question.
  const anchor = shown.find((f) => REF_ENTITY[f.input_type]
    && !f.maps_to_column && REF_ENTITY[f.input_type] === mod.target_entity);

  const payload = {};
  for (const f of shown) if (state.draft[f.key] !== undefined) payload[f.key] = state.draft[f.key];

  // What the phone believed when the tech hit send. If it turns out to have
  // been wrong — an offline set that actually owed a duplicate — this is what
  // lets the office see why, rather than finding a hole with no explanation.
  if (ctx.mode === 'decided') {
    payload._qa = {
      believed_sequence: ctx.qa.sequence,
      interval: ctx.qa.interval,
      confident: ctx.qa.confident,
      duplicate_required: ctx.qa.requiresDuplicate,
      duplicate_placed: !!state.draft.duplicate_device,
      device_synced_at: ctx.entry?.syncedAt ?? null,
      captured_offline: !navigator.onLine,
      queued_at: new Date().toISOString(),
    };
  }

  const body = {
    module_key: mod.key,
    client_uuid: crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    payload,
    target_id: anchor ? state.draft[anchor.key] : null,
    captured_at: new Date().toISOString(),
    device_id: localStorage.getItem(LS.device),
  };

  if (mod.require_gps) {
    body.gps = await new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => resolve(null),
        { timeout: 8000, maximumAge: 60000 }
      );
    });
  }

  state.busy = true; state.err = null; render();
  try {
    if (!navigator.onLine) throw new Error('offline');
    await api('/ops/field/submissions', { method: 'POST', body });
    state.flash = `${mod.name} sent.`;
  } catch (e) {
    if (/sign in/i.test(e.message)) { state.busy = false; render(); return; }
    // Anything that is not the server saying no gets held rather than lost.
    queue.add(body);
    state.flash = `${mod.name} saved. It goes out when you have signal.`;
  }
  // The count moves whether or not that went over the wire, so the next set
  // off this phone is numbered right even with no signal all day. A duplicate
  // resets the cycle — including one placed out of caution that was not owed.
  if (ctx.mode === 'decided' && ctx.entry) {
    const placedDuplicate = !!state.draft.duplicate_device;
    state.ledger = state.ledger.map((e) =>
      e.equipmentId === ctx.entry.equipmentId ? advance(e, { placedDuplicate }) : e);
    write(LS.ledger, state.ledger);
  }

  state.busy = false;
  state.draft = {};
  state.route = { name: 'home' };
  render();
  // Drain the queue before re-reading the ledger. merge() lets the server's
  // count win, so a set that arrives first comes back already counted; asking
  // for the ledger while that set is still sitting in the queue would make the
  // phone forget a duplicate it just placed and ask for another one.
  flush().finally(() => refresh().catch(() => {}));
}

// ---------------------------------------------------------------- render
function render() {
  const root = document.getElementById('app');
  root.textContent = '';
  if (!state.token) { root.append(loginScreen()); return; }
  if (state.route.name === 'jobs') { root.append(jobsScreen()); return; }
  if (state.route.name === 'kit') { root.append(kitScreen()); return; }
  if (state.route.name === 'form') {
    const mod = state.modules.find((m) => m.key === state.route.key);
    if (mod) { root.append(formScreen(mod)); return; }
    state.route = { name: 'home' };
  }
  root.append(homeScreen());
}

window.addEventListener('online', () => { state.online = true; render(); flush(); refresh().catch(() => {}); });
window.addEventListener('offline', () => { state.online = false; render(); });

render();
if (state.token) { refresh().catch(() => {}); flush(); }

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
