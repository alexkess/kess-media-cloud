// Starter Studio templates. Created once if the tables are empty; edit them in Studio > Setup.
// The contract is a plain-English starting point only. Have it reviewed by your lawyer before use.
import { newToken } from './lib/studio.js';
import { hashPassword } from './lib/auth.js';
import { bookJob, getJob } from './lib/studio.js';

const CONTRACT = `PHOTOGRAPHY AND VIDEO SERVICES AGREEMENT
(Starter template: review with your lawyer before use)

Between {{business_name}}{{business_abn_text}} ("we", "us") and {{client_name}} ("you").

1. The job
{{job_title}} on {{shoot_date}}, {{shoot_time}}, at {{location}}.
Services: {{package}}.
Total: {{total}} including GST.

2. Booking and payments
Your booking is confirmed when you sign this agreement and we receive the first payment shown on your booking page. Later payments are invoiced on the dates shown there. Prices include GST where stated.

3. Changes and cancellations
If you need to change the date, tell us as soon as you can and we will do our best to move the booking. If you cancel more than 30 days before the shoot, payments other than the booking deposit are refunded. Within 30 days of the shoot, payments made are not refundable unless we can rebook the date. If we have to cancel, we will refund everything you have paid or find a suitable replacement with your agreement. Nothing in this agreement limits your rights under the Australian Consumer Law.

4. On the day
Please tell us about any access, safety or permission requirements for the location. If the shoot runs over the booked time, extra time is charged at our standard rate with your approval on the day.

5. Delivery
We deliver edited photos and video within the timeframe in your package, through a private online link. Please download and back up your files within 60 days of delivery.

6. Copyright and use
We own the copyright in the photos and video. You get a licence to use the delivered files for your personal or business purposes as described in your package, including on your website and social media. You may not sell them or enter them in competitions. We may use a small selection in our portfolio and marketing unless you ask us not to in writing.

7. Privacy
We keep your details private and use them only to provide these services.

8. Liability
If something outside our control (illness, extreme weather, equipment failure, accident) stops us delivering all or part of the job, our liability is limited to refunding the amount you have paid for the affected part.

Signed for {{business_name}} by {{owner_name}}.`;

