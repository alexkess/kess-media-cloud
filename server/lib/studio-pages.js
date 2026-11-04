// Server-rendered client pages for Studio: booking page (/j/:token), invoice (/i/:token), enquiry form (/enquiry).
// No login: access is by unguessable token. All user content is escaped.
import { getSettings } from '../db.js';
import { esc } from '../../shared/sections.js';
import { j, money, loadInvoice, gstRate } from './services.js';
import { jobLines, jobTotals, planSchedule, PROVIDER_LABELS, embedUrl } from './studio.js';
import { stripeEnabled } from './stripe.js';

const dmy = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : 'TBC');
const longDate = (d) => (d ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : 'Date to be confirmed');
const nl2br = (s) => esc(s).replace(/\n/g, '<br>');

const CSS = `:root{--ch:#1a1a1a;--iv:#F2EDE6;--sage:#E8EDE6;--sd:#D0D9CE;--forest:#1E5C34;--mint:#7BBF9A;--muted:#6f6f6f;--line:#E3E0DA}
*{box-sizing:border-box}body{margin:0;font:15px/1.6 Inter,system-ui,-apple-system,sans-serif;color:var(--ch);background:#F6F4F0;-webkit-font-smoothing:antialiased}
a{color:var(--forest)}header.top{background:var(--ch);color:var(--iv);padding:18px 0}header.top .w{display:flex;justify-content:space-between;align-items:center}
.brand{font-weight:800;letter-spacing:.06em;color:#f6f6f6;text-decoration:none}.brand span{color:var(--mint)}
.w{max-width:860px;margin:0 auto;padding:0 18px}.hero{background:var(--ch);color:var(--iv);padding:34px 0 46px}
.hero h1{font-size:clamp(26px,5vw,38px);line-height:1.15;margin:6px 0 10px}.hero h1 em,h2 em{font-family:'Playfair Display',Georgia,serif;font-style:italic;color:var(--mint)}h2 em{color:var(--forest)}
.eyebrow{color:var(--mint);text-transform:uppercase;letter-spacing:.14em;font-size:12px;font-weight:700}
.facts{display:flex;flex-wrap:wrap;gap:8px 22px;color:#cfcfcf;font-size:14px}.facts b{color:#fff;font-weight:600}
.steps{display:flex;gap:6px;margin:-22px 0 22px;flex-wrap:wrap}.steps span{background:#fff;border:1px solid var(--line);border-radius:99px;padding:5px 12px;font-size:12.5px;font-weight:600;color:var(--muted)}
.steps span.done{background:var(--sage);color:var(--forest);border-color:var(--sd)}.steps span.now{background:var(--forest);color:#fff;border-color:var(--forest)}
.card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:22px;margin-bottom:18px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
h2{font-size:20px;margin:0 0 12px}h3{font-size:15px;margin:16px 0 6px}
table{width:100%;border-collapse:collapse}td,th{padding:10px 6px;border-bottom:1px solid #eee;text-align:left;vertical-align:top}th{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.n{text-align:right;white-space:nowrap}.muted{color:var(--muted)}.small{font-size:13px}.details{color:var(--muted);font-size:13px;white-space:pre-line}
.tot td{border:0;padding:4px 6px}.tot .grand td{font-size:18px;font-weight:800;color:var(--forest);border-top:2px solid var(--forest);padding-top:8px}
.btn{display:inline-block;background:var(--forest);color:#fff;border:0;border-radius:99px;padding:13px 26px;font:600 15px Inter,system-ui;cursor:pointer;text-decoration:none}
.btn:disabled{opacity:.5;cursor:default}.btn.mint{background:var(--mint);color:var(--ch)}.btn.ghost{background:#fff;color:var(--ch);border:1px solid var(--line)}.btn.sm{padding:8px 16px;font-size:13px}
.contract{white-space:pre-wrap;background:#FAF9F6;border:1px solid var(--line);border-radius:10px;padding:18px;max-height:420px;overflow:auto;font-size:14px}
canvas.sig{width:100%;height:170px;border:2px dashed #c9c4bb;border-radius:10px;background:#fff;touch-action:none;cursor:crosshair}
label.f{display:grid;gap:5px;font-weight:600;font-size:14px;margin-bottom:12px}input.i,textarea.i,select.i{font:15px Inter,system-ui;padding:11px 12px;border:1px solid #d3cec6;border-radius:9px;width:100%;background:#fff}
.check{display:flex;gap:10px;align-items:flex-start;font-size:14px;margin:12px 0}
.pill{display:inline-block;padding:2px 10px;border-radius:99px;font-size:12px;font-weight:700;background:var(--sage);color:var(--forest)}.pill.warn{background:#FFF4D6;color:#9A6700}.pill.grey{background:#eee;color:#555}.pill.bad{background:#FCE8E6;color:#B3261E}
.callout{background:var(--sage);border-radius:12px;padding:16px 18px}.callout.dark{background:var(--ch);color:var(--iv)}
.files{display:grid;gap:14px}.file{border:1px solid var(--line);border-radius:12px;padding:16px;display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap}
.embed{position:relative;padding-top:56.25%;border-radius:10px;overflow:hidden;background:#000;margin-top:10px;width:100%}.embed iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.msg{min-height:1.4em;font-weight:600;margin-top:8px}.msg.err{color:#B3261E}.sigimg{max-width:280px;border-bottom:1px solid #999}
footer.ft{color:var(--muted);font-size:12.5px;text-align:center;padding:26px 18px 40px}.hp{position:absolute;left:-5000px}
@media print{header.top,.steps,.btn,form,.noprint{display:none!important}body{background:#fff}.card{border:0;box-shadow:none}}`;

