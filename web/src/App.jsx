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
import Radon from './pages/Radon.jsx';
import Inbox from './pages/Inbox.jsx';
import Settings from './pages/Settings.jsx';
import Money from './pages/Money.jsx';
import CommandBar from './components/CommandBar.jsx';

/*
 * Where you can go, in four groups.
 *
 * It was nine flat destinations, four of which are things you configure once a
 * month sitting at eye level with the screens you open every morning — so
 * every glance at the nav was a small sorting task. The groups separate where
 * you work from what you set up, and those four fold into one Settings page
 * with tabs. Nothing about the routing changed; the same pages render.
 *
 * `min` hides a destination from anyone below that role.
 */
const NAV = [
  ['Today', [
    { key: 'home',      label: 'Home',            icon: 'home' },
    { key: 'attention', label: 'Needs attention', icon: 'alert' },
    { key: 'inbox',     label: 'From the field',  icon: 'inbox' },
  ]],
  ['Owner', [
    { key: 'money',     label: 'Money',           icon: 'ledger', min: 'admin' },
  ]],
  ['Work', [
    { key: 'radon',     label: 'Radon',           icon: 'gauge' },
    { key: 'records',   label: 'Records',         icon: 'table' },
  ]],
  ['Setup', [
    { key: 'settings',  label: 'Settings',        icon: 'settings', min: 'office' },
  ]],
];

/* The old destinations still answer, as tabs inside Settings, so anything that
   linked to one of them keeps working. */
const FOLDED = { field: 'field', isn: 'isn', setup: 'lists', team: 'logins' };

const RANK = { field: 1, office: 2, admin: 3, owner: 4 };
const allowed = (n, role) => !n.min || (RANK[role] || 0) >= RANK[n.min];

const PAGE = {
  home:      ['Home', "Where everything stands this morning."],
  attention: ['Needs attention', 'Everything with a date on it, soonest first. This list builds itself from your records.'],
  radon:     ['Radon', 'Sets in the field, results, chain of custody, and where each monitor stands on its quality checks.'],
  records:   ['Records', 'All the information you keep. Pick something to look at.'],
  inbox:     ['From the field', 'What your people sent in from their phones, waiting on you.'],
  settings:  ['Settings', 'The parts you set up once and leave alone: the phone app, the ISN link, your dropdown lists, and who can sign in.'],
  money:     ['Money', 'What the branch booked, what has come in, and what the app can see it costing. Only you and your admins can open this.'],
};

const initials = (n = '') => n.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

export default function App() {
  const [user, setUser] = useState(
    DEMO ? { id: 'u1', name: 'Mason Holloway', role: 'owner', email: 'mason@hmrichmond.com' } : null
  );
  const [cat, setCat] = useState([]);
  const [route, setRoute] = useState('home');
  // The command bar can land you on a specific record, not just its screen.
  const [openRecord, setOpenRecord] = useState(null);
  const go = (to, id = null) => { setRoute(to); setOpenRecord(id); };
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

  // A link to one of the folded-away screens lands on Settings with that tab open.
  const settingsTab = FOLDED[route] || null;
  const here = settingsTab ? 'settings' : route;

  const entity = here.startsWith('records:') ? cat.find((e) => e.key === here.slice(8)) : null;
  const nav = entity ? 'records' : here;
  const [title, sub] = entity ? [plainName(entity), plainDesc(entity)] : (PAGE[here] || PAGE.home);
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

        {NAV.map(([group, items]) => {
          const mine = items.filter((n) => allowed(n, user.role));
          if (!mine.length) return null;
          return (
            <div key={group} className="nav-group">
              <div className="nav-group-label">{group}</div>
              {mine.map((nn) => (
                <button key={nn.key} className={`nav-item ${nav === nn.key ? 'active' : ''}`}
                        onClick={() => setRoute(nn.key)}>
                  <Icon name={nn.icon} size={19} /> {nn.label}
                  {counts[nn.key] > 0 && <span className="count">{counts[nn.key]}</span>}
                </button>
              ))}
            </div>
          );
        })}

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
          {here === 'home' && <Home go={go} name={user.name} />}
          {here === 'attention' && <Attention />}
          {here === 'radon' && <Radon />}
          {here === 'records' && <RecordsHub entities={cat} go={go} />}
          {here === 'inbox' && <Inbox onCount={setPending} />}
          {here === 'money' && allowed({ min: 'admin' }, user.role) && <Money />}
          {here === 'settings' && allowed({ min: 'office' }, user.role) && (
            <Settings user={user} tab={settingsTab} />
          )}
          {entity && (
            <Records key={entity.key} entity={entity}
                     openId={openRecord} onOpened={() => setOpenRecord(null)} />
          )}
        </div>
      </main>

      <CommandBar entities={cat} go={go} canSeeMoney={allowed({ min: 'admin' }, user.role)} />
    </div>
  );
}
