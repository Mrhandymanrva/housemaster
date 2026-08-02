import { useEffect, useState } from 'react';
import { api, getToken, setToken } from './lib/api.js';
import { DEMO } from './lib/demo.js';
import { plainName, plainDesc } from './lib/plain.js';
import Icon from './components/Icons.jsx';
import Login from './pages/Login.jsx';
import Home from './pages/Home.jsx';
import Attention from './pages/Attention.jsx';
import RecordsHub from './pages/RecordsHub.jsx';
import Records from './pages/Records.jsx';
import FieldSetup from './pages/FieldSetup.jsx';
import Radon from './pages/Radon.jsx';
import Inbox from './pages/Inbox.jsx';
import Team from './pages/Team.jsx';

/* Where you can go. `min` hides a destination from anyone below that role. */
const NAV = [
  { key: 'home',      label: 'Home',            icon: 'home' },
  { key: 'attention', label: 'Needs attention', icon: 'alert' },
  { key: 'radon',     label: 'Radon',           icon: 'gauge' },
  { key: 'records',   label: 'Records',         icon: 'table' },
  { key: 'inbox',     label: 'From the field',  icon: 'inbox' },
  { key: 'field',     label: 'Phone app',       icon: 'phone' },
  { key: 'team',      label: 'Logins',          icon: 'users', min: 'admin' },
];

const RANK = { field: 1, office: 2, admin: 3, owner: 4 };
const allowed = (n, role) => !n.min || (RANK[role] || 0) >= RANK[n.min];

const PAGE = {
  home:      ['Home', "Where everything stands this morning."],
  attention: ['Needs attention', 'Everything with a date on it, soonest first. This list builds itself from your records.'],
  radon:     ['Radon', 'Sets in the field, results, chain of custody, and where each monitor stands on its quality checks.'],
  records:   ['Records', 'All the information you keep. Pick something to look at.'],
  inbox:     ['From the field', 'What your people sent in from their phones, waiting on you.'],
  field:     ['Phone app', 'Decide what your people see on their phones. Changes show up the next time they open it.'],
  team:      ['Logins', 'Who can sign in, and what each of them is allowed to do.'],
};

const initials = (n = '') => n.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

export default function App() {
  const [user, setUser] = useState(
    DEMO ? { id: 'u1', name: 'Mason Holloway', role: 'owner', email: 'mason@hmrichmond.com' } : null
  );
  const [cat, setCat] = useState([]);
  const [route, setRoute] = useState('home');
  const [pending, setPending] = useState(0);
  const [overdue, setOverdue] = useState(0);

  useEffect(() => {
    if (!user && getToken()) api('/auth/me').then((d) => setUser(d.user)).catch(() => setToken(null));
  }, [user]);

  useEffect(() => {
    if (!user) return;
    api('/records/catalog').then((d) => setCat(d.entities)).catch(() => {});
    api('/ops/field/submissions?status=pending')
      .then((d) => setPending(d.submissions.length)).catch(() => {});
    api('/ops/dashboard')
      .then((d) => setOverdue(d.buckets?.Overdue || 0)).catch(() => {});
  }, [user]);

  if (!user) return <Login onIn={setUser} />;

  const entity = route.startsWith('records:') ? cat.find((e) => e.key === route.slice(8)) : null;
  const nav = entity ? 'records' : route;
  const [title, sub] = entity ? [plainName(entity), plainDesc(entity)] : PAGE[route];
  const counts = { inbox: pending, attention: overdue };

  return (
    <div className="app">
      <nav className="rail">
        <div className="brand">
          <div className="brand-mark">HM</div>
          <div>
            <div className="brand-name">HouseMaster</div>
            <div className="brand-sub">Richmond</div>
          </div>
        </div>

        {NAV.filter((n) => allowed(n, user.role)).map((n) => (
          <button key={n.key} className={`nav-item ${nav === n.key ? 'active' : ''}`}
                  onClick={() => setRoute(n.key)}>
            <Icon name={n.icon} size={19} /> {n.label}
            {counts[n.key] > 0 && <span className="count">{counts[n.key]}</span>}
          </button>
        ))}

        <div className="rail-foot">
          <div className="who">
            <div className="avatar">{initials(user.name)}</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 550 }}>{user.name}</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-3)', textTransform: 'capitalize' }}>{user.role}</div>
            </div>
          </div>
          <button className="nav-item" onClick={() => { setToken(null); setUser(null); }}>
            <Icon name="logout" size={19} /> Sign out
          </button>
        </div>
      </nav>

      <main className="main">
        <header className="topbar">
          <div style={{ minWidth: 0 }}>
            {entity && (
              <button className="back" onClick={() => setRoute('records')}>
                <Icon name="left" size={15} /> All records
              </button>
            )}
            <h1>{title}</h1>
            {sub && <div className="sub">{sub}</div>}
          </div>
        </header>

        <div className="content">
          {route === 'home' && <Home go={setRoute} name={user.name} />}
          {route === 'attention' && <Attention />}
          {route === 'radon' && <Radon />}
          {route === 'records' && <RecordsHub entities={cat} go={setRoute} />}
          {route === 'inbox' && <Inbox onCount={setPending} />}
          {route === 'field' && <FieldSetup />}
          {route === 'team' && allowed({ min: 'admin' }, user.role) && <Team me={user} />}
          {entity && <Records key={entity.key} entity={entity} />}
        </div>
      </main>
    </div>
  );
}
