// Monthly website report per site: traffic, enquiries, uptime, work done. Printable, client-safe.
import { getSettings } from '../db.js';
import { esc } from '../../shared/sections.js';

const monthRange = (month) => {
  const [y, m] = month.split('-').map(Number);
  const start = `${month}-01`;
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { start, end, days: Number(end.slice(8)) };
};
export const prevMonth = (d = new Date()) => { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)); return x.toISOString().slice(0, 7); };
const label = (month) => new Date(month + '-01T00:00:00Z').toLocaleDateString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export function siteReport(db, siteId, month) {
  const { start, end, days } = monthRange(month);
  const [py, pm] = month.split('-').map(Number);
  const prev = new Date(Date.UTC(py, pm - 2, 1)).toISOString().slice(0, 7);
  const pr = monthRange(prev);
  const site = db.get('SELECT s.*, c.name client_name, p.name plan_name, p.hours_included FROM sites s JOIN clients c ON c.id = s.client_id LEFT JOIN plans p ON p.id = s.plan_id WHERE s.id = ?', siteId);
  const sum = (a, b) => db.get('SELECT COALESCE(SUM(views),0) n FROM pageviews WHERE site_id = ? AND day BETWEEN ? AND ?', siteId, a, b).n;
  const views = sum(start, end), prevViews = sum(pr.start, pr.end);
  const daily = new Map(db.all('SELECT day, SUM(views) v FROM pageviews WHERE site_id = ? AND day BETWEEN ? AND ? GROUP BY day', siteId, start, end).map((r) => [r.day, r.v]));
  const series = Array.from({ length: days }, (_, i) => { const d = `${month}-${String(i + 1).padStart(2, '0')}`; return { day: d, views: daily.get(d) || 0 }; });
  const pages = db.all('SELECT path, SUM(views) views FROM pageviews WHERE site_id = ? AND day BETWEEN ? AND ? GROUP BY path ORDER BY views DESC LIMIT 8', siteId, start, end);
  const refs = db.all('SELECT host, SUM(views) views FROM referrers WHERE site_id = ? AND day BETWEEN ? AND ? GROUP BY host ORDER BY views DESC LIMIT 6', siteId, start, end);
  const leadCount = (a, b) => db.get("SELECT COUNT(*) n FROM submissions WHERE site_id = ? AND status != 'spam' AND date(created_at) BETWEEN ? AND ?", siteId, a, b).n;
  const leads = leadCount(start, end), prevLeads = leadCount(pr.start, pr.end);
  const up = db.get('SELECT COUNT(*) n, SUM(ok) up, AVG(CASE WHEN ok THEN ms END) ms FROM checks WHERE site_id = ? AND date(created_at) BETWEEN ? AND ?', siteId, start, end);
  const done = db.all("SELECT id, title FROM requests WHERE site_id = ? AND status IN ('done','closed') AND date(updated_at) BETWEEN ? AND ? ORDER BY updated_at", siteId, start, end);
  const published = db.all('SELECT number, note, published_at FROM versions WHERE site_id = ? AND published_at IS NOT NULL AND date(published_at) BETWEEN ? AND ? ORDER BY number', siteId, start, end);
  const hours = db.get('SELECT COALESCE(SUM(hours),0) h FROM time_entries WHERE site_id = ? AND day BETWEEN ? AND ?', siteId, start, end).h;
  return {
    site: { id: site.id, name: site.name, domain: site.domain, client_name: site.client_name, plan_name: site.plan_name, hours_included: site.hours_included || 0 },
    month, label: label(month), views, prev_views: prevViews, leads, prev_leads: prevLeads, series, pages, referrers: refs,
    uptime_pct: up.n ? Math.round((up.up / up.n) * 10000) / 100 : null, avg_ms: up.ms ? Math.round(up.ms) : null,
    requests_done: done, versions_published: published, hours_used: hours,
  };
}

const change = (now, before) => {
  if (!before) return now ? 'new this month' : '';
  const pct = Math.round(((now - before) / before) * 100);
  return `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct)}% on last month`;
};

