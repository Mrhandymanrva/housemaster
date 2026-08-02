/** One stroke weight, one grid. Icons are labels, not decoration. */
const S = ({ children, size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

export const Icon = ({ name, size = 16 }) => {
  const p = {
    gauge: <><path d="M12 14v-4" /><circle cx="12" cy="14" r="1" /><path d="M4 18a9 9 0 1 1 16 0" /></>,
    users: <><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0M17 11a3 3 0 1 0-2-5M21 20a5 5 0 0 0-4-4.9" /></>,
    badge: <><circle cx="12" cy="9" r="4" /><path d="M9 12.8 8 21l4-2 4 2-1-8.2" /></>,
    graduation: <><path d="M2 8.5 12 4l10 4.5L12 13z" /><path d="M6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5" /></>,
    rules: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h4" /></>,
    van: <><path d="M3 16V7h11l4 4h3v5" /><circle cx="7.5" cy="17" r="1.8" /><circle cx="17" cy="17" r="1.8" /><path d="M9.3 17h5.9" /></>,
    wrench: <><path d="M15 5a4 4 0 1 0 4 4l-9.5 9.5a2.1 2.1 0 0 1-3-3L16 6" /></>,
    toolbox: <><rect x="3" y="8" width="18" height="12" rx="2" /><path d="M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18" /></>,
    boxes: <><rect x="3" y="9" width="8" height="8" rx="1" /><rect x="13" y="9" width="8" height="8" rx="1" /><rect x="8" y="3" width="8" height="6" rx="1" /></>,
    ledger: <><path d="M5 4h11l3 3v13H5z" /><path d="M8 9h8M8 13h8M8 17h5" /></>,
    store: <><path d="M4 9h16v11H4z" /><path d="M4 9 6 4h12l2 5" /><path d="M9 20v-6h6v6" /></>,
    shield: <><path d="M12 3 20 6v6c0 4.5-3.2 7.7-8 9-4.8-1.3-8-4.5-8-9V6z" /></>,
    alert: <><path d="M12 4 2.5 20h19z" /><path d="M12 10v4M12 17h.01" /></>,
    app: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    doc: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></>,
    home: <><path d="M4 11 12 4l8 7v9H4z" /><path d="M10 20v-6h4v6" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" /></>,
    inbox: <><path d="M3 13h5l1.5 3h5L16 13h5" /><path d="M5 5h14l2 8v6H3v-6z" /></>,
    phone: <><rect x="7" y="2" width="10" height="20" rx="2.5" /><path d="M11 18.5h2" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.2 2.2M17.6 17.6l2.2 2.2M2 12h3M19 12h3M4.2 19.8l2.2-2.2M17.6 6.4l2.2-2.2" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
    table: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 10v10" /></>,
    check: <><path d="m5 13 4 4L19 7" /></>,
    x: <><path d="M6 6l12 12M18 6 6 18" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    left: <><path d="m14 6-6 6 6 6" /></>,
    right: <><path d="m10 6 6 6-6 6" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5.2l3.2 2" /></>,
    logout: <><path d="M15 4h4v16h-4" /><path d="M11 8l-4 4 4 4M7 12h10" /></>,
  }[name] || <circle cx="12" cy="12" r="8" />;
  return <S size={size}>{p}</S>;
};
export default Icon;
