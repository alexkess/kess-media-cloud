// Daily housekeeping: backups, overdue invoice reminders, monthly client reports, cleanup.
// Each job records when it last ran in job_runs, so restarts don't repeat work.
import { getSettings } from '../db.js';
import { createBackup } from './backup.js';
import { loadInvoice, notify, money, logActivity } from './services.js';
import { prevMonth } from './report.js';

const ran = (db, key) => !!db.get('SELECT 1 FROM job_runs WHERE key = ?', key);
const mark = (db, key) => db.run("INSERT INTO job_runs (key, ran_at) VALUES (?, datetime('now')) ON CONFLICT(key) DO UPDATE SET ran_at = excluded.ran_at", key);

export function overdueReminders(db, today = new Date().toISOString().slice(0, 10)) {
  if (getSettings(db).email_reminders === '0') return [];
  const rows = db.all(`SELECT id FROM invoices WHERE status = 'sent' AND due_date < ?
    AND (reminded_at IS NULL OR reminded_at <= date(?, '-7 days'))`, today, today);
  const out = [];
  for (const { id } of rows) {
    const inv = loadInvoice(db, id);
    const days = Math.round((new Date(today) - new Date(inv.due_date)) / 864e5);
    notify(db, { audience: 'client', client_id: inv.client_id, title: `Reminder: invoice ${inv.number} is ${days} day${days === 1 ? '' : 's'} overdue`, body: `${money(inv.total_cents)} inc GST was due ${inv.due_date}. If you've already paid, thank you and please ignore this.`, link: `#/invoices/${inv.id}` });
    db.run('UPDATE invoices SET reminded_at = ? WHERE id = ?', today, inv.id);
    logActivity(db, { client_id: inv.client_id, action: 'invoice.reminded', detail: `${inv.number}, ${days} days overdue` });
    out.push(inv.number);
  }
  return out;
}

export function monthlyReports(db, month = prevMonth()) {
  if (getSettings(db).email_reports === '0') return [];
  const key = `reports:${month}`;
  if (ran(db, key)) return [];
  const sites = db.all("SELECT id, name, client_id FROM sites WHERE stage IN ('live','care') AND published_version_id IS NOT NULL");
  for (const s of sites) notify(db, { audience: 'client', client_id: s.client_id, title: `Your ${s.name} report for ${new Date(month + '-01T00:00:00Z').toLocaleDateString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' })}`, body: 'Visitors, enquiries, uptime and the work we did this month.', link: `#/sites/${s.id}/report?month=${month}` });
  mark(db, key);
  return sites.map((s) => s.name);
}

export async function runDaily(db, dataDir, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const log = {};
  if (!ran(db, `backup:${day}`) && process.env.BACKUPS !== '0') {
    try { log.backup = await createBackup(db, dataDir); } catch (e) { log.backup = { error: e.message }; notify(db, { audience: 'agency', title: 'Nightly backup failed', body: e.message, link: '#/settings' }); }
    if (log.backup?.offsite?.startsWith?.('failed')) notify(db, { audience: 'agency', title: 'Off-site backup upload failed', body: log.backup.offsite, link: '#/settings' });
    mark(db, `backup:${day}`);
  }
  if (!ran(db, `reminders:${day}`)) { log.reminders = overdueReminders(db, day); mark(db, `reminders:${day}`); }
  log.reports = monthlyReports(db, prevMonth(now));
  db.run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
  db.run('DELETE FROM invites WHERE expires_at < ?', Date.now());
  db.run("DELETE FROM notifications WHERE created_at < datetime('now', '-180 days')");
  db.run("DELETE FROM outbox WHERE created_at < datetime('now', '-90 days')");
  return log;
}

export function startJobs(db, dataDir) {
  const tick = () => runDaily(db, dataDir).catch((e) => console.error('Daily jobs failed:', e));
  setTimeout(tick, 30_000).unref();
  setInterval(tick, 60 * 60_000).unref(); // hourly check; each job runs at most once a day
}
