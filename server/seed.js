// Demo data so the console and portal have something to show.
// Usage: node server/seed.js   (adds demo data to the configured DB)
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { hashPassword } from './lib/auth.js';
import { createSiteFromTemplate } from './api/sites.js';
import { createVersion, publishVersion, nextInvoiceNumber, addDays } from './lib/services.js';

export function ensurePlans(db) {
  if (db.get('SELECT COUNT(*) n FROM plans').n) return;
  // Placeholder prices: set your real care plan prices in Billing > Care plans.
  const plans = [
    ['Essential care', 9900, 'Hosting, SSL, backups, uptime monitoring and security updates.', ['Managed hosting + SSL', 'Daily backups', 'Uptime + SSL monitoring', 'Security updates', 'Client portal + enquiry inbox'], 0.5],
    ['Growth care', 24900, 'Everything in Essential plus monthly content changes and a performance report.', ['Everything in Essential', '2 hours of changes each month', 'Monthly analytics report', 'SEO health checks'], 2],
    ['Partner care', 59900, 'A retained web partner: priority support, ongoing improvements and quarterly strategy.', ['Everything in Growth', '6 hours of changes each month', 'Priority response (same day)', 'Quarterly strategy session'], 6],
  ];
  for (const [name, price, desc, features, hours] of plans) db.run('INSERT INTO plans (name, price_cents, description, features, hours_included) VALUES (?, ?, ?, ?, ?)', name, price, desc, JSON.stringify(features), hours);
}