export function ensureStudioDefaults(db) {
  if (!db.get('SELECT 1 FROM packages')) {
    const pk = [
      ['Event photography: half day', 'photo', 'Up to 4 hours of event coverage, edited and delivered in an online gallery.', 120000, ['Up to 4 hours on site', '150+ edited images', 'Online gallery delivery within 7 days', 'Licence for web and social use'], 0],
      ['Event photography: full day', 'photo', 'Up to 8 hours of coverage for conferences and full-day events.', 210000, ['Up to 8 hours on site', '300+ edited images', 'Online gallery delivery within 7 days', 'Same-day highlights (10 images)'], 1],
      ['Headshots: team session', 'photo', 'On-location headshots for up to 10 people.', 95000, ['Portable studio lighting', 'Up to 10 people', '2 retouched images per person', 'Delivered within 5 business days'], 2],
      ['Highlight film (60–90 seconds)', 'video', 'A short edited film for web and social.', 280000, ['Up to 6 hours filming', 'Licensed music', '60–90 second edit plus 1 vertical cut', '2 rounds of changes'], 3],
      ['Video: interview and b-roll', 'video', 'Filmed interviews with supporting footage.', 350000, ['Up to 3 interviews', 'Two-camera setup, lapel mics', '2–3 minute edit', 'Captions included'], 4],
      ['Drone add-on', 'photo_video', 'Aerial photo and video, licensed operator.', 45000, ['CASA-compliant licensed pilot', 'Aerial stills and footage', 'Subject to site approval'], 5],
    ];
    for (const [name, category, description, price, items, sort] of pk) db.run('INSERT INTO packages (name, category, description, price_cents, items, sort) VALUES (?, ?, ?, ?, ?, ?)', name, category, description, price, JSON.stringify(items), sort);
  }
  if (!db.get('SELECT 1 FROM contract_templates')) db.run('INSERT INTO contract_templates (name, body) VALUES (?, ?)', 'Photo and video services agreement', CONTRACT.replace('{{business_abn_text}}', ''));
  if (!db.get('SELECT 1 FROM payment_plans')) {
    db.run('INSERT INTO payment_plans (name, steps) VALUES (?, ?)', '50% deposit, balance 7 days before', JSON.stringify([
      { label: 'Booking deposit (50%)', percent: 50, when: 'accept', due_days: 3 },
      { label: 'Balance (50%)', percent: 50, when: 'before_shoot', days: 14, due_days: 7 },
    ]));
    db.run('INSERT INTO payment_plans (name, steps) VALUES (?, ?)', 'Pay in full on delivery', JSON.stringify([{ label: 'Full payment', percent: 100, when: 'after_shoot', days: 1, due_days: 14 }]));
    db.run('INSERT INTO payment_plans (name, steps) VALUES (?, ?)', '30% deposit, 70% after the shoot', JSON.stringify([
      { label: 'Booking deposit (30%)', percent: 30, when: 'accept', due_days: 3 },
      { label: 'Balance (70%)', percent: 70, when: 'after_shoot', days: 2, due_days: 14 },
    ]));
  }
  if (!db.get('SELECT 1 FROM questionnaires')) db.run('INSERT INTO questionnaires (name, intro, questions) VALUES (?, ?, ?)', 'Pre-shoot questionnaire', 'A few details so the day runs smoothly. You can save and come back.', JSON.stringify([
    { id: 'contact', label: 'Who is our contact on the day (name and mobile)?', type: 'text', required: true },
    { id: 'arrival', label: 'Where should we arrive and park?', type: 'textarea' },
    { id: 'must', label: 'Must-have shots or moments', type: 'textarea', required: true },
    { id: 'people', label: 'Key people we should capture', type: 'textarea' },
    { id: 'usage', label: 'Where will the photos/video be used?', type: 'choice', options: ['Website', 'Social media', 'Print', 'Internal', 'All of the above'] },
    { id: 'consent', label: 'Attendees have been told photography/filming will happen', type: 'checkbox' },
  ]));
  if (!db.get('SELECT 1 FROM workflows')) db.run('INSERT INTO workflows (name, steps) VALUES (?, ?)', 'Standard shoot', JSON.stringify([
    { name: 'Thank you for booking', action: 'email', anchor: 'booking', offset_days: 0, subject: "You're booked: {{job_title}}", body: "Hi {{first_name}},\n\nThanks for booking {{job_title}} on {{shoot_date}}. Your booking page has the agreement, payments and everything else in one place.", attach: 'portal' },
    { name: 'Send the questionnaire', action: 'email', anchor: 'shoot', offset_days: -14, subject: 'A few questions before {{shoot_date}}', body: 'Hi {{first_name}},\n\nTo plan the day, could you fill in a short questionnaire? It takes about five minutes.', attach: 'questionnaire' },
    { name: 'Check the questionnaire and plan the shot list', action: 'task', anchor: 'shoot', offset_days: -7 },
    { name: 'Confirm details with the client', action: 'email', anchor: 'shoot', offset_days: -2, subject: 'See you on {{shoot_date}}', body: 'Hi {{first_name}},\n\nJust confirming we will see you on {{shoot_date}} ({{shoot_time}}) at {{location}}. Reply to this email if anything has changed.', attach: '' },
    { name: 'Pack gear, charge batteries, format cards', action: 'task', anchor: 'shoot', offset_days: -1 },
    { name: 'Back up the cards (two copies)', action: 'task', anchor: 'shoot', offset_days: 0 },
    { name: 'Deliver the files and add the link', action: 'task', anchor: 'shoot', offset_days: 7 },
    { name: 'Ask for a review', action: 'email', anchor: 'shoot', offset_days: 14, subject: 'How did we go?', body: "Hi {{first_name}},\n\nWe hope you love the results. If you have a minute, a short Google review helps us a lot. Thanks again for having us.", attach: '' },
  ]));
}