export function reportHtml(db, r) {
  const s = getSettings(db);
  const max = Math.max(1, ...r.series.map((d) => d.views));
  const bars = r.series.map((d) => `<div title="${d.day}: ${d.views}" style="height:${Math.max(2, (d.views / max) * 100)}%"></div>`).join('');
  const list = (rows, k) => rows.length ? rows.map((x) => `<tr><td>${esc(x[k])}</td><td class="n">${x.views.toLocaleString()}</td></tr>`).join('') : '<tr><td class="muted">No data</td><td></td></tr>';
  return `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(r.site.name)} · ${esc(r.label)} report</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Playfair+Display:ital,wght@1,700&display=swap">
<style>@page{size:A4;margin:16mm}body{font:10.5pt/1.5 Inter,system-ui,sans-serif;color:#1a1a1a;max-width:820px;margin:24px auto;padding:0 20px}
.hero{background:#1a1a1a;color:#F2EDE6;border-radius:14px;padding:26px 28px;margin-bottom:18px}.hero small{color:#7BBF9A;font-weight:700;letter-spacing:.12em;text-transform:uppercase;font-size:8pt}
h1{font-size:24pt;margin:6px 0 4px}h1 em,h2 em{font-family:'Playfair Display',serif;color:#7BBF9A}h2{font-size:13pt;margin:22px 0 8px}h2 em{color:#1E5C34}
.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.tile{border:1px solid #e3e0da;border-radius:10px;padding:12px 14px}.tile b{display:block;font-size:20pt}.tile span{color:#777;font-size:8.5pt}
.bars{display:flex;align-items:flex-end;gap:2px;height:110px;border-bottom:1px solid #ddd}.bars div{flex:1;background:#7BBF9A;border-radius:2px 2px 0 0}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:18px}table{width:100%;border-collapse:collapse}td{padding:5px 4px;border-bottom:1px solid #eee}.n{text-align:right}.muted{color:#888}
ul{padding-left:18px;margin:4px 0}.foot{margin-top:28px;color:#888;font-size:8.5pt;border-top:1px solid #eee;padding-top:10px}.noprint{margin-bottom:14px}@media print{.noprint{display:none}body{margin:0}}
@media(max-width:640px){.tiles,.cols{grid-template-columns:1fr 1fr}}</style></head><body>
<div class="noprint"><button onclick="print()">Print or save as PDF</button></div>
<div class="hero"><small>${esc(s.agency_name)} · monthly website report</small><h1>${esc(r.site.name)}, <em>${esc(r.label)}.</em></h1><div>${esc(r.site.domain || '')}${r.site.plan_name ? ` · ${esc(r.site.plan_name)} care plan` : ''}</div></div>
<div class="tiles"><div class="tile"><span>Page views</span><b>${r.views.toLocaleString()}</b><span>${change(r.views, r.prev_views)}</span></div>
<div class="tile"><span>Enquiries</span><b>${r.leads}</b><span>${change(r.leads, r.prev_leads)}</span></div>
<div class="tile"><span>Uptime</span><b>${r.uptime_pct != null ? r.uptime_pct + '%' : '—'}</b><span>${r.avg_ms ? `${r.avg_ms} ms average response` : 'monitoring needs a domain'}</span></div>
<div class="tile"><span>Care hours used</span><b>${r.hours_used}</b><span>${r.site.hours_included ? `of ${r.site.hours_included} h included` : 'this month'}</span></div></div>
<h2>Visits <em>per day</em></h2><div class="bars">${bars}</div>
<div class="cols"><div><h2>Top <em>pages</em></h2><table>${list(r.pages, 'path')}</table></div><div><h2>Where visitors <em>came from</em></h2><table>${list(r.referrers, 'host')}</table></div></div>
<h2>Work <em>done</em></h2>${r.requests_done.length || r.versions_published.length ? `<ul>${r.versions_published.map((v) => `<li>Published version ${v.number}${v.note ? `: ${esc(v.note)}` : ''}</li>`).join('')}${r.requests_done.map((q) => `<li>${esc(q.title)}</li>`).join('')}</ul>` : '<p class="muted">Monitoring, backups and security updates. No change requests this month.</p>'}
<div class="foot">Visitor numbers come from privacy-friendly counting (no cookies), so they can be lower than tools that track individuals. Questions? ${esc(s.agency_email)}</div></body></html>`;
}
