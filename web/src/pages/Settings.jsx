import { useState } from 'react';
import FieldSetup from './FieldSetup.jsx';
import Isn from './Isn.jsx';
import Lists from './Setup.jsx';
import Team from './Team.jsx';
import { atLeast } from '../lib/roles.js';

/**
 * The four things you set up once and then leave alone.
 *
 * They used to be four destinations in the sidebar, at eye level with the
 * screens somebody opens every morning, so every glance at the nav was a small
 * sorting task: which of these is work and which is configuration. They are
 * all configuration. One destination, four tabs, and the daily screens get the
 * sidebar to themselves.
 *
 * Nothing about them changed — the same four pages render here.
 */
const TABS = [
  { key: 'field', label: 'Phone app', min: 'office',
    hint: 'What your people see on their phones.' },
  { key: 'isn', label: 'ISN link', min: 'office',
    hint: 'Where the jobs come from, and which inspector is which.' },
  { key: 'lists', label: 'Lists', min: 'admin',
    hint: 'The choices behind every dropdown in the app.' },
  { key: 'logins', label: 'Logins', min: 'admin',
    hint: 'Who can sign in, and what each of them is allowed to do.' },
];



export default function Settings({ user, tab, onTab }) {
  const allowed = TABS.filter((t) => atLeast(user.role, t.min));
  const [local, setLocal] = useState(allowed[0]?.key);
  const current = allowed.some((t) => t.key === tab) ? tab : local;
  const pick = (k) => { setLocal(k); onTab?.(k); };
  const here = allowed.find((t) => t.key === current) || allowed[0];

  if (!allowed.length) return <div className="banner">Nothing here is yours to change.</div>;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="tabs" role="tablist">
        {allowed.map((t) => (
          <button key={t.key} role="tab" aria-selected={t.key === here.key}
                  className={`tab ${t.key === here.key ? 'on' : ''}`}
                  onClick={() => pick(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="sub" style={{ marginTop: -6 }}>{here.hint}</div>

      {here.key === 'field' && <FieldSetup />}
      {here.key === 'isn' && <Isn />}
      {here.key === 'lists' && <Lists />}
      {here.key === 'logins' && <Team me={user} />}
    </div>
  );
}
