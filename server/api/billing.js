import { bad, notFound, forbidden, html } from '../lib/http.js';
import { requireAgency, requireOwner, assertClientAccess, isAgency, requireUser } from '../lib/auth.js';
import { j, logActivity, notify, loadInvoice, nextInvoiceNumber, addDays, generateCareInvoices, computeEstimate, clientFacingEstimate, money, kRange } from '../lib/services.js';
import { esc } from '../../shared/sections.js';
import { stripeEnabled, createCheckout, verifyStripeSignature } from '../lib/stripe.js';
import { HttpError } from '../lib/http.js';

export function markInvoicePaid(db, inv, { via, user = null }) {
  if (inv.status === 'paid') return false;
  db.run("UPDATE invoices SET status = 'paid', paid_at = date('now'), paid_via = ? WHERE id = ?", via, inv.id);
  logActivity(db, { user, client_id: inv.client_id, action: 'invoice.paid', detail: `${inv.number}${via === 'stripe' ? ' (paid online)' : ''}` });
  if (via === 'stripe') notify(db, { audience: 'agency', client_id: inv.client_id, title: `${inv.client_name} paid ${inv.number} online`, body: `${money(inv.total_cents)} inc GST`, link: `#/invoices/${inv.id}` });
  return true;
}

function saveItems(db, invoiceId, items) {
  if (!Array.isArray(items)) throw bad('items must be an array');
  db.run('DELETE FROM invoice_items WHERE invoice_id = ?', invoiceId);
  for (const it of items) {
    if (!String(it.description || '').trim()) continue;
    const qty = Number(it.qty ?? 1), unit = Math.round(Number(it.unit_cents));
    if (!Number.isFinite(qty) || !Number.isFinite(unit)) throw bad('Invalid line item amount');
    db.run('INSERT INTO invoice_items (invoice_id, description, qty, unit_cents, site_id, request_id) VALUES (?, ?, ?, ?, ?, ?)', invoiceId, String(it.description).trim(), qty, unit, it.site_id || null, it.request_id || null);
  }
}