function layout(db, { title, body, script = '' }) {
  const s = getSettings(db);
  return `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>${esc(title)} · ${esc(s.agency_name)}</title><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Playfair+Display:ital,wght@1,700&display=swap"><style>${CSS}</style></head>
<body><header class="top"><div class="w"><a class="brand" href="${esc(s.public_base_url || '#')}"><span>›</span> ${esc(s.agency_name.toUpperCase())}</a><span class="small" style="color:#aaa">${esc(s.agency_email)}</span></div></header>
${body}<footer class="ft">${esc(s.agency_name)}${s.agency_abn ? ` · ABN ${esc(s.agency_abn)}` : ''} · ${esc(s.agency_address)} · <a href="mailto:${esc(s.agency_email)}">${esc(s.agency_email)}</a></footer>
<script>${script}</script></body></html>`;
}

// Small shared client script: POST JSON and show messages.
const POST_JS = `async function post(url, body){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Something went wrong');return d}
function say(el,t,err){el.textContent=t;el.className='msg'+(err?' err':'')}`;

const SIG_JS = `function sigPad(c){const x=c.getContext('2d');let down=false,drawn=false,last=null;function fit(){const r=c.getBoundingClientRect(),d=devicePixelRatio||1;c.width=r.width*d;c.height=r.height*d;x.scale(d,d);x.lineWidth=2.4;x.lineCap='round';x.lineJoin='round';x.strokeStyle='#1a1a1a'}fit();
function p(e){const r=c.getBoundingClientRect();return[e.clientX-r.left,e.clientY-r.top]}
c.addEventListener('pointerdown',e=>{down=true;last=p(e);c.setPointerCapture(e.pointerId)});c.addEventListener('pointermove',e=>{if(!down)return;const q=p(e);x.beginPath();x.moveTo(last[0],last[1]);x.lineTo(q[0],q[1]);x.stroke();last=q;drawn=true});
['pointerup','pointercancel'].forEach(t=>c.addEventListener(t,()=>{down=false}));return{clear(){x.clearRect(0,0,c.width,c.height);drawn=false},empty(){return!drawn},data(){return c.toDataURL('image/png')}}}`;

