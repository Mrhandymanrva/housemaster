import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import Icon from '../components/Icons.jsx';
import { plainName } from '../lib/plain.js';

const TYPE_LABEL = {
  text: 'Types an answer', textarea: 'Types a few sentences', number: 'Types a number',
  integer: 'Types a number', currency: 'Types an amount', date: 'Picks a date',
  time: 'Picks a time', toggle: 'Taps yes or no', select: 'Picks from a list',
  multiselect: 'Picks any that apply', photo: 'Takes a photo', signature: 'Signs with a finger',
  barcode: 'Scans a tag', gps: 'Location is captured', rating: 'Gives a rating',
  ref_employee: 'Picks a person', ref_vehicle: 'Picks a van', ref_equipment: 'Picks equipment',
  ref_supply: 'Picks an item', ref_vendor: 'Picks a vendor',
};

const TARGET = {
  vehicles: 'the van record', equipment: 'the equipment record',
  supplies: 'the supply record', claims_incidents: 'the incident record',
  employees: 'the person\u2019s record',
};

const SETTINGS = [
  ['require_photo', 'They have to take a photo', 'The form will not send without one.'],
  ['require_gps', 'Record where they were', 'Stamps the location when they hit send.'],
  ['require_signature', 'They have to get a signature', 'For anything a customer needs to sign off on.'],
  ['allow_offline', 'Works with no signal', 'Saves on the phone and sends itself once bars come back.'],
  ['auto_apply', 'Save answers without your review', 'Skips your inbox and updates the record right away.'],
];

function Switch({ on, onChange, label }) {
  return (
    <button type="button" className={`switch ${on ? 'on' : ''}`} aria-label={label}
            role="switch" aria-checked={!!on} onClick={(e) => { e.stopPropagation(); onChange(!on); }}>
      <i />
    </button>
  );
}

/** Exactly what the tech will see, drawn from the same settings. */
const isQaOnly = (f) => !!f.visible_if?.qa;

function PhonePreview({ mod, qa }) {
  if (!mod) return null;
  const all = mod.form?.fields || [];
  const fields = all.filter((f) => !isQaOnly(f) || qa);
  return (
    <div className="phone">
      <div className="phone-notch" />
      <div className="phone-screen">
        <div className="phone-head">
          <h3>{mod.name}</h3>
          <span>{mod.allow_offline ? 'Works offline' : 'Needs a signal'}</span>
        </div>
        {mod.qa_rule && qa && (
          <div className="phone-qa">
            <b>Quality-check set — take two monitors</b>
            <span>
              Place the second one right beside the first. You cannot send this
              form until both are recorded.
            </span>
          </div>
        )}
        {fields.map((f) => (
          <div className={`pf ${isQaOnly(f) ? 'qa-only' : ''}`} key={f.key}>
            <label>{f.label}{f.required && <span className="req"> *</span>}</label>
            {f.input_type === 'photo' || f.input_type === 'signature' ? (
              <div className="box cam">
                <Icon name={f.input_type === 'photo' ? 'toolbox' : 'doc'} size={19} />
              </div>
            ) : f.input_type === 'textarea' ? (
              <div className="box tall">{f.help_text || 'Tap to type'}</div>
            ) : f.input_type === 'toggle' ? (
              <div className="box" style={{ display: 'flex', alignItems: 'center' }}>
                Yes<span style={{ marginLeft: 'auto' }}><Switch on onChange={() => {}} label={f.label} /></span>
              </div>
            ) : (
              <div className="box">{TYPE_LABEL[f.input_type] || 'Tap to enter'}</div>
            )}
          </div>
        ))}
        <div className="phone-cta">Send it in</div>
        {mod.qa_rule && qa && (
          <div style={{ fontSize: 11.5, color: 'var(--text-3)', textAlign: 'center', marginTop: 8 }}>
            Blocked until the second monitor is filled in
          </div>
        )}
      </div>
    </div>
  );
}

