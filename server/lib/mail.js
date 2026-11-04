// Outgoing email. Providers are plain HTTPS APIs so there are no dependencies:
//   MAIL_PROVIDER=resend   MAIL_API_KEY=re_...      (resend.com)
//   MAIL_PROVIDER=postmark MAIL_API_KEY=server-token (postmarkapp.com)
// Without a provider every email is written to the outbox table only ("log"),
// which the owner can read under Settings > Email outbox.
import { getSettings } from '../db.js';
import { esc } from '../../shared/sections.js';

export function mailConfig() {
  const provider = ['resend', 'postmark'].includes(process.env.MAIL_PROVIDER) && process.env.MAIL_API_KEY ? process.env.MAIL_PROVIDER : 'log';
  return { provider, from: process.env.MAIL_FROM || 'Kess Media <hello@kess.media>' };
}

// Domains verified with the email provider (MAIL_VERIFIED_DOMAINS=kess.media,other.com.au).
export const verifiedDomains = () => (process.env.MAIL_VERIFIED_DOMAINS || '').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
const domainOf = (email) => String(email || '').split('@')[1]?.toLowerCase() || '';

// Who an email is "from" when a staff member sends it (quotes, contracts, invoices for their jobs).
// Verified domain: from their own address. Otherwise: shared address with their name, replies to them.
export function senderFor(db, user) {
  const base = mailConfig().from;
  if (!user) return { from: base, replyTo: null, signature: '' };
  const email = (user.send_as_email || user.email || '').trim();
  const name = (user.send_as_name || user.name || '').replace(/[<>"]/g, '').trim();
  const agency = getSettings(db).agency_name;
  const signature = user.email_signature || `${name}\n${agency}`;
  if (email && verifiedDomains().includes(domainOf(email))) return { from: `${name} <${email}>`, replyTo: email, signature, verified: true };
  const baseAddr = (base.match(/<([^>]+)>/) || [null, base])[1];
  return { from: `${name} at ${agency} <${baseAddr}>`, replyTo: email || null, signature, verified: false };
}

export function appUrl(db) {
  const s = getSettings(db);
  return (s.public_base_url || process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 8787}`).replace(/\/$/, '');
}

// Branded, minimal HTML email. `lines` are paragraphs (plain text, escaped).
export function emailHtml(db, { heading, lines = [], button, footer }) {
  const s = getSettings(db);
  const btn = button ? `<p style="margin:26px 0"><a href="${esc(button.url)}" style="background:#1E5C34;color:#fff;text-decoration:none;padding:12px 22px;border-radius:99px;font-weight:600;display:inline-block">${esc(button.label)}</a></p>` : '';
  return `<!doctype html><html><body style="margin:0;background:#F6F4F0;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;color:#1a1a1a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border-radius:12px;overflow:hidden">
<tr><td style="background:#1a1a1a;padding:18px 26px;color:#f6f6f6;font-weight:800;letter-spacing:.04em"><span style="color:#7BBF9A">&#x203A;</span> ${esc(s.agency_name.toUpperCase())}</td></tr>
<tr><td style="padding:28px 26px 8px"><h1 style="font-size:22px;line-height:1.25;margin:0 0 14px">${esc(heading)}</h1>
${lines.filter(Boolean).map((l) => `<p style="margin:0 0 12px;line-height:1.55;white-space:pre-line">${esc(l)}</p>`).join('')}${btn}</td></tr>
<tr><td style="padding:16px 26px 24px;color:#888;font-size:12px;border-top:1px solid #eee">${footer ? esc(footer) : `${esc(`${s.agency_name} · ${s.agency_email}`)}<br>You get these emails because you have a ${esc(s.agency_name)} Cloud account. Turn them off under Account.`}</td></tr>
</table></td></tr></table></body></html>`;
}

async function deliver({ provider, from }, { to, subject, html, text, replyTo }) {
  if (provider === 'resend') {
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.MAIL_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to: [to], subject, html, text, ...(replyTo ? { reply_to: replyTo } : {}) }), signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
  } else if (provider === 'postmark') {
    const r = await fetch('https://api.postmarkapp.com/email', { method: 'POST', headers: { 'X-Postmark-Server-Token': process.env.MAIL_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ From: from, To: to, Subject: subject, HtmlBody: html, TextBody: text, MessageStream: 'outbound', ...(replyTo ? { ReplyTo: replyTo } : {}) }), signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`Postmark ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
}

// Fire-and-forget: never blocks or fails the request that triggered it.
export function sendMail(db, { to, subject, heading, lines, button, text, from, replyTo, footer }) {
  const cfg = mailConfig();
  const sender = { ...cfg, from: from || cfg.from };
  const html = emailHtml(db, { heading: heading || subject, lines, button, footer });
  const plain = text || [heading || subject, ...(lines || []), button ? `${button.label}: ${button.url}` : ''].filter(Boolean).join('\n\n');
  const { id } = db.run('INSERT INTO outbox (to_addr, subject, body, provider, status, from_addr, reply_to) VALUES (?, ?, ?, ?, ?, ?, ?)', to, subject, plain, cfg.provider, cfg.provider === 'log' ? 'logged' : 'sending', sender.from, replyTo || null);
  if (cfg.provider === 'log') return Promise.resolve({ id, status: 'logged' });
  return deliver(sender, { to, subject, html, text: plain, replyTo })
    .then(() => { db.run("UPDATE outbox SET status = 'sent' WHERE id = ?", id); return { id, status: 'sent' }; })
    .catch((e) => { db.run("UPDATE outbox SET status = 'failed', error = ? WHERE id = ?", String(e.message || e).slice(0, 500), id); return { id, status: 'failed' }; });
}
