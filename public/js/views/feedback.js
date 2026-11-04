import { api, html, render, ago, date, modal, field, toast, fail, confirmBox, isAgency, pill } from '../lib.js';

const KIND = { pin: '📍 Pin', text: '🖍 Highlight', draw: '✏️ Drawing' };

export default async function feedbackTab(t, site, filter = 'open') {
  const agency = isAgency();
  const [items, links] = await Promise.all([api(`/api/sites/${site.id}/feedback`), api(`/api/sites/${site.id}/review-links`)]);
  const shown = items.filter((i) => filter === 'all' || i.status === filter);
  const pages = new Map(site.pages.map((p) => [p.slug, p.title]));
  const bySlug = new Map();
  for (const i of shown) { if (!bySlug.has(i.page_slug)) bySlug.set(i.page_slug, []); bySlug.get(i.page_slug).push(i); }
  const numbers = new Map();
  for (const slug of new Set(items.map((i) => i.page_slug))) items.filter((i) => i.page_slug === slug).forEach((i, n) => numbers.set(i.id, n + 1));
  const onPage = (i) => `/preview/${site.id}/${i.page_slug}?feedback=1&fb=${i.id}`;
  const activeLinks = links.filter((l) => !l.revoked);

  render(t, html`<div class="grid g-side"><div>
    <div class="row between" style="margin-bottom:12px">
      <div class="row">${[['open', 'Open'], ['resolved', 'Resolved'], ['all', 'All']].map(([k, l]) => html`<button class="btn sm ${k === filter ? 'primary' : ''}" data-f="${k}">${l} (${k === 'all' ? items.length : items.filter((i) => i.status === k).length})</button>`)}</div>
      <a class="btn primary" href="${site.urls.preview}?feedback=1" target="_blank" rel="noopener">💬 Open the page and comment ↗</a></div>
    ${shown.length ? [...bySlug].map(([slug, list]) => html`<div class="card"><div class="card-head"><h2>${pages.get(slug) || slug || 'Home'} <span class="muted small mono">/${slug}</span></h2><a class="small" href="/preview/${site.id}/${slug}?feedback=1" target="_blank" rel="noopener">Open page ↗</a></div>
      ${list.map((i) => html`<div class="comment ${i.status === 'resolved' ? '' : 'mine'}" style="margin-bottom:10px">
        <div class="row between"><div class="meta"><strong>#${numbers.get(i.id)} ${i.author}</strong> ${i.author_kind === 'guest' ? html`<span class="pill grey">review link</span>` : i.author_kind === 'agency' ? html`<span class="pill dark">Kess Media</span>` : ''} · ${KIND[i.kind]} · ${ago(i.created_at)}${i.version !== 'draft' ? ` · on ${i.version}` : ''}${i.viewport_w && i.viewport_w < 700 ? ' · 📱 mobile' : ''}${agency && i.guest_email ? html` · <a href="mailto:${i.guest_email}">${i.guest_email}</a>` : ''}</div>${pill(i.status === 'open' ? 'new' : 'done', i.status)}</div>
        ${i.anchor.quote ? html`<div class="small" style="background:#FFF6CC;border-radius:6px;padding:3px 8px;margin:4px 0;font-style:italic">“${i.anchor.quote}”</div>` : ''}
        <div class="pre">${i.body}</div>
        ${i.replies.map((r) => html`<div class="small" style="border-left:3px solid var(--sage-dark);padding-left:9px;margin-top:6px"><strong>${r.author}</strong> <span class="muted">· ${ago(r.created_at)}</span><div class="pre">${r.body}</div></div>`)}
        <div class="row" style="margin-top:8px"><a class="btn sm" href="${onPage(i)}" target="_blank" rel="noopener">Show on page ↗</a><button class="btn sm" data-reply="${i.id}">Reply</button>
          ${agency || i.mine ? html`<button class="btn sm" data-status="${i.id}" data-to="${i.status === 'open' ? 'resolved' : 'open'}">${i.status === 'open' ? '✓ Resolve' : 'Reopen'}</button>` : ''}
          ${agency ? (i.request_id ? html`<a class="btn sm" href="#/requests/${i.request_id}">Request #${i.request_id}</a>` : html`<button class="btn sm" data-req="${i.id}">→ Make a request</button>`) : ''}</div></div>`)}</div>`)
      : html`<div class="card empty"><h3>${filter === 'open' ? 'No open feedback' : 'Nothing here'}</h3><p>Open the page in comment mode to pin comments, highlight text or draw on it. Or share a review link with people who don't have an account.</p></div>`}
  </div><div>
    <div class="card"><div class="card-head"><h2>Review links</h2><button class="btn sm primary" id="newlink">+ Share</button></div>
      <p class="muted small" style="margin-top:0">Anyone with a link can view the site and leave comments, with no account needed. Handy for a client's manager or board. Turn a link off any time.</p>
      ${activeLinks.length ? activeLinks.map((l) => html`<div style="padding:8px 0;border-top:1px solid #f1efea"><div class="row between"><strong>${l.label || (l.target === 'live' ? 'Live site' : 'Draft')}</strong><span class="pill ${l.target === 'live' ? 'dark' : 'info'}">${l.target}</span></div>
        <div class="muted small">${l.comments} comment${l.comments === 1 ? '' : 's'} · by ${l.created_by_name || '—'} · ${l.expires_at ? `expires ${date(l.expires_at)}` : 'no expiry'}</div>
        <div class="row" style="margin-top:6px"><button class="btn sm" data-copy="${l.url}">Copy link</button><a class="btn sm" href="${l.url}" target="_blank" rel="noopener">Open ↗</a><button class="btn sm ghost danger" data-revoke="${l.id}">Turn off</button></div></div>`)
        : html`<div class="muted small">No links yet.</div>`}</div>
    <div class="card"><h2>How it works</h2><ul class="small" style="padding-left:18px;margin:8px 0 0">
      <li><strong>💬 Comment:</strong> click anything to pin a note, or select text to highlight it.</li>
      <li><strong>✏️ Draw:</strong> circle or mark part of the page, then add a note.</li>
      <li>Pins stay attached to the right section on desktop and mobile.</li>
      <li>${agency ? 'Turn any comment into a request for your board, and resolve it when done.' : 'Kess Media gets notified and replies right on the comment.'}</li></ul></div>
  </div></div>`);

  const reload = (f = filter) => feedbackTab(t, site, f);
  t.querySelectorAll('[data-f]').forEach((b) => b.onclick = () => reload(b.dataset.f));
  t.querySelectorAll('[data-status]').forEach((b) => b.onclick = async () => { try { await api(`/api/sites/${site.id}/feedback/${b.dataset.status}`, { method: 'PATCH', body: { status: b.dataset.to } }); toast(b.dataset.to === 'resolved' ? 'Resolved' : 'Reopened'); reload(); } catch (e) { fail(e); } });
  t.querySelectorAll('[data-req]').forEach((b) => b.onclick = async () => { try { const r = await api(`/api/sites/${site.id}/feedback/${b.dataset.req}/request`, { method: 'POST', body: {} }); toast(`Request #${r.request_id} created`); reload(); } catch (e) { fail(e); } });
  t.querySelectorAll('[data-reply]').forEach((b) => b.onclick = async () => {
    const v = await modal({ title: 'Reply', submit: 'Send reply', body: field('Your reply', 'body', { type: 'textarea', required: true, rows: 4 }) });
    if (!v) return;
    try { await api(`/api/sites/${site.id}/feedback/${b.dataset.reply}/replies`, { method: 'POST', body: v }); toast('Reply sent'); reload(); } catch (e) { fail(e); }
  });
  t.querySelectorAll('[data-copy]').forEach((b) => b.onclick = () => { navigator.clipboard?.writeText(b.dataset.copy); toast('Link copied'); });
  t.querySelectorAll('[data-revoke]').forEach((b) => b.onclick = async () => {
    if (!await confirmBox('Turn off this link?', 'People using it will no longer be able to view or comment. Their comments stay here.', 'Turn off')) return;
    try { await api(`/api/sites/${site.id}/review-links/${b.dataset.revoke}`, { method: 'DELETE' }); reload(); } catch (e) { fail(e); }
  });
  t.querySelector('#newlink').onclick = async () => {
    const v = await modal({ title: 'Share a review link', submit: 'Create link', body: html`${field('Who is it for?', 'label', { placeholder: 'e.g. Board members, Sam’s manager' })}
      ${field('What can they see?', 'target', { type: 'select', options: [['draft', 'The current draft (changes in progress)'], ...(site.published_version_id ? [['live', 'The live site']] : [])] })}
      ${field('Turn off automatically after', 'days', { type: 'select', value: '30', options: [['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['0', 'Never']] })}` });
    if (!v) return;
    try {
      const r = await api(`/api/sites/${site.id}/review-links`, { method: 'POST', body: v });
      navigator.clipboard?.writeText(r.url);
      await modal({ title: 'Review link ready', submit: '', cancel: 'Done', body: html`<p style="margin:0">Send this to the people reviewing. They add their name when they leave a comment.</p><input class="i mono" readonly value="${r.url}" onclick="this.select()">` });
      reload();
    } catch (e) { fail(e); }
  };
}