export function seedStudioDemo(db, { owner }) {
  ensureStudioDefaults(db);
  if (db.get("SELECT 1 FROM users WHERE email = 'georgia@kess.media'")) return;
  const g = db.run("INSERT INTO users (email, name, role, password_hash, send_as_email, send_as_name) VALUES ('georgia@kess.media', 'Georgia (demo)', 'staff', ?, 'georgia@kess.media', 'Georgia')", hashPassword('georgia-demo-2026')).id;
  const plan = db.get('SELECT id FROM payment_plans ORDER BY id LIMIT 1').id;
  const contract = db.get('SELECT id FROM contract_templates ORDER BY id LIMIT 1').id;
  const wf = db.get('SELECT id FROM workflows ORDER BY id LIMIT 1').id;
  const q = db.get('SELECT id FROM questionnaires ORDER BY id LIMIT 1').id;
  const pkg = (n) => db.get('SELECT * FROM packages WHERE name LIKE ?', n + '%');
  const addDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const mkClient = (name, contact, email) => db.run("INSERT INTO clients (name, contact_name, email, status) VALUES (?, ?, ?, 'active')", name, contact, email).id;
  const mkJob = (clientId, f) => {
    const { id } = db.run(`INSERT INTO jobs (client_id, title, category, status, shoot_date, start_time, end_time, location, owner_id, contract_template_id, payment_plan_id, workflow_id, questionnaire_id, token, source, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, clientId, f.title, f.category, f.status || 'quoted', f.date, f.start || null, f.end || null, f.location, f.owner, contract, plan, wf, q, newToken(), f.source || 'referral', f.notes || '');
    f.lines.forEach(([p, optional], i) => db.run('INSERT INTO job_lines (job_id, package_id, description, details, qty, unit_cents, optional, selected, sort) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)', id, p.id, p.name, JSON.parse(p.items).join('\n'), p.price_cents, optional ? 1 : 0, optional ? 0 : 1, i));
    return id;
  };
  const c1 = mkClient('Sydney Arts Collective (demo)', 'Maya Chen', 'maya@artscollective.example');
  mkJob(c1, { title: 'Annual gala: event photography', category: 'photo', date: addDays(40), start: '18:00', end: '23:00', location: 'Carriageworks, Eveleigh', owner: g, lines: [[pkg('Event photography: half day')], [pkg('Drone add-on'), true]], notes: 'Wants candid shots of donors and the auction.' });
  const c2 = mkClient('Harbourside Dental (demo)', 'Dr Tom Reid', 'tom@harbourdental.example');
  const j2 = mkJob(c2, { title: 'Team headshots + clinic video', category: 'photo_video', date: addDays(20), start: '09:00', end: '15:00', location: 'Harbourside Dental, Pyrmont', owner: g, lines: [[pkg('Headshots')], [pkg('Highlight film')]] });
  db.run("INSERT INTO contracts (job_id, title, body, body_hash, status, agency_signer, signed_name, signature, signed_at, signed_ip) SELECT ?, name, body, '', 'signed', 'Georgia, for Kess Media', 'Dr Tom Reid', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', datetime('now','-2 days'), '203.0.113.7' FROM contract_templates WHERE id = ?", j2, contract);
  bookJob(db, getJob(db, j2), { user: owner });
  db.run("UPDATE invoices SET status = 'paid', paid_at = date('now'), paid_via = 'stripe' WHERE job_id = ? AND plan_label LIKE 'Booking%'", j2);
  db.run("INSERT INTO deliveries (job_id, provider, url, label, note) VALUES (?, 'vimeo', 'https://vimeo.com/76979871', 'Clinic film: first cut', 'For review, not final')", j2);
  db.run("INSERT INTO jobs (client_id, title, category, status, shoot_date, location, owner_id, token, source, notes) VALUES (?, 'Product launch video', 'video', 'enquiry', ?, 'Barangaroo', ?, ?, 'website', 'Enquiry from the website\n\nLaunching a new range in March, need a 60s film and socials.')",
    mkClient('Lumen Skincare (demo)', 'Ari Patel', 'ari@lumen.example'), addDays(75), g, newToken());
}