export default function FieldSetup() {
  const [mods, setMods] = useState([]);
  const [sel, setSel] = useState(null);
  const [saved, setSaved] = useState(false);
  const [qaRule, setQaRule] = useState(null);
  const [qaPreview, setQaPreview] = useState(true);

  useEffect(() => {
    api('/ops/field/config').then((d) => { setMods(d.modules); setSel(d.modules[0]?.id); });
    api('/radon/qa-status').then((d) => setQaRule(d.rule)).catch(() => {});
  }, []);

  const patchRule = async (body) => {
    setQaRule((x) => ({ ...x, ...body }));
    try {
      await api('/radon/qa-rule', { method: 'PATCH', body });
      setSaved(true); setTimeout(() => setSaved(false), 1800);
    } catch { /* demo mode does not write */ }
  };

  const mod = mods.find((m) => m.id === sel);
  const live = mods.filter((m) => m.enabled).length;

  const patch = async (id, body) => {
    setMods((ms) => ms.map((m) => (m.id === id ? { ...m, ...body } : m)));
    try {
      await api(`/ops/field/modules/${id}`, { method: 'PATCH', body });
      setSaved(true); setTimeout(() => setSaved(false), 1800);
    } catch { /* demo mode does not write */ }
  };

  return (
    <div className="studio">
      <div className="stack">
        <div className="card">
          <div className="card-head">
            <div>
              <h2>What your people can do</h2>
              <div className="sub">{live} of {mods.length} turned on. Flip a switch and it changes on their phones.</div>
            </div>
            {saved && <span className="pill green" style={{ marginLeft: 'auto' }}>Saved</span>}
          </div>
          {mods.map((m) => (
            <div key={m.id} className={`module-row ${sel === m.id ? 'sel' : ''}`} onClick={() => setSel(m.id)}>
              <div className={`ico ${m.accent}`}><Icon name={m.icon} size={19} /></div>
              <div className="m">
                <b>{m.name}</b>
                <span>{m.description}</span>
              </div>
              <div className="state">{m.enabled ? 'On their phone' : 'Hidden'}</div>
              <Switch on={m.enabled} label={`Turn ${m.name} on`}
                      onChange={(v) => patch(m.id, { enabled: v })} />
            </div>
          ))}
        </div>

        {mod && (
          <div className="card">
            <div className="card-head">
              <div>
                <h2>Rules for &ldquo;{mod.name}&rdquo;</h2>
                <div className="sub">
                  Answers come back to {TARGET[mod.target_entity] || 'your records'}.
                </div>
              </div>
            </div>
            <div className="card-body" style={{ paddingTop: 4, paddingBottom: 4 }}>
              {SETTINGS.map(([k, label, help]) => (
                <div className="setting" key={k}>
                  <div style={{ minWidth: 0 }}>
                    <b>{label}</b>
                    <span>{help}</span>
                  </div>
                  <span style={{ marginLeft: 'auto' }}>
                    <Switch on={mod[k]} label={label} onChange={(v) => patch(mod.id, { [k]: v })} />
                  </span>
                </div>
              ))}
            </div>

            {mod.qa_rule === 'radon_duplicate' && qaRule && (
              <>
                <div className="card-head" style={{ borderTop: '1px solid var(--line)' }}>
                  <div>
                    <h2>The duplicate rule</h2>
                    <div className="sub">
                      Every so often a set goes out with two monitors instead of one, so you can
                      prove the equipment reads true. This is the only place that number lives.
                    </div>
                  </div>
                </div>
                <div className="card-body" style={{ paddingTop: 4, paddingBottom: 4 }}>
                  <div className="setting">
                    <div>
                      <b>Every how many sets</b>
                      <span>Counted per {qaRule.scope === 'device' ? 'monitor' : qaRule.scope}.</span>
                    </div>
                    <input className="input" type="number" min="2" style={{ width: 90, marginLeft: 'auto' }}
                           value={qaRule.duplicate_interval}
                           onChange={(e) => patchRule({ duplicate_interval: Number(e.target.value) })} />
                  </div>
                  <div className="setting">
                    <div>
                      <b>Count them per</b>
                      <span>Per monitor proves each unit. Per inspector proves each person.</span>
                    </div>
                    <select className="plain" style={{ marginLeft: 'auto' }} value={qaRule.scope}
                            onChange={(e) => patchRule({ scope: e.target.value })}>
                      <option value="device">Monitor</option>
                      <option value="inspector">Inspector</option>
                      <option value="company">The whole company</option>
                    </select>
                  </div>
                  <div className="setting">
                    <div>
                      <b>Flag the pair if they differ by more than</b>
                      <span>How far the two readings can drift before the unit gets pulled.</span>
                    </div>
                    <input className="input" type="number" min="1" style={{ width: 90, marginLeft: 'auto' }}
                           value={qaRule.rpd_tolerance_pct}
                           onChange={(e) => patchRule({ rpd_tolerance_pct: Number(e.target.value) })} />
                  </div>
                  <div className="setting">
                    <div>
                      <b>Block the form without the second monitor</b>
                      <span>Leave this on. The database refuses the set either way.</span>
                    </div>
                    <span style={{ marginLeft: 'auto' }}>
                      <Switch on={qaRule.enforce_in_field} label="Block sending"
                              onChange={(v) => patchRule({ enforce_in_field: v })} />
                    </span>
                  </div>
                </div>
              </>
            )}

            <div className="card-head" style={{ borderTop: '1px solid var(--line)' }}>
              <div>
                <h2>What they get asked</h2>
                <div className="sub">{mod.form?.fields?.length || 0} questions, in this order.</div>
              </div>
            </div>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Question</th>
                    <th style={{ width: 190 }}>How they answer</th>
                    <th style={{ width: 110 }}>Must answer</th>
                    <th style={{ width: 210 }}>Where it goes</th>
                  </tr>
                </thead>
                <tbody>
                  {(mod.form?.fields || []).map((f) => (
                    <tr key={f.key} style={{ cursor: 'default' }}>
                      <td>
                        <div>
                          {f.label}
                          {isQaOnly(f) && (
                            <span className="pill amber" style={{ marginLeft: 8 }}>Only on quality-check sets</span>
                          )}
                        </div>
                        {f.help_text && <div style={{ fontSize: 13, color: 'var(--text-2)' }}>{f.help_text}</div>}
                      </td>
                      <td>{TYPE_LABEL[f.input_type] || f.input_type}</td>
                      <td>{f.required ? <span className="pill amber">Yes</span> : <span className="pill">Optional</span>}</td>
                      <td>
                        {f.maps_to_column
                          ? <span>Updates <b style={{ fontWeight: 550 }}>{f.maps_to_column.replace(/_/g, ' ')}</b></span>
                          : <span style={{ color: 'var(--text-3)' }}>Kept as a record</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <div className="card" style={{ position: 'sticky', top: 0 }}>
        <div className="card-head">
          <div>
            <h2>On their phone</h2>
            <div className="sub">Updates as you change things.</div>
          </div>
        </div>
        {mod?.qa_rule && (
          <div className="card-body" style={{ paddingBottom: 0 }}>
            <div className="segmented" style={{ width: '100%' }}>
              <button className={!qaPreview ? 'on' : ''} style={{ flex: 1 }}
                      onClick={() => setQaPreview(false)}>An ordinary set</button>
              <button className={qaPreview ? 'on' : ''} style={{ flex: 1 }}
                      onClick={() => setQaPreview(true)}>A quality-check set</button>
            </div>
          </div>
        )}
        <div className="card-body">
          <PhonePreview mod={mod} qa={qaPreview && !!mod?.qa_rule} />
        </div>
      </div>
    </div>
  );
}
