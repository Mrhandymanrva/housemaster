/**
 * The page the office prints, emails or pins to the wall, and the code on it.
 *
 * Everything here is built from the address the request arrived on, so it
 * points at wherever the app is actually running — a Railway domain today, a
 * custom one later, localhost while someone is testing — with nothing to keep
 * in step by hand. The failure this avoids is the quiet one: a printed code
 * that still scans perfectly and opens an address that moved.
 *
 * Open, deliberately. Somebody who has not got an account yet is exactly who
 * needs this page, and the code on it leads to a login screen.
 */
import express from 'express';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { qrSvg, qrPng, publicOrigin } from '../lib/qr.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const page = readFileSync(
  path.join(__dirname, '..', '..', 'field', 'install', 'index.html'), 'utf8');

const appUrl = (req) => `${publicOrigin(req)}/phone/`;

/**
 * The address is read off request headers, and a header is whatever the caller
 * put in it. Harmless inside a QR code — anyone able to forge one could have
 * printed their own — but written into the page unescaped, a crafted Host
 * header would put script on it.
 */
const escapeHtml = (s) => String(s).replace(/[&<>"']/g,
  (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

const router = express.Router();

// Never cached: the address it encodes is the whole point of it, and a code
// held in a proxy from before a domain moved is worse than a slow page.
router.get('/qr.svg', (req, res) => {
  res.type('image/svg+xml').set('Cache-Control', 'no-cache').send(qrSvg(appUrl(req)));
});

router.get('/qr.png', (req, res) => {
  res.type('image/png').set('Cache-Control', 'no-cache').send(qrPng(appUrl(req), { scale: 10 }));
});

router.get('/', (req, res) => {
  res.type('html').set('Cache-Control', 'no-cache')
    .send(page.replaceAll('{{APP_URL}}', escapeHtml(appUrl(req))));
});

export default router;