export function seedDemo(db, { ownerEmail = 'alex@kess.media', ownerPassword = 'kessmedia-demo-2026', clientPassword = 'client-demo-2026' } = {}) {
  ensurePlans(db);
  let owner = db.get("SELECT * FROM users WHERE role = 'owner' LIMIT 1");
  if (!owner) {
    db.run("INSERT INTO users (email, name, role, password_hash) VALUES (?, 'Alex Kess', 'owner', ?)", ownerEmail, hashPassword(ownerPassword));
    owner = db.get("SELECT * FROM users WHERE role = 'owner' LIMIT 1");
  }
  if (db.get("SELECT 1 FROM clients WHERE name = 'Harbour Physio (demo)'")) return { owner };
  if (!db.get("SELECT 1 FROM settings WHERE key = 'bank_details'")) db.run("INSERT INTO settings (key, value) VALUES ('bank_details', 'Demo only: BSB 000-000, Account 0000 0000, Name: Kess Media')");
  const plan = (n) => db.get('SELECT id FROM plans WHERE name = ?', n)?.id;

  const c1 = db.run("INSERT INTO clients (name, contact_name, email, phone, address, status, notes) VALUES ('Harbour Physio (demo)', 'Sam Lee', 'sam@harbourphysio.example', '02 9000 1234', 'Balmain NSW', 'active', 'Demo client. Prefers email, not calls.')").id;
  const c2 = db.run("INSERT INTO clients (name, contact_name, email, status, notes) VALUES ('Westside Community Care (demo)', 'Priya Nair', 'priya@westside.example', 'active', 'Demo not-for-profit. Board approves spend over $5k.')").id;
  const c3 = db.run("INSERT INTO clients (name, contact_name, email, status) VALUES ('Lumen Studio (demo)', 'Jo Park', 'jo@lumen.example', 'lead')").id;

  db.run("INSERT INTO users (email, name, role, client_id, password_hash) VALUES ('sam@harbourphysio.example', 'Sam Lee', 'client', ?, ?)", c1, hashPassword(clientPassword));
  const clientUser = db.get("SELECT * FROM users WHERE email = 'sam@harbourphysio.example'");

  const s1 = createSiteFromTemplate(db, { client_id: c1, name: 'Harbour Physio', template: 'service', domain: 'harbourphysio.example', plan_id: plan('Growth care'), user: owner });
  // Make the demo site a bit more real.
  const home = db.get("SELECT * FROM pages WHERE site_id = ? AND slug = ''", s1);
  const sections = JSON.parse(home.sections);
  Object.assign(sections[0], { eyebrow: 'Balmain physiotherapy', heading: 'Move better,', accent: 'feel stronger.', text: 'Hands-on physio, rehab and Pilates for the inner west. Same-week appointments.', image: 'https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=1400&q=70', imageAlt: 'Physiotherapist working with a patient', ctaLabel: 'Book an appointment' });
  Object.assign(sections[1], { heading: 'How we', accent: 'help', items: [
    { title: 'Sports injuries', text: 'Assessment and a clear plan to get you back to training.' },
    { title: 'Back and neck pain', text: 'Hands-on treatment plus exercises that fit your day.' },
    { title: 'Clinical Pilates', text: 'Small classes, run by physios, for strength and control.' }] });
  db.run('UPDATE pages SET sections = ? WHERE id = ?', JSON.stringify(sections), home.id);
  db.run('UPDATE sites SET settings = ? WHERE id = ?', JSON.stringify({ lang: 'en-AU', tagline: 'Physiotherapy in Balmain', description: 'Harbour Physio offers physiotherapy, rehab and clinical Pilates in Balmain, Sydney. Same-week appointments, Medicare and health fund rebates available.', email: 'hello@harbourphysio.example', phone: '02 9000 1234', address: 'Darling St, Balmain NSW', autoPublishOnApproval: true }), s1);
  const v1 = createVersion(db, { siteId: s1, user: owner, note: 'Launch', status: 'approved' });
  publishVersion(db, { siteId: s1, versionId: v1.id, user: owner });
  db.run("UPDATE sites SET stage = 'care' WHERE id = ?", s1);
  // a pending version for the client to approve
  db.run("UPDATE pages SET title = 'About us' WHERE site_id = ? AND slug = 'about'", s1);
  createVersion(db, { siteId: s1, user: owner, note: 'New About page copy and team photo', status: 'pending' });

  const s2 = createSiteFromTemplate(db, { client_id: c2, name: 'Westside Community Care', template: 'nonprofit', plan_id: plan('Essential care'), user: owner, stage: 'build' });
  createSiteFromTemplate(db, { client_id: c3, name: 'Lumen Studio', template: 'portfolio', user: owner, stage: 'proposal' });

  // analytics + leads for the live site (last 30 days)
  for (let i = 29; i >= 0; i--) {
    const day = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
    const base = 30 + Math.round(20 * Math.sin(i / 3) + (30 - i));
    for (const [path, share] of [['/', 0.55], ['/services', 0.2], ['/about', 0.12], ['/contact', 0.13]]) db.run('INSERT INTO pageviews (site_id, day, path, views) VALUES (?, ?, ?, ?)', s1, day, path, Math.max(1, Math.round(base * share)));
    db.run('INSERT INTO referrers (site_id, day, host, views) VALUES (?, ?, ?, ?)', s1, day, 'www.google.com', Math.round(base * 0.4));
    if (i % 4 === 0) db.run('INSERT INTO referrers (site_id, day, host, views) VALUES (?, ?, ?, ?)', s1, day, 'www.instagram.com', 3);
  }
  const leads = [['Mia Chen', 'mia@example.com', 'Do you treat running injuries? Looking for an appointment next week.'], ['Tom Brady', 'tom@example.com', 'Is clinical Pilates covered by my health fund?'], ['Ana Lopes', 'ana@example.com', 'Can I book for my dad, he has back pain after surgery?']];
  leads.forEach(([name, email, message], i) => db.run("INSERT INTO submissions (site_id, page_slug, data, status, created_at) VALUES (?, 'contact', ?, ?, datetime('now', ?))", s1, JSON.stringify({ name, email, message }), i === 2 ? 'read' : 'new', `-${i * 2} days`));

  // requests
  const r1 = db.run("INSERT INTO requests (client_id, site_id, title, body, kind, status, priority, created_by) VALUES (?, ?, 'Add Saturday hours to the footer', 'We now open Saturdays 8am to 12pm.', 'content', 'new', 'normal', ?)", c1, s1, clientUser.id).id;
  const r2 = db.run("INSERT INTO requests (client_id, site_id, title, body, kind, status, priority, estimate_hours, quote_cents, quote_status, billable, created_by) VALUES (?, ?, 'Online booking integration', 'Can we connect Cliniko so people book from the site?', 'new_feature', 'quoted', 'high', 6, 95000, 'pending', 1, ?)", c1, s1, clientUser.id).id;
  db.run("INSERT INTO request_comments (request_id, user_id, body) VALUES (?, ?, 'Yes. Cliniko has an embeddable booking widget. Quote attached: $950 ex GST, about a week.')", r2, owner.id);
  db.run("INSERT INTO request_comments (request_id, user_id, body, internal) VALUES (?, ?, 'Check their Cliniko plan supports the widget.', 1)", r2, owner.id);
  db.run("INSERT INTO time_entries (request_id, site_id, user_id, hours, note) VALUES (?, ?, ?, 0.5, 'Scoped Cliniko widget')", r2, s1, owner.id);
  db.run("INSERT INTO requests (client_id, site_id, title, body, kind, status, priority, created_by) VALUES (?, ?, 'Program page photos', 'Need photos for the three programs. Can Kess shoot these?', 'content', 'in_progress', 'normal', ?)", c2, s2, owner.id);
  void r1;

  // invoices
  const today = new Date().toISOString().slice(0, 10);
  const i1 = db.run("INSERT INTO invoices (client_id, number, issue_date, due_date, status, notes) VALUES (?, ?, ?, ?, 'paid', 'Website build, final 50%')", c1, nextInvoiceNumber(db), addDays(today, -40), addDays(today, -26)).id;
  db.run("INSERT INTO invoice_items (invoice_id, description, qty, unit_cents) VALUES (?, 'Harbour Physio website build (Astro + Sanity), final 50%', 1, 650000)", i1);
  db.run("UPDATE invoices SET paid_at = ? WHERE id = ?", addDays(today, -30), i1);
  const i2 = db.run("INSERT INTO invoices (client_id, number, issue_date, due_date, status, notes) VALUES (?, ?, ?, ?, 'sent', 'Hosting and care')", c1, nextInvoiceNumber(db), addDays(today, -20), addDays(today, -6)).id;
  db.run("INSERT INTO invoice_items (invoice_id, description, qty, unit_cents) VALUES (?, 'Growth care plan: Harbour Physio', 1, 24900)", i2);
  const i3 = db.run("INSERT INTO invoices (client_id, number, issue_date, due_date, status, notes) VALUES (?, ?, ?, ?, 'sent', 'Deposit')", c2, nextInvoiceNumber(db), addDays(today, -3), addDays(today, 11)).id;
  db.run("INSERT INTO invoice_items (invoice_id, description, qty, unit_cents) VALUES (?, 'Westside Community Care website, 50% deposit', 1, 480000)", i3);

  // a sample estimate in the Kess proposal shape
  db.run('INSERT INTO estimates (client_id, title, data, created_by) VALUES (?, ?, ?, ?)', c3, 'Lumen Studio portfolio site', JSON.stringify({
    discount_pct: 0,
    groups: [
      { name: 'Discovery and design', items: [{ name: 'Discovery workshop + sitemap', hours_low: 4, hours_high: 6 }, { name: 'Design (home + 3 templates)', hours_low: 14, hours_high: 20 }] },
      { name: 'Build (Astro + Sanity)', items: [{ name: 'Build and CMS setup', hours_low: 24, hours_high: 32 }, { name: 'Content load (up to 30 projects)', hours_low: 6, hours_high: 10 }, { name: 'Accessibility + speed pass', hours_low: 4, hours_high: 6 }] },
      { name: 'Add-ons', items: [{ name: 'Portfolio photography half day', hours_low: 5, hours_high: 6, kind: 'addon' }, { name: 'Online print shop (Shopify Lite)', hours_low: 10, hours_high: 16, kind: 'addon' }] },
    ],
  }), owner.id);

  db.run("INSERT INTO activity (user_id, client_id, site_id, action, detail) VALUES (?, ?, ?, 'demo.seeded', 'Demo data loaded')", owner.id, c1, s1);
  return { owner, clientUser };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const db = openDb(process.env.DB_FILE || join(root, 'data', 'kess-cloud.db'));
  seedDemo(db, { ownerEmail: process.env.KESS_OWNER_EMAIL || 'alex@kess.media', ownerPassword: process.env.KESS_OWNER_PASSWORD || 'kessmedia-demo-2026' });
  console.log('Demo data loaded.\n  Agency: alex@kess.media / kessmedia-demo-2026 (unless KESS_OWNER_* set)\n  Client: sam@harbourphysio.example / client-demo-2026');
}
