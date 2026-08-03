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
const API = '/api';
const LS = {
  token: 'hm_field_token',
  user: 'hm_field_user',
  config: 'hm_field_config',
  reminders: 'hm_field_reminders',
  options: 'hm_field_options',
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
  const [cfg, rem] = await Promise.allSettled([
    api('/ops/field/config'),
    api('/ops/field/reminders'),
  ]);
  if (cfg.status === 'fulfilled') {
    state.modules = cfg.value.modules || [];
    write(LS.config, state.modules);
    cacheRefOptions();
  }
  if (rem.status === 'fulfilled') {
    state.reminders = rem.value.reminders || [];
    write(LS.reminders, state.reminders);
  }
  render();
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

const dueText = (d) => {
  if (d < 0) return d === -1 ? '1 day late' : `${-d} days late`;
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  return `in ${d} days`;
};

const visible = (f, draft) => {
  const rule = f.visible_if;
  if (!rule || !rule.field) return true;
  const v = draft[rule.field];
  if ('equals' in rule) return v === rule.equals;
  return !!v;
};

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

  // ------------------------------------------------------------ reminders
  const overdue = state.reminders.filter((r) => r.days_out < 0);
  const soon = state.reminders.filter((r) => r.days_out >= 0);
  if (state.reminders.length) {
    body.append(el('<div class="section-label">Needs your attention</div>'));
    const list = el('<div class="reminders"></div>');
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

  for (const f of fields) {
    if (!visible(f, state.draft)) continue;
    body.append(fieldControl(f));
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

function fieldControl(f) {
  const box = el(`
    <div class="field">
      <label for="f_${esc(f.key)}">${esc(f.label)}${f.required ? ' <span class="need">— needed</span>' : ''}</label>
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
    sel.onchange = (e) => set(e.target.value);
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
  const shown = fields.filter((f) => visible(f, state.draft));
  const missing = shown.filter((f) => f.required &&
    (state.draft[f.key] === undefined || state.draft[f.key] === '' ||
     (f.input_type === 'toggle' && state.draft[f.key] !== true)));
  if (missing.length) {
    state.err = `Still needed: ${missing.map((f) => f.label).join(', ')}`;
    render();
    return;
  }

  // A ref field that points at the module's own entity and maps to no column
  // is naming the record being reported on, not answering a question.
  const anchor = shown.find((f) => REF_ENTITY[f.input_type]
    && !f.maps_to_column && REF_ENTITY[f.input_type] === mod.target_entity);

  const payload = {};
  for (const f of shown) if (state.draft[f.key] !== undefined) payload[f.key] = state.draft[f.key];

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
  state.busy = false;
  state.draft = {};
  state.route = { name: 'home' };
  render();
  flush();
  refresh().catch(() => {});
}

// ---------------------------------------------------------------- render
function render() {
  const root = document.getElementById('app');
  root.textContent = '';
  if (!state.token) { root.append(loginScreen()); return; }
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
