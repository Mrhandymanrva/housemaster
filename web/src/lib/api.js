import { DEMO, demoFetch } from './demo.js';

let token = localStorage.getItem('hm_token') || null;
export const getToken = () => token;
export function setToken(t) {
  token = t;
  t ? localStorage.setItem('hm_token', t) : localStorage.removeItem('hm_token');
}

export async function api(path, opts = {}) {
  if (DEMO) return demoFetch(path, opts);
  const res = await fetch(`/api${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts.headers,
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
