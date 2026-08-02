import Icon from '../components/Icons.jsx';
import { GROUPS, plainName, plainDesc } from '../lib/plain.js';

/**
 * Instead of fifteen items crowding the sidebar, everything you can look at
 * lives here as a card with a sentence explaining what it holds.
 */
export default function RecordsHub({ entities, go }) {
  const byKey = Object.fromEntries(entities.map((e) => [e.key, e]));
  const placed = new Set(GROUPS.flatMap(([, keys]) => keys));
  const leftover = entities.filter((e) => !placed.has(e.key));

  const groups = [...GROUPS.map(([g, keys]) => [g, keys.map((k) => byKey[k]).filter(Boolean)])];
  if (leftover.length) groups.push(['Everything else', leftover]);

  const Tile = ({ e }) => (
    <button className="tile" onClick={() => go(`records:${e.key}`)}>
      <span className="ico"><Icon name={e.icon} size={20} /></span>
      <span style={{ minWidth: 0 }}>
        <b>{plainName(e)}</b>
        <span>{plainDesc(e)}</span>
      </span>
    </button>
  );

  return (
    <div className="stack">
      {groups.filter(([, list]) => list.length).map(([group, list]) => (
        <div key={group} className="stack" style={{ gap: 12 }}>
          <div className="group-label">{group}</div>
          <div className="tiles">
            {list.map((e) => <Tile key={e.key} e={e} />)}
          </div>
        </div>
      ))}
    </div>
  );
}