function statusSteps(job, contract, invoices) {
  const booked = ['booked', 'shot', 'editing', 'delivered', 'complete'].includes(job.status);
  const depositPaid = invoices.some((i) => i.status === 'paid');
  const steps = [['Quote', true], ['Agreement', !contract || contract.status === 'signed'], ['Booked', booked], ['Deposit', depositPaid || (booked && !invoices.length)], ['Shoot day', ['shot', 'editing', 'delivered', 'complete'].includes(job.status)], ['Your files', ['delivered', 'complete'].includes(job.status)]];
  if (!contract) steps.splice(1, 1);
  const firstOpen = steps.findIndex(([, d]) => !d);
  return `<div class="steps">${steps.map(([l, d], i) => `<span class="${d ? 'done' : i === firstOpen ? 'now' : ''}">${d ? '✓ ' : ''}${esc(l)}</span>`).join('')}</div>`;
}

export function jobPage(db, job, { baseUrl }) {
  const client = db.get('SELECT * FROM clients WHERE id = ?', job.client_id);
  const owner = job.owner_id ? db.get('SELECT name, email, send_as_email, send_as_name FROM users WHERE id = ?', job.owner_id) : null;
  const ownerEmail = owner?.send_as_email || owner?.email || getSettings(db).agency_email;
  const lines = jobLines(db, job.id);
  const totals = jobTotals(db, job.id);
  const contract = db.get('SELECT * FROM contracts WHERE job_id = ? ORDER BY id DESC LIMIT 1', job.id);
  const invoices = db.all("SELECT id FROM invoices WHERE job_id = ? AND status != 'void' ORDER BY COALESCE(send_on, issue_date), id", job.id).map((r) => loadInvoice(db, r.id));
  const booked = ['booked', 'shot', 'editing', 'delivered', 'complete'].includes(job.status);
  const canAccept = ['enquiry', 'quoted'].includes(job.status) && totals.subtotal_cents > 0;
  const plan = job.payment_plan_id ? db.get('SELECT * FROM payment_plans WHERE id = ?', job.payment_plan_id) : null;
  const rate = gstRate(db);
  const schedule = !booked && plan ? planSchedule(j(plan.steps, []), job, totals.subtotal_cents) : [];
  const response = db.get('SELECT * FROM questionnaire_responses WHERE job_id = ? ORDER BY id DESC LIMIT 1', job.id);
  const deliveries = db.all('SELECT * FROM deliveries WHERE job_id = ? ORDER BY id DESC', job.id);
  const first = (client.contact_name || client.name).split(' ')[0];
  const api = `/api/public/jobs/${job.token}`;

  const lineRow = (l) => `<tr><td>${l.optional ? `<label class="check" style="margin:0"><input type="checkbox" class="opt" data-id="${l.id}" data-cents="${Math.round(l.qty * l.unit_cents)}" ${l.selected ? 'checked' : ''} ${canAccept ? '' : 'disabled'}><span><strong>${esc(l.description)}</strong> <span class="pill grey">optional</span></span></label>` : `<strong>${esc(l.description)}</strong>`}${l.details ? `<div class="details">${esc(l.details)}</div>` : ''}</td><td class="n">${l.qty !== 1 ? `${l.qty} × ` : ''}${money(l.unit_cents)}</td></tr>`;

  const quote = `<div class="card" id="quote"><h2>Your <em>${booked ? 'booking' : 'quote'}</em></h2><table><thead><tr><th>Item</th><th class="n">Price ex GST</th></tr></thead><tbody>${lines.map(lineRow).join('')}</tbody></table>
    <table class="tot" style="margin-top:10px;max-width:320px;margin-left:auto"><tr><td>Subtotal</td><td class="n" id="sub">${money(totals.subtotal_cents)}</td></tr><tr><td>GST</td><td class="n" id="gst">${money(totals.gst_cents)}</td></tr><tr class="grand"><td>Total</td><td class="n" id="tot">${money(totals.total_cents)}</td></tr></table>
    ${schedule.length ? `<h3>Payments</h3><ul class="small" style="margin:0;padding-left:18px">${schedule.map((p) => `<li><strong>${esc(p.label)}</strong>: ${p.send_on <= new Date().toISOString().slice(0, 10) ? 'when you book' : `invoiced ${dmy(p.send_on)}`}, due ${dmy(p.due_date)}</li>`).join('')}</ul>` : ''}</div>`;

  let agreement = '';
  if (contract) {
    agreement = contract.status === 'signed'
      ? `<div class="card" id="agreement"><h2>Agreement <em>signed</em></h2><details><summary class="small">Read the agreement</summary><div class="contract" style="margin-top:10px">${esc(contract.body)}</div></details>
        <div style="display:flex;gap:30px;flex-wrap:wrap;margin-top:14px"><div><div class="muted small">Signed by</div><img class="sigimg" alt="Signature of ${esc(contract.signed_name)}" src="${esc(contract.signature)}"><div><strong>${esc(contract.signed_name)}</strong> · ${dmy(contract.signed_at)}</div></div>
        <div><div class="muted small">For ${esc(getSettings(db).agency_name)}</div><div style="font-family:'Playfair Display',serif;font-style:italic;font-size:22px;margin:18px 0 6px">${esc((contract.agency_signer || '').split(',')[0])}</div><div>${esc(contract.agency_signer || '')}</div></div></div>
        <p class="small muted noprint"><a href="#" onclick="print();return false">Print or save a copy</a></p></div>`
      : `<div class="card" id="agreement"><h2>Your <em>agreement</em></h2><div class="contract">${esc(contract.body)}</div>
        ${canAccept || booked ? `<form id="signform" style="margin-top:16px"><label class="f">Your full name<input class="i" name="name" autocomplete="name" required value="${esc(client.contact_name || '')}"></label>
        <div class="f" style="font-weight:600;font-size:14px;margin-bottom:6px">Sign here <span class="muted small">(finger or mouse)</span></div><canvas class="sig" id="sig"></canvas><div><button type="button" class="btn ghost sm" id="clear" style="margin-top:8px">Clear</button></div>
        <label class="check"><input type="checkbox" name="agree" required> <span>I have read and agree to this agreement, and I'm signing it electronically.</span></label></form>` : ''}</div>`;
  }

  const bookBox = canAccept ? `<div class="card" id="book"><h2>Ready to <em>book?</em></h2><p>${contract && contract.status !== 'signed' ? 'Sign the agreement above, then confirm. ' : ''}${schedule.length ? `Your first invoice (${esc(schedule[0].label.toLowerCase())}) arrives straight away.` : 'Your invoice arrives straight away.'}</p>
    <button class="btn" id="bookbtn">Confirm booking</button><div class="msg" id="bookmsg"></div></div>` : '';

  const payments = invoices.length ? `<div class="card" id="payments"><h2>Payments</h2><table><tbody>${invoices.map((i) => `<tr><td><strong>${esc(i.plan_label || i.notes || i.number)}</strong><div class="muted small">${esc(i.number)}${i.status === 'draft' ? ` · will be sent ${dmy(i.send_on)}` : ` · due ${dmy(i.due_date)}`}</div></td>
    <td class="n">${money(i.total_cents)}<br>${i.status === 'paid' ? '<span class="pill">paid</span>' : i.status === 'draft' ? '<span class="pill grey">scheduled</span>' : i.overdue ? '<span class="pill bad">overdue</span>' : '<span class="pill warn">due</span>'}</td>
    <td class="n">${i.status === 'sent' ? `<a class="btn sm" href="/i/${esc(i.public_token)}">Pay</a>` : i.status === 'paid' ? `<a class="small" href="/i/${esc(i.public_token)}">Receipt</a>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '';

  let questionnaire = '';
  if (response && booked) {
    const q = j(response.questions, {});
    const ans = j(response.answers, {});
    const field = (x) => {
      const v = ans[x.id] ?? '';
      const req = x.required ? ' required' : '';
      const name = `name="${esc(x.id)}"`;
      if (x.type === 'textarea') return `<label class="f">${esc(x.label)}<textarea class="i" rows="4" ${name}${req}>${esc(v)}</textarea></label>`;
      if (x.type === 'choice') return `<label class="f">${esc(x.label)}<select class="i" ${name}${req}><option value=""></option>${(x.options || []).map((o) => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
      if (x.type === 'checkbox') return `<label class="check"><input type="checkbox" ${name} ${v === true || v === 'true' ? 'checked' : ''}> <span>${esc(x.label)}</span></label>`;
      return `<label class="f">${esc(x.label)}<input class="i" type="${x.type === 'date' ? 'date' : 'text'}" ${name} value="${esc(v)}"${req}></label>`;
    };
    questionnaire = `<div class="card" id="questionnaire"><h2>${esc(q.name || 'Questionnaire')}</h2>${q.intro ? `<p class="muted">${nl2br(q.intro)}</p>` : ''}${response.submitted_at ? `<div class="callout small" style="margin-bottom:14px">Thanks, we have your answers (sent ${dmy(response.submitted_at)}). You can still update them below.</div>` : ''}
      <form id="qform">${(q.questions || []).map(field).join('')}<button class="btn" type="submit">${response.submitted_at ? 'Update answers' : 'Send answers'}</button> <button class="btn ghost" type="button" id="qsave">Save for later</button><div class="msg" id="qmsg"></div></form></div>`;
  }

  const files = deliveries.length ? `<div class="card" id="files"><h2>Your <em>files</em></h2><div class="files">${deliveries.map((d) => {
    const emb = embedUrl(d.url);
    return `<div class="file" style="${emb ? 'display:block' : ''}"><div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap"><div><strong>${esc(d.label || PROVIDER_LABELS[d.provider] || 'Your files')}</strong><div class="muted small">${esc(PROVIDER_LABELS[d.provider] || 'Link')}${d.note ? ` · ${esc(d.note)}` : ''}</div></div>
      <a class="btn sm" href="${esc(d.url)}" target="_blank" rel="noopener">Open in ${esc(PROVIDER_LABELS[d.provider] || 'browser')} ↗</a></div>
      ${emb ? `<div class="embed"><iframe src="${esc(emb)}" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen title="${esc(d.label || 'Video')}"></iframe></div>` : ''}</div>`;
  }).join('')}</div></div>` : '';

  const body = `<section class="hero"><div class="w"><div class="eyebrow">${esc(job.category === 'video' ? 'Video' : job.category === 'photo_video' ? 'Photo + video' : 'Photography')}${booked ? ' · booked' : ''}</div>
    <h1>Hi ${esc(first)}, <em>${booked ? "you're booked." : "here's your quote."}</em></h1>
    <div class="facts"><span><b>${esc(job.title)}</b></span><span>📅 ${esc(longDate(job.shoot_date))}${job.start_time ? `, ${esc(job.start_time)}${job.end_time ? `–${esc(job.end_time)}` : ''}` : ''}</span>${job.location ? `<span>📍 ${esc(job.location)}</span>` : ''}<span>✉️ <a style="color:var(--mint)" href="mailto:${esc(ownerEmail)}">${esc(owner?.send_as_name || owner?.name || 'Kess Media')}</a></span></div></div></section>
    <main class="w">${statusSteps(job, contract, invoices)}${job.status === 'lost' ? '<div class="card"><h2>This quote has closed</h2><p>Get in touch if you would like to pick it back up.</p></div>' : `${files}${quote}${agreement}${bookBox}${payments}${questionnaire}`}</main>`;

  const script = `${POST_JS}${SIG_JS}
const API=${JSON.stringify(api)};const RATE=${rate};
const opts=[...document.querySelectorAll('.opt')];const base=${totals.subtotal_cents - lines.filter((l) => l.optional && l.selected).reduce((n, l) => n + Math.round(l.qty * l.unit_cents), 0)};
const fmt=c=>'$'+(c/100).toLocaleString('en-AU',{minimumFractionDigits:c%100?2:0,maximumFractionDigits:2});
function recalc(){const sub=base+opts.filter(o=>o.checked).reduce((n,o)=>n+Number(o.dataset.cents),0);const g=Math.round(sub*RATE);document.getElementById('sub').textContent=fmt(sub);document.getElementById('gst').textContent=fmt(g);document.getElementById('tot').textContent=fmt(sub+g)}
opts.forEach(o=>o.addEventListener('change',recalc));
const sigEl=document.getElementById('sig');const pad=sigEl?sigPad(sigEl):null;const clr=document.getElementById('clear');if(clr)clr.onclick=()=>pad.clear();
const bb=document.getElementById('bookbtn');if(bb)bb.onclick=async()=>{const m=document.getElementById('bookmsg');const f=document.getElementById('signform');const body={selected:opts.filter(o=>o.checked).map(o=>Number(o.dataset.id))};
 if(f){if(!f.name.value.trim())return say(m,'Add your full name to sign',1);if(pad.empty())return say(m,'Please sign in the box above',1);if(!f.agree.checked)return say(m,'Tick the box to agree to the agreement',1);body.signed_name=f.name.value.trim();body.signature=pad.data();body.agree=true}
 bb.disabled=true;say(m,'Booking…');try{const r=await post(API+'/accept',body);say(m,'Booked! Taking you to your first invoice…');setTimeout(()=>{location.href=r.pay_url||location.pathname},900)}catch(e){bb.disabled=false;say(m,e.message,1)}};
const qf=document.getElementById('qform');if(qf){const collect=()=>{const a={};for(const el of qf.elements){if(!el.name)continue;a[el.name]=el.type==='checkbox'?el.checked:el.value}return a};
 qf.onsubmit=async e=>{e.preventDefault();const m=document.getElementById('qmsg');try{await post(API+'/questionnaire',{answers:collect(),submit:true});say(m,'Thanks! Your answers are saved.')}catch(err){say(m,err.message,1)}};
 document.getElementById('qsave').onclick=async()=>{const m=document.getElementById('qmsg');try{await post(API+'/questionnaire',{answers:collect(),submit:false});say(m,'Saved. Come back any time.')}catch(err){say(m,err.message,1)}}}`;
  return layout(db, { title: job.title, body, script });
}

export function invoicePage(db, inv, { paid } = {}) {
  const s = getSettings(db);
  const canPay = stripeEnabled() && inv.status === 'sent';
  const status = inv.status === 'paid' ? '<span class="pill">Paid</span>' : inv.status === 'void' ? '<span class="pill grey">Cancelled</span>' : inv.overdue ? '<span class="pill bad">Overdue</span>' : `<span class="pill warn">Due ${dmy(inv.due_date)}</span>`;
  const job = inv.job_id ? db.get('SELECT token, title FROM jobs WHERE id = ?', inv.job_id) : null;
  const body = `<section class="hero"><div class="w"><div class="eyebrow">Tax invoice ${esc(inv.number)}</div><h1>${inv.status === 'paid' ? 'Paid, <em>thank you.</em>' : `${money(inv.total_cents)} <em>${inv.overdue ? 'overdue' : 'due'}</em>`}</h1>
    <div class="facts"><span>${esc(inv.client_name)}</span><span>Issued ${dmy(inv.issue_date)}</span><span>${status}</span></div></div></section>
    <main class="w" style="margin-top:22px">${paid && inv.status !== 'paid' ? '<div class="callout" style="margin-bottom:18px">Thanks! Your payment is being processed and this page will show it as paid shortly.</div>' : ''}
    <div class="card"><table><thead><tr><th>Description</th><th class="n">Amount ex GST</th></tr></thead><tbody>${inv.items.map((i) => `<tr><td>${esc(i.description)}${i.qty !== 1 ? ` <span class="muted">× ${i.qty}</span>` : ''}</td><td class="n">${money(Math.round(i.qty * i.unit_cents))}</td></tr>`).join('')}</tbody></table>
    <table class="tot" style="margin-top:10px;max-width:320px;margin-left:auto"><tr><td>Subtotal</td><td class="n">${money(inv.subtotal_cents)}</td></tr><tr><td>GST</td><td class="n">${money(inv.gst_cents)}</td></tr><tr class="grand"><td>Total</td><td class="n">${money(inv.total_cents)}</td></tr></table>
    <p class="small muted">From ${esc(s.agency_name)}${s.agency_abn ? `, ABN ${esc(s.agency_abn)}` : ''}. To ${esc(inv.client_name)}${inv.client_abn ? `, ABN ${esc(inv.client_abn)}` : ''}.</p></div>
    ${inv.status === 'sent' ? `<div class="card"><h2>How to <em>pay</em></h2>${canPay ? `<button class="btn" id="pay">Pay ${money(inv.total_cents)} by card</button><div class="msg" id="paymsg"></div>` : ''}
      ${s.bank_details ? `<h3>${canPay ? 'Or by' : 'By'} bank transfer</h3><div class="callout" style="white-space:pre-line">${esc(s.bank_details)}\nReference: ${esc(inv.number)}</div>` : ''}</div>` : ''}
    <p class="noprint small"><a href="#" onclick="print();return false">Print or save as PDF</a>${job ? ` · <a href="/j/${esc(job.token)}">Back to your booking</a>` : ''}</p></main>`;
  const script = `${POST_JS}const p=document.getElementById('pay');if(p)p.onclick=async()=>{const m=document.getElementById('paymsg');p.disabled=true;say(m,'Opening secure payment…');try{const r=await post(${JSON.stringify(`/api/public/invoices/${inv.public_token}/pay`)},{});location.href=r.url}catch(e){p.disabled=false;say(m,e.message,1)}};`;
  return layout(db, { title: `Invoice ${inv.number}`, body, script });
}

export function enquiryPage(db, { embed } = {}) {
  const pkgs = db.all('SELECT name, category FROM packages WHERE active = 1 ORDER BY sort, name');
  const body = `${embed ? '' : `<section class="hero"><div class="w"><div class="eyebrow">Photo + video enquiries</div><h1>Tell us about <em>your shoot.</em></h1><div class="facts"><span>We reply within one business day.</span></div></div></section>`}
    <main class="w" style="margin-top:${embed ? 0 : 22}px"><form class="card" id="enq"><div class="hp" aria-hidden="true"><label>Leave blank<input name="_hp" tabindex="-1" autocomplete="off"></label></div>
    <label class="f">Your name<input class="i" name="name" required autocomplete="name"></label>
    <label class="f">Email<input class="i" name="email" type="email" required autocomplete="email"></label>
    <label class="f">Phone<input class="i" name="phone" type="tel" autocomplete="tel"></label>
    <label class="f">Organisation <span class="muted small">(optional)</span><input class="i" name="organisation" autocomplete="organization"></label>
    <label class="f">What do you need?<select class="i" name="category"><option value="photo">Photography</option><option value="video">Video</option><option value="photo_video">Photo and video</option></select></label>
    ${pkgs.length ? `<label class="f">Package you're interested in <span class="muted small">(optional)</span><select class="i" name="package"><option value="">Not sure yet</option>${pkgs.map((p) => `<option>${esc(p.name)}</option>`).join('')}</select></label>` : ''}
    <label class="f">Date <span class="muted small">(if you know it)</span><input class="i" name="date" type="date"></label>
    <label class="f">Location<input class="i" name="location"></label>
    <label class="f">Tell us about it<textarea class="i" name="message" rows="5" required></textarea></label>
    <button class="btn" type="submit">Send enquiry</button><div class="msg" id="enqmsg"></div></form></main>`;
  const script = `${POST_JS}const f=document.getElementById('enq');f.onsubmit=async e=>{e.preventDefault();const m=document.getElementById('enqmsg');const b=f.querySelector('button');b.disabled=true;say(m,'Sending…');
const d={};new FormData(f).forEach((v,k)=>{d[k]=v});try{await post('/api/public/enquiry',d);f.reset();say(m,"Thanks! We'll be in touch within one business day.")}catch(err){say(m,err.message,1)}finally{b.disabled=false}}`;
  return layout(db, { title: 'Enquire', body, script });
}
