import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, contact_name TEXT, email TEXT, phone TEXT,
  abn TEXT, address TEXT, notes TEXT, status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
  password_hash TEXT, role TEXT NOT NULL CHECK (role IN ('owner','staff','client')),
  client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS invites (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, price_cents INTEGER NOT NULL,
  description TEXT, features TEXT NOT NULL DEFAULT '[]', hours_included REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sites (
  id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, domain TEXT UNIQUE, stage TEXT NOT NULL DEFAULT 'design',
  template TEXT, theme TEXT NOT NULL, settings TEXT NOT NULL DEFAULT '{}',
  plan_id INTEGER REFERENCES plans(id), published_version_id INTEGER,
  client_can_edit INTEGER NOT NULL DEFAULT 1, launch_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pages (
  id INTEGER PRIMARY KEY, site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  slug TEXT NOT NULL, title TEXT NOT NULL, nav_label TEXT, description TEXT, in_nav INTEGER NOT NULL DEFAULT 1,
  sections TEXT NOT NULL DEFAULT '[]', sort INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')), updated_by INTEGER,
  UNIQUE (site_id, slug)
);

CREATE TABLE IF NOT EXISTS versions (
  id INTEGER PRIMARY KEY, site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  number INTEGER NOT NULL, snapshot TEXT NOT NULL, note TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','changes_requested','published','superseded')),
  created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_by INTEGER, reviewed_at TEXT, review_note TEXT, published_at TEXT,
  UNIQUE (site_id, number)
);

CREATE TABLE IF NOT EXISTS deploys (
  id INTEGER PRIMARY KEY, site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  version_id INTEGER REFERENCES versions(id) ON DELETE SET NULL, target TEXT NOT NULL,
  status TEXT NOT NULL, log TEXT, created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  site_id INTEGER REFERENCES sites(id) ON DELETE SET NULL, title TEXT NOT NULL, body TEXT,
  kind TEXT NOT NULL DEFAULT 'change', status TEXT NOT NULL DEFAULT 'new', priority TEXT NOT NULL DEFAULT 'normal',
  estimate_hours REAL, quote_cents INTEGER, quote_status TEXT, billable INTEGER NOT NULL DEFAULT 0,
  assignee_id INTEGER REFERENCES users(id), due_date TEXT,
  created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS request_comments (
  id INTEGER PRIMARY KEY, request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id), body TEXT NOT NULL, internal INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS time_entries (
  id INTEGER PRIMARY KEY, request_id INTEGER REFERENCES requests(id) ON DELETE CASCADE,
  site_id INTEGER REFERENCES sites(id) ON DELETE CASCADE, user_id INTEGER REFERENCES users(id),
  hours REAL NOT NULL, note TEXT, day TEXT NOT NULL DEFAULT (date('now')), created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  number TEXT NOT NULL UNIQUE, issue_date TEXT NOT NULL, due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','paid','void')),
  notes TEXT, period TEXT, paid_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id INTEGER PRIMARY KEY, invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL, qty REAL NOT NULL DEFAULT 1, unit_cents INTEGER NOT NULL, site_id INTEGER,
  request_id INTEGER REFERENCES requests(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS estimates (
  id INTEGER PRIMARY KEY, client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  title TEXT NOT NULL, data TEXT NOT NULL, created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY, site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  page_slug TEXT, data TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pageviews (
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE, day TEXT NOT NULL, path TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (site_id, day, path)
);

CREATE TABLE IF NOT EXISTS referrers (
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE, day TEXT NOT NULL, host TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (site_id, day, host)
);

CREATE TABLE IF NOT EXISTS checks (
  id INTEGER PRIMARY KEY, site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  ok INTEGER NOT NULL, status_code INTEGER, ms INTEGER, error TEXT, cert_expires TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  site_id INTEGER REFERENCES sites(id) ON DELETE SET NULL, filename TEXT NOT NULL, mime TEXT NOT NULL,
  size INTEGER NOT NULL, alt TEXT, uploaded_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  audience TEXT, client_id INTEGER, title TEXT NOT NULL, body TEXT, link TEXT, read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY, user_id INTEGER, client_id INTEGER, site_id INTEGER, action TEXT NOT NULL,
  detail TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY, site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  page_slug TEXT NOT NULL, version TEXT NOT NULL DEFAULT 'draft', kind TEXT NOT NULL DEFAULT 'pin',
  anchor TEXT NOT NULL DEFAULT '{}', shape TEXT NOT NULL DEFAULT '{}', viewport_w INTEGER,
  body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, guest_name TEXT, guest_email TEXT, review_link_id INTEGER,
  request_id INTEGER REFERENCES requests(id) ON DELETE SET NULL,
  resolved_by INTEGER, resolved_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_feedback_site ON feedback(site_id, page_slug, status);

CREATE TABLE IF NOT EXISTS feedback_replies (
  id INTEGER PRIMARY KEY, feedback_id INTEGER NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, guest_name TEXT, body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS review_links (
  id INTEGER PRIMARY KEY, site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE, label TEXT, target TEXT NOT NULL DEFAULT 'draft' CHECK (target IN ('draft','live')),
  created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT, revoked INTEGER NOT NULL DEFAULT 0
);

-- ---------- Studio (photo + video jobs) ----------
CREATE TABLE IF NOT EXISTS packages (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'photo', description TEXT,
  price_cents INTEGER NOT NULL DEFAULT 0, items TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS contract_templates (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, body TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS payment_plans (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, steps TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS workflows (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, steps TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS questionnaires (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, intro TEXT, questions TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'photo', status TEXT NOT NULL DEFAULT 'enquiry',
  shoot_date TEXT, start_time TEXT, end_time TEXT, location TEXT, notes TEXT, source TEXT,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  contract_template_id INTEGER, payment_plan_id INTEGER, workflow_id INTEGER, questionnaire_id INTEGER,
  token TEXT NOT NULL UNIQUE, quote_sent_at TEXT, accepted_at TEXT, booked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, shoot_date);
CREATE TABLE IF NOT EXISTS job_lines (
  id INTEGER PRIMARY KEY, job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  package_id INTEGER, description TEXT NOT NULL, details TEXT, qty REAL NOT NULL DEFAULT 1, unit_cents INTEGER NOT NULL DEFAULT 0,
  optional INTEGER NOT NULL DEFAULT 0, selected INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS contracts (
  id INTEGER PRIMARY KEY, job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  title TEXT NOT NULL, body TEXT NOT NULL, body_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'sent',
  agency_signer TEXT, signed_name TEXT, signature TEXT, signed_at TEXT, signed_ip TEXT, signed_ua TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS job_steps (
  id INTEGER PRIMARY KEY, job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  name TEXT NOT NULL, action TEXT NOT NULL DEFAULT 'task', due_date TEXT, subject TEXT, body TEXT,
  attach TEXT, status TEXT NOT NULL DEFAULT 'pending', done_at TEXT, sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_job_steps_due ON job_steps(status, due_date);
CREATE TABLE IF NOT EXISTS questionnaire_responses (
  id INTEGER PRIMARY KEY, job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  questionnaire_id INTEGER, questions TEXT NOT NULL, answers TEXT NOT NULL DEFAULT '{}',
  submitted_at TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS deliveries (
  id INTEGER PRIMARY KEY, job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, url TEXT NOT NULL, label TEXT, note TEXT, created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS job_events (
  id INTEGER PRIMARY KEY, job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  who TEXT, action TEXT NOT NULL, detail TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY, to_addr TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
  provider TEXT NOT NULL, status TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS job_runs (key TEXT PRIMARY KEY, ran_at TEXT NOT NULL DEFAULT (datetime('now')));

CREATE INDEX IF NOT EXISTS idx_sites_client ON sites(client_id);
CREATE INDEX IF NOT EXISTS idx_requests_client ON requests(client_id, status);
CREATE INDEX IF NOT EXISTS idx_submissions_site ON submissions(site_id, created_at);
CREATE INDEX IF NOT EXISTS idx_checks_site ON checks(site_id, created_at);
CREATE INDEX IF NOT EXISTS idx_activity_client ON activity(client_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications ON notifications(user_id, read);
`;

export function openDb(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  migrate(db);
  return wrap(db);
}

// Additive column migrations for databases created by earlier versions.
const COLUMNS = {
  users: { email_notify: 'INTEGER NOT NULL DEFAULT 1', totp_secret: 'TEXT', totp_pending: 'TEXT', totp_enabled: 'INTEGER NOT NULL DEFAULT 0',
    send_as_email: 'TEXT', send_as_name: 'TEXT', email_signature: 'TEXT', cal_token: 'TEXT' },
  invoices: { stripe_session_id: 'TEXT', reminded_at: 'TEXT', paid_via: 'TEXT',
    job_id: 'INTEGER', owner_id: 'INTEGER', send_on: 'TEXT', public_token: 'TEXT', sent_at: 'TEXT', due_reminded_at: 'TEXT', plan_label: 'TEXT' },
  outbox: { from_addr: 'TEXT', reply_to: 'TEXT' },
};
function migrate(db) {
  for (const [table, cols] of Object.entries(COLUMNS)) {
    const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
    for (const [name, def] of Object.entries(cols)) if (!have.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
  }
}

// Small convenience wrapper: db.all / db.get / db.run / db.tx
function wrap(db) {
  const cache = new Map();
  const stmt = (sql) => {
    let s = cache.get(sql);
    if (!s) { s = db.prepare(sql); cache.set(sql, s); }
    return s;
  };
  const norm = (params) => params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));
  return {
    raw: db,
    all: (sql, ...p) => stmt(sql).all(...norm(p)).map((r) => ({ ...r })),
    get: (sql, ...p) => { const r = stmt(sql).get(...norm(p)); return r ? { ...r } : undefined; },
    run: (sql, ...p) => { const r = stmt(sql).run(...norm(p)); return { id: Number(r.lastInsertRowid), changes: r.changes }; },
    exec: (sql) => db.exec(sql),
    tx(fn) {
      db.exec('BEGIN');
      try { const out = fn(); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    close: () => db.close(),
  };
}

export const DEFAULT_SETTINGS = {
  agency_name: 'Kess Media',
  agency_email: 'hello@kess.media',
  agency_abn: '',
  agency_address: 'Sydney NSW',
  gst_rate: '0.10',
  internal_rate_cents: '17000',
  payment_terms_days: '14',
  invoice_prefix: 'KM-',
  bank_details: '',
  webhook_url: '',
  public_base_url: '',
  email_reports: '1',
  studio_terms_days: '7',
  studio_owner_id: '',
  email_reminders: '1',
};

export function getSettings(db) {
  const out = { ...DEFAULT_SETTINGS };
  for (const r of db.all('SELECT key, value FROM settings')) out[r.key] = r.value;
  return out;
}

export function setSetting(db, key, value) {
  db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, String(value));
}
