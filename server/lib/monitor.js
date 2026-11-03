import tls from 'node:tls';
import { notify } from './services.js';

function certExpiry(host) {
  return new Promise((resolve) => {
    const sock = tls.connect({ host, port: 443, servername: host, timeout: 8000 }, () => {
      const c = sock.getPeerCertificate();
      sock.end();
      resolve(c?.valid_to ? new Date(c.valid_to).toISOString().slice(0, 10) : null);
    });
    sock.on('error', () => resolve(null));
    sock.on('timeout', () => { sock.destroy(); resolve(null); });
  });
}

export async function checkSite(db, site) {
  const url = `https://${site.domain}/`;
  const t0 = Date.now();
  let ok = 0, code = null, error = null;
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'KessCloud-Uptime/1.0' } });
    code = r.status; ok = r.ok ? 1 : 0;
    if (!r.ok) error = `HTTP ${r.status}`;
  } catch (e) { error = e.cause?.code || e.name || String(e); }
  const ms = Date.now() - t0;
  const cert = ok ? await certExpiry(site.domain) : null;
  const prev = db.get('SELECT ok FROM checks WHERE site_id = ? ORDER BY id DESC LIMIT 1', site.id);
  db.run('INSERT INTO checks (site_id, ok, status_code, ms, error, cert_expires) VALUES (?, ?, ?, ?, ?, ?)', site.id, ok, code, ms, error, cert);
  if (prev && prev.ok !== ok) {
    notify(db, { audience: 'agency', title: ok ? `${site.name} is back up` : `${site.name} is DOWN`, body: ok ? `${url} responded in ${ms}ms` : `${url}: ${error}`, link: `#/sites/${site.id}` });
  }
  if (cert) {
    const days = (new Date(cert) - Date.now()) / 864e5;
    if (days < 14 && days > 13) notify(db, { audience: 'agency', title: `SSL for ${site.domain} expires in 2 weeks`, body: `Expires ${cert}`, link: `#/sites/${site.id}` });
  }
  return { ok: !!ok, status_code: code, ms, error, cert_expires: cert };
}

export function startMonitor(db, { intervalMin = 5 } = {}) {
  const run = async () => {
    const sites = db.all("SELECT id, name, domain FROM sites WHERE domain IS NOT NULL AND domain != '' AND stage IN ('live','care')");
    for (const s of sites) { try { await checkSite(db, s); } catch {} }
    db.run("DELETE FROM checks WHERE created_at < datetime('now', '-90 days')");
  };
  const t = setInterval(run, intervalMin * 60_000);
  t.unref();
  setTimeout(run, 15_000).unref();
  return () => clearInterval(t);
}

export function uptimeSummary(db, siteId) {
  const r = db.get(`SELECT COUNT(*) n, SUM(ok) up, AVG(CASE WHEN ok THEN ms END) avg_ms FROM checks WHERE site_id = ? AND created_at > datetime('now', '-30 days')`, siteId);
  const last = db.get('SELECT * FROM checks WHERE site_id = ? ORDER BY id DESC LIMIT 1', siteId);
  return { checks: r.n, uptime_pct: r.n ? Math.round((r.up / r.n) * 10000) / 100 : null, avg_ms: r.avg_ms ? Math.round(r.avg_ms) : null, last: last || null };
}
