import { useEffect, useState } from 'react';
import { getToken } from '../lib/api.js';

/**
 * A stored photo.
 *
 * An <img src> cannot carry the bearer token, and putting a token in a URL is
 * how tokens end up in logs and browser history. So the bytes are fetched the
 * same way every other request is, and handed to the tag as an object URL.
 */
export default function Attachment({ id, alt = '', maxWidth = 280 }) {
  const [url, setUrl] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let dead = false;
    let objectUrl = null;

    fetch(`/api/attachments/${id}`, {
      headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
    })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error('That photo is not on file.'))))
      .then((blob) => {
        if (dead) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((e) => !dead && setErr(e.message));

    return () => {
      dead = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);

  if (err) return <span style={{ color: 'var(--text-3)', fontSize: 13 }}>{err}</span>;
  if (!url) return <span className="spinner" style={{ display: 'inline-block' }} />;

  return (
    <a href={url} target="_blank" rel="noreferrer">
      <img src={url} alt={alt} style={{ maxWidth, borderRadius: 8, display: 'block' }} />
    </a>
  );
}
