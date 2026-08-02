/** Folds the demo build into one self-contained HTML file. */
import { readFile, writeFile } from 'node:fs/promises';

const dir = new URL('../web/dist-demo/', import.meta.url);
const js = await readFile(new URL('app.js', dir), 'utf8');
let css = '';
try { css = await readFile(new URL('app.css', dir), 'utf8'); } catch { /* inlined by vite */ }

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>HouseMaster Ops — Richmond</title>
<style>${css}</style>
</head>
<body>
<div id="root"></div>
<script>${js}</script>
</body>
</html>`;

await writeFile('/mnt/user-data/outputs/housemaster-ops-preview.html', html);
console.log(`wrote preview (${Math.round(html.length / 1024)} KB)`);