export default function register(r) {
  // ----- care plans -----
  r.get('/api/plans', async (ctx) => {
    requireUser(ctx);
    return ctx.db.all('SELECT p.*, (SELECT COUNT(*) FROM sites s WHERE s.plan_id = p.id AND s.stage IN (\'live\',\'care\')) active_sites FROM plans p ORDER BY active DESC, price_cents')
      .map((p) => ({ ...p, features: j(p.features, []), active: !!p.active }));
  });
  r.post('/api/plans', async (ctx) => {
    requireOwner(ctx);
    const b = await ctx.body();
    if (!String(b.name || '').trim()) throw bad('Plan name is required');
    const { id } = ctx.db.run('INSERT INTO plans (name, price_cents, description, features, hours_included) VALUES (?, ?, ?, ?, ?)', b.name.trim(), Math.round(Number(b.price_cents) || 0), b.description || '', JSON.stringify(b.features || []), Number(b.hours_included) || 0);
    return { id };
  });
  r.patch('/api/plans/:id', async (ctx) => {
    requireOwner(ctx);
    const p = ctx.db.get('SELECT * FROM plans WHERE id = ?', Number(ctx.params.id));
    if (!p) throw notFound('Plan not found');
    const b = await ctx.body();
    ctx.db.run('UPDATE plans SET name=?, price_cents=?, description=?, features=?, hours_included=?, active=? WHERE id=?',
      b.name ?? p.name, 'price_cents' in b ? Math.round(Number(b.price_cents) || 0) : p.price_cents, b.description ?? p.description,
      'features' in b ? JSON.stringify(b.features || []) : p.features, 'hours_included' in b ? Number(b.hours_included) || 0 : p.hours_included, 'active' in b ? (b.active ? 1 : 0) : p.active, p.id);
    return { ok: true };
  });

  // Care-plan hours used this month per site (agency view, also shown to client without rates).
  r.get('/api/care-usage', async (ctx) => {
    requireUser(ctx);
    const month = /^\d{4}-\d{2}$/.test(ctx.query.get('month') || '') ? ctx.query.get('month') : new Date().toISOString().slice(0, 7);
    const agency = isAgency(ctx.user);
    const rows = ctx.db.all(`SELECT s.id site_id, s.name site_name, c.name client_name, p.name plan_name, p.hours_included,
      (SELECT COALESCE(SUM(t.hours),0) FROM time_entries t WHERE t.site_id = s.id AND substr(t.day,1,7) = ?) hours_used
      FROM sites s JOIN plans p ON p.id = s.plan_id JOIN clients c ON c.id = s.client_id
      WHERE s.stage IN ('live','care') ${agency ? '' : 'AND s.client_id = ?'} ORDER BY c.name`, month, ...(agency ? [] : [ctx.user.client_id]));
    return { month, rows };
  });

  // ----- invoices -----
  r.get('/api/invoices', async (ctx) => {
    requireUser(ctx);
    const agency = isAgency(ctx.user);
    const conds = [], args = [];
    if (!agency) { conds.push('client_id = ?', "status != 'draft'"); args.push(ctx.user.client_id); }
    else if (ctx.query.get('client_id')) { conds.push('client_id = ?'); args.push(Number(ctx.query.get('client_id'))); }
    const st = ctx.query.get('status');
    if (st) { conds.push('status = ?'); args.push(st); }
    const ids = ctx.db.all(`SELECT id FROM invoices ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''} ORDER BY issue_date DESC, id DESC LIMIT 300`, ...args);
    return ids.map(({ id }) => { const inv = loadInvoice(ctx.db, id); inv.item_count = inv.items.length; delete inv.items; return inv; });
  });

  r.post('/api/invoices', async (ctx) => {
    requireAgency(ctx);
    const b = await ctx.body();
    const clientId = Number(b.client_id);
    if (!ctx.db.get('SELECT 1 FROM clients WHERE id = ?', clientId)) throw bad('Choose a client');
    const s = ctx.settings();
    const issue = b.issue_date || new Date().toISOString().slice(0, 10);
    const id = ctx.db.tx(() => {
      const { id } = ctx.db.run("INSERT INTO invoices (client_id, number, issue_date, due_date, status, notes) VALUES (?, ?, ?, ?, 'draft', ?)", clientId, nextInvoiceNumber(ctx.db), issue, b.due_date || addDays(issue, s.payment_terms_days || 14), b.notes || '');
      saveItems(ctx.db, id, b.items || []);
      return id;
    });
    logActivity(ctx.db, { user: ctx.user, client_id: clientId, action: 'invoice.created', detail: loadInvoice(ctx.db, id).number });
    return loadInvoice(ctx.db, id);
  });

  r.get('/api/invoices/:id', async (ctx) => {
    const inv = loadInvoice(ctx.db, Number(ctx.params.id));
    assertClientAccess(ctx, inv.client_id);
    if (!isAgency(ctx.user) && inv.status === 'draft') throw notFound('Invoice not found');
    return { ...inv, can_pay_online: stripeEnabled() && inv.status === 'sent', bank_details: ctx.settings().bank_details };
  });

  r.patch('/api/invoices/:id', async (ctx) => {
    requireAgency(ctx);
    const inv = loadInvoice(ctx.db, Number(ctx.params.id));
    const b = await ctx.body();
    if (b.status && !['draft', 'sent', 'paid', 'void'].includes(b.status)) throw bad('Invalid status');
    if (inv.status !== 'draft' && b.items) throw bad('Only draft invoices can be edited. Void it and create a new one.');
    ctx.db.tx(() => {
      ctx.db.run('UPDATE invoices SET issue_date=?, due_date=?, notes=?, status=?, paid_at=? WHERE id=?',
        b.issue_date || inv.issue_date, b.due_date || inv.due_date, b.notes ?? inv.notes, b.status || inv.status,
        b.status === 'paid' ? new Date().toISOString().slice(0, 10) : b.status && b.status !== 'paid' ? null : inv.paid_at, inv.id);
      if (b.status === 'paid' && inv.status !== 'paid') ctx.db.run("UPDATE invoices SET paid_via = 'manual' WHERE id = ?", inv.id);
      if (b.items) saveItems(ctx.db, inv.id, b.items);
    });
    if (b.status && b.status !== inv.status) {
      logActivity(ctx.db, { user: ctx.user, client_id: inv.client_id, action: `invoice.${b.status}`, detail: inv.number });
      if (b.status === 'sent') notify(ctx.db, { audience: 'client', client_id: inv.client_id, title: `Invoice ${inv.number} is ready`, body: `Due ${inv.due_date}`, link: `#/invoices/${inv.id}` });
    }
    return loadInvoice(ctx.db, inv.id);
  });

  r.delete('/api/invoices/:id', async (ctx) => {
    requireAgency(ctx);
    const inv = loadInvoice(ctx.db, Number(ctx.params.id));
    if (inv.status !== 'draft') throw bad('Only drafts can be deleted. Void sent invoices instead.');
    ctx.db.run('DELETE FROM invoices WHERE id = ?', inv.id);
    return { ok: true };
  });

  // Online payment via Stripe Checkout (client or agency).
  r.post('/api/invoices/:id/pay', async (ctx) => {
    const inv = loadInvoice(ctx.db, Number(ctx.params.id));
    assertClientAccess(ctx, inv.client_id);
    if (!stripeEnabled()) throw bad('Online payments are not set up yet. Please pay by bank transfer.');
    if (inv.status !== 'sent') throw bad(inv.status === 'paid' ? 'This invoice is already paid' : 'This invoice is not ready to pay');
    if (inv.total_cents < 50) throw bad('Amount too small to pay online');
    const session = await createCheckout(inv, {
      successUrl: `${ctx.baseUrl}/#/invoices/${inv.id}?paid=1`, cancelUrl: `${ctx.baseUrl}/#/invoices/${inv.id}`, agencyName: ctx.settings().agency_name,
    }).catch((e) => { throw new HttpError(502, `Could not start payment: ${e.message}`); });
    ctx.db.run('UPDATE invoices SET stripe_session_id = ? WHERE id = ?', session.id, inv.id);
    return { url: session.url };
  });

  r.post('/api/public/stripe/webhook', async (ctx) => {
    const raw = (await ctx.rawBody(500_000)).toString('utf8');
    if (!verifyStripeSignature(raw, ctx.req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET)) throw new HttpError(400, 'Bad signature');
    const evt = JSON.parse(raw);
    if (evt.type === 'checkout.session.completed' && evt.data?.object?.payment_status === 'paid') {
      const id = Number(evt.data.object.metadata?.invoice_id || evt.data.object.client_reference_id);
      const row = id && ctx.db.get('SELECT id FROM invoices WHERE id = ?', id);
      if (row) {
        const inv = loadInvoice(ctx.db, id);
        if (evt.data.object.amount_total === inv.total_cents) markInvoicePaid(ctx.db, inv, { via: 'stripe' });
        else notify(ctx.db, { audience: 'agency', client_id: inv.client_id, title: `Payment for ${inv.number} did not match the invoice total`, body: `Paid ${money(evt.data.object.amount_total)}, invoice is ${money(inv.total_cents)}. Check Stripe.`, link: `#/invoices/${inv.id}` });
      }
    }
    return { received: true };
  });

  r.post('/api/invoices/generate-care', async (ctx) => {
    requireAgency(ctx);
    const { period } = await ctx.body();
    return { created: generateCareInvoices(ctx.db, { period, user: ctx.user }) };
  });

  // Printable invoice (browser print to PDF), branded.
  r.get('/invoices/:id/print', async (ctx) => {
    const inv = loadInvoice(ctx.db, Number(ctx.params.id));
    assertClientAccess(ctx, inv.client_id);
    if (!isAgency(ctx.user) && inv.status === 'draft') throw notFound();
    const s = ctx.settings();
    const rows = inv.items.map((i) => `<tr><td>${esc(i.description)}</td><td class="n">${i.qty}</td><td class="n">${money(i.unit_cents)}</td><td class="n">${money(Math.round(i.qty * i.unit_cents))}</td></tr>`).join('');
    html(ctx.res, 200, `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><title>${esc(inv.number)} · ${esc(s.agency_name)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Playfair+Display:ital,wght@1,700&display=swap">
<style>@page{size:A4;margin:20mm}body{font:10.5pt/1.5 Inter,system-ui,sans-serif;color:#1a1a1a;max-width:760px;margin:30px auto;padding:0 20px}
header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1E5C34;padding-bottom:18px}h1{font-size:26pt;margin:0}h1 em{font-family:'Playfair Display';color:#1E5C34}
.meta{text-align:right;color:#555}.cols{display:flex;justify-content:space-between;margin:24px 0}.cols h3{font-size:8pt;text-transform:uppercase;letter-spacing:.12em;color:#888;margin:0 0 4px}
table{width:100%;border-collapse:collapse;margin-top:10px}th{text-align:left;border-bottom:1.2pt solid #1E5C34;padding:8px 6px;font-size:9pt}td{padding:8px 6px;border-bottom:.5pt solid #ddd}.n{text-align:right;white-space:nowrap}
.tot{margin-left:auto;width:280px;margin-top:14px}.tot div{display:flex;justify-content:space-between;padding:4px 6px}.tot .grand{border-top:1.2pt solid #1E5C34;font-weight:700;font-size:13pt;color:#1E5C34}
.status{display:inline-block;padding:2px 10px;border-radius:99px;background:#E8EDE6;font-weight:700;font-size:9pt;text-transform:uppercase}.paid{background:#7BBF9A}.void{background:#eee;color:#888}
.pay{background:#E8EDE6;border-radius:8px;padding:14px 18px;margin-top:28px;white-space:pre-line}.noprint{margin:20px 0}@media print{.noprint{display:none}body{margin:0}}</style></head><body>
<div class="noprint"><button onclick="print()">Print or save as PDF</button>${stripeEnabled() && inv.status === 'sent' ? ` <a href="/#/invoices/${inv.id}" style="margin-left:8px">Pay online by card</a>` : ''}</div>
<header><div><h1>Tax <em>invoice</em></h1><div>${esc(s.agency_name)}${s.agency_abn ? ` · ABN ${esc(s.agency_abn)}` : ''}<br>${esc(s.agency_address)}<br>${esc(s.agency_email)}</div></div>
<div class="meta"><strong>${esc(inv.number)}</strong><br>Issued ${esc(inv.issue_date)}<br>Due ${esc(inv.due_date)}<br><span class="status ${esc(inv.status)}">${esc(inv.overdue ? 'overdue' : inv.status)}</span></div></header>
<div class="cols"><div><h3>Bill to</h3><strong>${esc(inv.client_name)}</strong><br>${inv.contact_name ? esc(inv.contact_name) + '<br>' : ''}${inv.client_address ? esc(inv.client_address) + '<br>' : ''}${inv.client_abn ? 'ABN ' + esc(inv.client_abn) : ''}</div>
<div style="text-align:right"><h3>Amount due</h3><strong style="font-size:18pt;color:#1E5C34">${money(inv.status === 'paid' ? 0 : inv.total_cents)}</strong> AUD</div></div>
<table><thead><tr><th>Description</th><th class="n">Qty</th><th class="n">Unit (ex GST)</th><th class="n">Amount</th></tr></thead><tbody>${rows}</tbody></table>
<div class="tot"><div><span>Subtotal</span><span>${money(inv.subtotal_cents)}</span></div><div><span>GST (${Math.round(Number(s.gst_rate) * 100)}%)</span><span>${money(inv.gst_cents)}</span></div><div class="grand"><span>Total</span><span>${money(inv.total_cents)}</span></div></div>
${inv.notes ? `<p>${esc(inv.notes)}</p>` : ''}${s.bank_details ? `<div class="pay"><strong>How to pay</strong>\n${esc(s.bank_details)}\nReference: ${esc(inv.number)}</div>` : ''}
</body></html>`);
  });

  // ----- estimates (proposal ballparks) -----
  r.get('/api/estimates', async (ctx) => {
    requireAgency(ctx);
    return ctx.db.all('SELECT e.id, e.title, e.client_id, c.name client_name, e.updated_at, e.data FROM estimates e LEFT JOIN clients c ON c.id = e.client_id ORDER BY e.updated_at DESC').map((e) => {
      const est = computeEstimate(j(e.data, {}), ctx.settings().internal_rate_cents);
      const { data, ...rest } = e;
      return { ...rest, range: kRange(est.low_cents, est.high_cents) };
    });
  });
  r.post('/api/estimates', async (ctx) => {
    requireAgency(ctx);
    const b = await ctx.body();
    if (!String(b.title || '').trim()) throw bad('Title is required');
    const { id } = ctx.db.run('INSERT INTO estimates (client_id, title, data, created_by) VALUES (?, ?, ?, ?)', b.client_id || null, b.title.trim(), JSON.stringify(b.data || { groups: [] }), ctx.user.id);
    return { id };
  });
  r.get('/api/estimates/:id', async (ctx) => {
    requireAgency(ctx);
    const e = ctx.db.get('SELECT * FROM estimates WHERE id = ?', Number(ctx.params.id));
    if (!e) throw notFound('Estimate not found');
    const data = j(e.data, { groups: [] });
    const computed = computeEstimate(data, ctx.settings().internal_rate_cents);
    const showRate = ctx.user.role === 'owner';
    if (!showRate) delete computed.internal.rate_cents;
    return { ...e, data: showRate ? data : { ...data, rate_cents: undefined }, computed, client_facing: clientFacingEstimate(computed) };
  });
  r.put('/api/estimates/:id', async (ctx) => {
    requireAgency(ctx);
    const e = ctx.db.get('SELECT * FROM estimates WHERE id = ?', Number(ctx.params.id));
    if (!e) throw notFound('Estimate not found');
    const b = await ctx.body();
    const prev = j(e.data, {});
    const data = b.data || prev;
    if (ctx.user.role !== 'owner') data.rate_cents = prev.rate_cents; // staff cannot change rate
    ctx.db.run("UPDATE estimates SET title = ?, client_id = ?, data = ?, updated_at = datetime('now') WHERE id = ?", b.title || e.title, b.client_id ?? e.client_id, JSON.stringify(data), e.id);
    return { ok: true };
  });
  r.delete('/api/estimates/:id', async (ctx) => {
    requireAgency(ctx);
    ctx.db.run('DELETE FROM estimates WHERE id = ?', Number(ctx.params.id));
    return { ok: true };
  });
  // Client-facing summary: ranges only, ex GST, never the rate. Paste into a proposal.
  r.get('/api/estimates/:id/summary', async (ctx) => {
    requireAgency(ctx);
    const e = ctx.db.get('SELECT * FROM estimates WHERE id = ?', Number(ctx.params.id));
    if (!e) throw notFound('Estimate not found');
    const cf = clientFacingEstimate(computeEstimate(j(e.data, {}), ctx.settings().internal_rate_cents));
    const lines = [`${e.title}`, `Ballpark figures, ex GST. All pricing is negotiable and may change depending on the final scope.`, ''];
    for (const g of cf.groups) {
      lines.push(`${g.name}: ${kRange(g.low_cents, g.high_cents)}`);
      for (const i of g.items) lines.push(`  ${i.kind === 'addon' ? '+ (add-on) ' : '- '}${i.name}: ${kRange(i.low_cents, i.high_cents)}${i.note ? ` (${i.note})` : ''}`);
    }
    lines.push('', `Total (core items): ${kRange(cf.low_cents, cf.high_cents)} ex GST`);
    return { text: lines.join('\n'), ...cf };
  });
}
