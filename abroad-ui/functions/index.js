const fs = require('fs');
const path = require('path');
const functions = require('firebase-functions/v1');
const geoip = require('geoip-lite');

const BLOCKED_COUNTRIES = new Set(['US']);

const INDEX_PATH = path.join(__dirname, 'index.html');
let indexHtmlCache = null;
function loadIndexHtml() {
  if (indexHtmlCache !== null) return indexHtmlCache;
  try {
    indexHtmlCache = fs.readFileSync(INDEX_PATH, 'utf8');
  } catch (err) {
    functions.logger.error('Missing functions/index.html — the hosting predeploy step must copy dist/index.html into the functions directory before deploy.', err);
    indexHtmlCache = '';
  }
  return indexHtmlCache;
}

const BLOCKED_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Service unavailable in your region</title>
<style>
  :root { color-scheme: light; }
  html, body { height: 100%; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    background: #F4F1EA;
    color: #1B2A2E;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .card {
    max-width: 480px;
    width: 100%;
    background: #ffffff;
    border: 1px solid rgba(53, 110, 106, 0.15);
    border-radius: 16px;
    padding: 32px;
    box-shadow: 0 8px 24px rgba(53, 110, 106, 0.08);
    text-align: center;
  }
  .badge {
    display: inline-block;
    padding: 4px 10px;
    border-radius: 999px;
    background: rgba(53, 110, 106, 0.08);
    color: #356E6A;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    margin-bottom: 16px;
  }
  h1 {
    font-size: 22px;
    margin: 0 0 12px;
    color: #356E6A;
  }
  p { line-height: 1.5; margin: 0 0 12px; color: #1B2A2E; }
  p.muted { color: #5B6A6E; font-size: 14px; }
  a { color: #356E6A; text-decoration: none; font-weight: 600; }
  a:hover { text-decoration: underline; }
</style>
</head>
<body>
  <main class="card" role="main">
    <span class="badge">451 · Unavailable</span>
    <h1>Abroad is not available in your region</h1>
    <p>We're sorry — access to Abroad is currently restricted in your country.</p>
    <p class="muted">If you believe this is a mistake, please reach out at <a href="https://abroad.finance">abroad.finance</a>.</p>
  </main>
</body>
</html>`;

function getClientIp(req) {
  const fastly = req.get('fastly-client-ip');
  if (fastly) return fastly.trim();
  const xff = req.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.ip || '';
}

function isBlocked(ip) {
  if (!ip) return false;
  const geo = geoip.lookup(ip);
  if (!geo || !geo.country) return false;
  return BLOCKED_COUNTRIES.has(geo.country);
}

exports.geoBlock = functions
  .region('us-central1')
  .runWith({ memory: '256MB', timeoutSeconds: 10 })
  .https.onRequest((req, res) => {
    res.set('Cache-Control', 'private, no-store');
    res.set('Vary', 'Fastly-Client-IP, X-Forwarded-For');

    const ip = getClientIp(req);
    if (isBlocked(ip)) {
      res.status(451).type('html').send(BLOCKED_PAGE);
      return;
    }

    const html = loadIndexHtml();
    if (!html) {
      res.status(500).type('text/plain').send('Application shell missing.');
      return;
    }
    res.status(200).type('html').send(html);
  });
