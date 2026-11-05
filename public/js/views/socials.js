// Socials: the kess-socials Review roster and Ledger, inside Kess Cloud (agency only).
// Ported from src/app/review/{Roster,ReviewTabs,ReviewCard,AddCard,Receipt}.tsx and src/app/ledger/page.tsx.
import { api, html, render, toast, fail, confirmBox, isOwner } from '../lib.js';

const PLATFORM_NAME = { instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn', bluesky: 'Bluesky', threads: 'Threads', pinterest: 'Pinterest', google: 'Google Business', twitter: 'X', mastodon: 'Mastodon' };
const MODE_WORD = { draft: 'Draft', schedule: 'Schedule', now: 'Post now' };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const ddmmyyyy = (d) => String(d).slice(0, 10).split('-').reverse().join('/');
const clock = (iso, withDate) => new Date(iso).toLocaleString('en-AU', { timeZone: 'Australia/Sydney', ...(withDate ? { day: '2-digit', month: '2-digit', year: 'numeric' } : {}), hour: 'numeric', minute: '2-digit' });
const shorten = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const STYLE = html`<style>
.sc-day{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 14px}
.sc-day .mid{text-align:center}.sc-day .mid strong{display:block;font-size:16px}
.sc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;align-items:start}
.sc-card{background:#fff;border:1px solid var(--line);border-radius:12px;overflow:hidden;box-shadow:var(--shadow)}
.sc-card.open{grid-column:1/-1}
.sc-card .pic{display:block;width:100%;height:auto;background:var(--sage);aspect-ratio:4/3;object-fit:cover}
.sc-card.open .pic{aspect-ratio:auto;max-height:520px;object-fit:contain;background:#f1efea}
.sc-body{padding:14px 16px;display:flex;flex-direction:column;gap:10px}
.sc-open{display:grid;grid-template-columns:minmax(260px,5fr) 7fr;gap:0}
.sc-open > .l{border-right:1px solid var(--line)}
@media(max-width:900px){.sc-open{grid-template-columns:1fr}.sc-open > .l{border-right:0}}
.sc-cap{white-space:pre-wrap;font-size:13.5px;margin:0;display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden}
.sc-goes{font-size:12px;color:var(--muted)}.sc-goes b{color:var(--charcoal)}
.sc-err{background:var(--danger-bg);color:var(--danger);border-radius:8px;padding:8px 12px;font-size:13px}
.sc-err button{background:none;border:0;padding:0;margin-top:4px;color:var(--danger);text-decoration:underline;cursor:pointer;display:block}
.sc-note{background:#f1efea;border-radius:8px;padding:8px 12px;font-size:13px;color:#444}
.sc-busy{display:flex;gap:10px;align-items:center;background:var(--sage);border-radius:8px;padding:10px 12px;font-size:13px}
.sc-spin{width:16px;height:16px;border:2px solid var(--sage-dark);border-top-color:var(--forest);border-radius:50%;animation:scspin .8s linear infinite;flex:none}
@keyframes scspin{to{transform:rotate(360deg)}}
.sc-sibs{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px}
.sc-sib{flex:none;width:84px;text-align:center}
.sc-sib button.th{display:block;padding:0;border:2px solid transparent;border-radius:8px;background:none;cursor:pointer}
.sc-sib button.th.on{border-color:var(--forest)}
.sc-sib img{display:block;width:80px;height:80px;object-fit:cover;border-radius:6px}
.sc-sib .tag{font-size:10.5px;color:var(--muted)}
.sc-linkbtn{background:none;border:0;padding:0;color:var(--forest);text-decoration:underline;cursor:pointer;font-size:12px}
.sc-linkbtn:disabled{opacity:.4;cursor:default}
.sc-chips{display:flex;flex-wrap:wrap;gap:6px}
.sc-chip{border:1px solid var(--line);background:#fff;border-radius:99px;padding:4px 12px;font-size:13px;cursor:pointer}
.sc-chip.on{background:var(--forest);border-color:var(--forest);color:#fff}
.sc-chip:disabled{cursor:default}.sc-chip.done{background:var(--sage);color:var(--muted)}
.sc-chip.taken{border-style:dashed;color:#999;background:#faf9f7;cursor:not-allowed}.sc-chip.taken s{color:#999}
.sc-var{border:1px solid var(--line);border-radius:10px;padding:8px 10px}
.sc-var.off{opacity:.6}
.sc-var .hd{display:flex;align-items:center;gap:8px;font-size:13px}.sc-var .hd .n{margin-left:auto;color:var(--muted);font-variant-numeric:tabular-nums}
.sc-var .hd .n.over{color:var(--danger);font-weight:700}
.sc-var textarea{margin-top:6px;width:100%;min-height:92px;font-size:13px}
.sc-var textarea.over{border-color:var(--danger)}
.sc-receipt{display:flex;align-items:center;gap:10px;background:#fff;border:1px solid var(--line);border-radius:10px;padding:8px;font-size:13px;color:var(--muted)}
.sc-receipt img{width:44px;height:44px;object-fit:cover;border-radius:6px;flex:none}
.sc-receipt .t{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--charcoal)}
.sc-dry{border:1px dashed var(--forest);background:var(--sage);border-radius:8px;padding:8px 12px;font-size:12.5px}
.sc-dry pre{max-height:320px;overflow:auto;background:#fff;border-radius:6px;padding:8px;font-size:11.5px;white-space:pre-wrap;word-break:break-all}
.sc-add{border:1px dashed var(--line);border-radius:12px;padding:14px;background:#fff}
.sc-found{list-style:none;margin:8px 0 0;padding:0}
.sc-found li{display:flex;gap:10px;align-items:center;padding:6px 0;border-bottom:1px solid #f1efea}
.sc-found img{width:40px;height:40px;border-radius:6px;object-fit:cover;flex:none}
.sc-found .t{flex:1;min-width:0}.sc-found .t div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sc-thumb{width:40px;height:40px;object-fit:cover;border-radius:6px;display:block}
</style>`;

// ---------------------------------------------------------------------------------------------- roster
const ui = new Map(); // suggestionId -> what this screen holds for the card (open, unsaved captions, choices)
const adders = {}; // brand -> "Post something else" state
let view = { el: null, data: null, brand: null, date: null };

function stateFor(card) {
  let st = ui.get(card.suggestionId);
  const server = Object.fromEntries(card.variants.map((v) => [v.id, { caption: v.caption, enabled: v.enabled }]));
  if (!st) {
    st = {
      open: false, busy: null, error: card.state === 'failed' ? (card.publerJobId ? 'A post may already exist in Publer. Check Publer before retrying.' : 'Last send failed. Adjust and retry.') : null,
      brief: card.brief ?? '', serverBrief: card.brief, overwrite: false,
      captions: Object.fromEntries(card.variants.map((v) => [v.id, v.caption])), enabled: Object.fromEntries(card.variants.map((v) => [v.id, v.enabled])), server,
      selected: card.selectedSiblingIds, showWhen: false, otherTime: false, when: '', windowKey: null, weekendUnticked: [], lastEdited: null,
    };
    ui.set(card.suggestionId, st);
    return st;
  }
  // Fresh data from the server wins wherever it changed since we last saw it; untouched local edits are kept.
  for (const v of card.variants) {
    const prev = st.server[v.id];
    if (!prev || prev.caption !== v.caption) st.captions[v.id] = v.caption;
    if (!prev || prev.enabled !== v.enabled) st.enabled[v.id] = v.enabled;
  }
  st.server = server;
  if (st.serverBrief !== card.brief) { st.brief = card.brief ?? ''; st.serverBrief = card.brief; }
  st.selected = card.selectedSiblingIds;
  return st;
}

export async function roster(el, _params, query) {
  // Events go on an inner root, so they leave with this screen when the router draws another one.
  render(el, html`<div class="sc-root">${STYLE}<div class="card empty">Loading today's cards…</div></div>`);
  const root = el.firstElementChild;
  view = { el: root, data: null, brand: query.get('brand') || view.brand, date: query.get('date') || '' };
  root.onclick = onClick;
  root.oninput = onInput;
  root.onchange = onChange;
  root.addEventListener('focusout', onBlur);
  await reload();
}

async function reload() {
  const data = await api(`/api/socials/roster${view.date ? `?date=${encodeURIComponent(view.date)}` : ''}`);
  view.data = data;
  if (!data.brands.some((b) => b.brand === view.brand)) view.brand = (data.brands.find((b) => b.cards.length) ?? data.brands[0])?.brand ?? null;
  for (const b of data.brands) for (const c of b.cards) stateFor(c);
  draw();
}

const findCard = (sid) => { for (const b of view.data.brands) { const c = b.cards.find((x) => x.suggestionId === sid); if (c) return { card: c, brand: b }; } return {}; };
const onScreen = (card, st) => card.variants.map((v) => ({ variantId: v.id, caption: st.captions[v.id], enabled: st.enabled[v.id] }));
const activeKey = (st, windows) => (st.windowKey !== null && windows.some((w) => w.key === st.windowKey && !w.takenBy) ? st.windowKey : null);

function draw() {
  const d = view.data;
  if (!d) return;
  const dayLabel = d.age === 0 ? 'Today' : d.age === 1 ? 'Yesterday' : new Date(d.date + 'T00:00:00Z').toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const left = d.rosterDays - d.age;
  const total = d.brands.reduce((n, b) => n + b.cards.length, 0);
  const current = d.brands.find((b) => b.brand === view.brand);
  const href = (date) => `#/socials${date && date !== d.today ? `?date=${date}` : ''}`;
  render(view.el, html`${STYLE}
    <div class="page-head"><div><h1>Social <em>posts</em></h1><p>Three cards a day for each brand. Later, Never, or open one to write and send it.</p></div>
      <div class="row"><a class="btn" href="#/socials/ledger">Ledger</a></div></div>
    ${!d.status.sending ? html`<div class="callout dark" style="margin-bottom:14px"><strong>Dry run: sending is off.</strong> Draft, Schedule and Post now build the exact Publer request and keep it on the card. Nothing goes to Publer until <span class="mono">SOCIALS_SEND=1</span> is set on the server.</div>` : ''}
    ${!d.status.captions ? html`<div class="callout warn" style="margin-bottom:14px">Captions are not set up on this server (<span class="mono">ANTHROPIC_API_KEY</span>), so Regenerate and new cards come without captions. You can still write them yourself.</div>` : ''}
    <nav class="sc-day" aria-label="Roster day">
      ${d.prevDate ? html`<a class="btn" href="${href(d.prevDate)}">Previous day</a>` : html`<span class="btn" aria-disabled="true" style="opacity:.35">Previous day</span>`}
      <div class="mid"><strong>${dayLabel}</strong><span class="muted small">${d.age === 0 ? ddmmyyyy(d.date) : `${ddmmyyyy(d.date)} · back to the pile in ${plural(left, 'day')}`}</span></div>
      ${d.nextDate ? html`<a class="btn" href="${href(d.nextDate)}">Next day</a>` : html`<span class="btn" aria-disabled="true" style="opacity:.35">Next day</span>`}
    </nav>
    ${total === 0 ? html`<p class="muted">No suggestions for this day.</p>` : ''}
    ${!d.brands.length ? html`<div class="card empty"><h3>No brands set up</h3><p>Brand accounts come from the import (see the README).</p></div>` : html`
    <div class="tabs" role="tablist">${d.brands.map((b) => html`<a href="#" role="tab" data-act="tab" data-brand="${b.brand}" class="${b.brand === view.brand ? 'on' : ''}">${b.label} <span class="count">${b.cards.filter((c) => c.decision === 'pending' && c.state !== 'sent').length}</span></a>`)}</div>
    ${current ? html`
      ${total > 0 && !current.cards.length ? html`<p class="muted">Nothing eligible for ${current.label} on this day.</p>` : ''}
      <div class="sc-grid">${current.cards.map((c) => cardHtml(c, current))}</div>
      <div class="mt">${addHtml(current)}</div>` : ''}`}`);
}

function dryRunHtml(card) {
  const r = card.dryRun;
  if (!r) return '';
  const what = r.resume ? `would only re-check Publer job ${r.jobId}, never submit again` : `${MODE_WORD[r.mode] ?? r.mode} would upload ${plural(r.uploads.length, 'image')} and send ${plural(r.requests.length, 'request')} to Publer${r.scheduledAt ? `, first at ${clock(r.scheduledAt, true)}${r.scheduledUntil ? `, last at ${clock(r.scheduledUntil, false)}` : ''}` : ''}`;
  return html`<div class="sc-dry"><strong>Dry run</strong> ${clock(card.dryRunAt, true)}: ${what}.
    <details><summary>Show the Publer requests</summary><pre>${JSON.stringify({ uploads: r.uploads, requests: r.requests }, null, 2)}</pre></details></div>`;
}

function receiptHtml(card) {
  const when = card.scheduledAt ? ` · ${clock(card.scheduledAt, true)}${card.scheduledUntil ? ` to ${clock(card.scheduledUntil, false)}` : ''}` : '';
  const what = card.decision === 'later' ? 'Later' : card.decision === 'never' ? 'Never' : card.state === 'sent' ? `${card.mode === 'schedule' ? 'Scheduled' : `Sent · ${card.mode}`}${when}` : 'Decided';
  const missed = card.state === 'sent' && card.error?.startsWith('partial:') ? card.error.slice('partial:'.length).split(',').join(', ') : null;
  return html`<div class="sc-receipt" data-card="${card.suggestionId}"><img src="${card.primary.small}" alt=""><span class="t">${card.primary.title}</span>
    <span class="nowrap">${what}${missed ? html`<span style="color:var(--warn)"> · not ${missed}</span>` : ''}</span></div>`;
}

function cardHtml(card, brand) {
  if (card.decision !== 'pending' || card.state === 'sent') return receiptHtml(card);
  const st = stateFor(card);
  const busy = !!st.busy;
  const dis = busy ? 'disabled' : '';
  const sid = card.suggestionId;
  const p = card.primary;
  const goes = card.variants.filter((v) => st.enabled[v.id]).map((v) => `${PLATFORM_NAME[v.platform] ?? v.platform} ${v.label}`).join(' · ') || 'no accounts ticked';
  const head = html`<div><h3 style="font-size:15px">${p.title}</h3><div class="muted small">${p.contextLine}${card.manual ? ' · added by hand' : ''}</div>
      ${p.dropbox ? html`<div class="small" style="margin-top:3px;${p.dropbox.client ? '' : 'color:var(--warn)'}">${p.dropbox.client ? html`<strong>Client: ${p.dropbox.client}</strong> · ` : html`<strong>Client not recorded${p.dropbox.possible.length ? ` (possibly ${p.dropbox.possible.join(' or ')})` : ''}. Check before posting.</strong> `}<span class="muted">Dropbox: ${p.dropbox.folder}</span></div>` : ''}
      <a class="small" href="${p.parentUrl}" target="_blank" rel="noopener">${p.parentUrl.replace(/^https?:\/\//, '')} ↗</a></div>`;
  const notices = html`
    ${card.state === 'sending' ? html`<div class="sc-note">Sending. If this does not finish in 10 minutes, retry.</div>` : ''}
    ${st.error ? html`<div class="sc-err" role="alert">${st.error}${st.error.startsWith('A post may already exist') ? html`<button type="button" data-act="reset" data-card="${sid}" ${dis}>I checked Publer, clear and retry</button>` : ''}</div>` : ''}
    ${st.busy ? html`<div class="sc-busy" role="status" aria-live="polite"><span class="sc-spin" aria-hidden="true"></span><span>${st.busy}…</span></div>` : ''}
    ${dryRunHtml(card)}`;
  const img = html`<img class="pic" src="${p.thumb}" alt="" ${p.imageW ? html`width="${p.imageW}" height="${p.imageH}"` : ''} loading="lazy">`;

  if (!st.open) {
    return html`<article class="sc-card" data-card="${sid}">${img}<div class="sc-body">${head}
      <p class="sc-cap">${card.baseCaption ?? html`<em class="muted">Caption unavailable. Add a brief and regenerate.</em>`}</p>
      <div class="sc-goes"><b>Goes to:</b> ${goes}</div>${notices}
      <div class="row"><button class="btn sm" data-act="later" data-card="${sid}" ${dis}>Later</button><button class="btn sm" data-act="never" data-card="${sid}" ${dis}>Never</button>
        <button class="btn sm primary" style="margin-left:auto" data-act="open" data-card="${sid}">Open</button></div></div></article>`;
  }

  const ak = activeKey(st, brand.windows);
  const images = 1 + st.selected.length;
  return html`<article class="sc-card open" data-card="${sid}"><div class="sc-open">
    <div class="l">${img}<div class="sc-body">${head}
      <label class="f">Brief <span class="hint">context for the caption, e.g. shot at dawn for Austrade</span><textarea class="i" rows="2" data-field="brief" data-card="${sid}">${st.brief}</textarea></label>
      <div class="row"><button class="btn sm" data-act="regen" data-card="${sid}" ${dis}>Regenerate</button><label class="check small"><input type="checkbox" data-field="overwrite" data-card="${sid}" ${st.overwrite ? 'checked' : ''}> overwrite my edits</label></div>
      ${card.mentions.length ? html`<div><div class="muted small" style="margin-bottom:4px">Tag (from your list, added to every caption in each platform's form):</div>
        <div class="sc-chips">${card.mentions.map((m) => html`<button type="button" class="sc-chip ${m.added ? 'done' : ''}" data-act="mention" data-card="${sid}" data-id="${m.id}" ${busy || m.added ? 'disabled' : ''}>${m.added ? '✓' : '+'} ${m.name}</button>`)}</div></div>` : ''}
      ${card.siblings.length ? html`<div><div class="muted small" style="margin-bottom:4px">Carousel: tap to add (up to 4).${brand.brand === 'gallery' ? ' Google Business gets the lead image only.' : ''}</div>
        <div class="sc-sibs">${card.siblings.map((s) => html`<div class="sc-sib"><button type="button" class="th ${st.selected.includes(s.id) ? 'on' : ''}" data-act="sib" data-card="${sid}" data-id="${s.id}" title="${s.title}" ${dis}><img src="${s.small}" alt=""></button>
          <div class="tag">${s.mapPoster ? 'map poster' : s.source === 'studio' ? 'mockup' : ''}</div>
          ${st.selected.includes(s.id) ? html`<button type="button" class="sc-linkbtn" data-act="primary" data-card="${sid}" data-id="${s.id}" ${dis}>Make primary</button>` : ''}</div>`)}</div></div>` : ''}
      ${notices}</div></div>
    <div class="sc-body">
      <div class="sc-goes"><b>Goes to:</b> ${goes}</div>
      <div class="stack" style="${busy ? 'opacity:.55;pointer-events:none' : ''}">${card.variants.map((v) => {
        const len = st.captions[v.id].length;
        return html`<div class="sc-var ${st.enabled[v.id] ? '' : 'off'}" data-var="${v.id}">
          <label class="hd"><input type="checkbox" data-field="enabled" data-card="${sid}" data-var="${v.id}" ${st.enabled[v.id] ? 'checked' : ''}><span><strong>${PLATFORM_NAME[v.platform] ?? v.platform}</strong> <span class="muted">· ${v.label}</span></span>
            <span class="n ${len > v.charLimit ? 'over' : ''}" data-count="${v.id}">${len} / ${v.charLimit}</span></label>
          <textarea class="i ${len > v.charLimit ? 'over' : ''}" data-field="caption" data-card="${sid}" data-var="${v.id}" data-limit="${v.charLimit}" aria-label="${PLATFORM_NAME[v.platform] ?? v.platform} ${v.label} caption">${st.captions[v.id]}</textarea>
          ${card.variants.length > 1 ? html`<button type="button" class="sc-linkbtn ${st.lastEdited === v.id ? '' : 'hide'}" data-act="conform" data-card="${sid}" data-var="${v.id}" ${st.captions[v.id].trim() ? '' : 'disabled'}>Use for the other ${plural(card.variants.length - 1, 'account')}</button>` : ''}</div>`;
      })}</div>
      ${st.showWhen ? html`<div class="stack small"><span class="muted">When. Each platform goes out at its own time inside the window (Sydney).</span>
        <div class="sc-chips">${brand.windows.map((w) => (w.takenBy
          ? html`<span class="sc-chip taken" aria-disabled="true" title="Taken by ${w.takenBy}"><s>${w.label}</s> · taken: ${shorten(w.takenBy, 28)}</span>`
          : html`<button type="button" class="sc-chip ${ak === w.key && !st.otherTime ? 'on' : ''}" data-act="window" data-card="${sid}" data-key="${w.key}" ${dis}>${w.label} <span style="opacity:.65">· ${w.range}</span></button>`))}
          <button type="button" class="sc-chip ${st.otherTime ? 'on' : ''}" data-act="other" data-card="${sid}" ${dis}>Other time</button></div>
        ${st.weekendUnticked.length && !st.otherTime ? html`<span style="color:var(--warn)">LinkedIn is unticked for the weekend. Tick it again above if you want it included.</span>` : ''}
        ${st.otherTime ? html`<input class="i" type="datetime-local" aria-label="Other time (Sydney)" data-field="when" data-card="${sid}" value="${st.when}"><span class="muted">Other time sends to every platform at that one moment.</span>` : ''}</div>` : ''}
      <div class="row">
        <button class="btn" data-act="send" data-mode="draft" data-card="${sid}" ${dis}>Draft</button>
        <button class="btn" data-act="send" data-mode="schedule" data-card="${sid}" ${dis}>${st.showWhen && (st.otherTime ? st.when : ak) ? `Schedule: ${st.otherTime ? st.when.replace('T', ' ') : brand.windows.find((w) => w.key === ak)?.label ?? ''}` : 'Schedule'}</button>
        <button class="btn primary" data-act="send" data-mode="now" data-card="${sid}" ${dis}>Post now</button>
        <span class="muted small">${plural(images, 'image')}</span>
        <button class="btn ghost sm" style="margin-left:auto" data-act="close" data-card="${sid}">Close</button></div>
    </div></div></article>`;
}

function addHtml(brand) {
  const a = adders[brand.brand] ||= { open: false, q: '', found: [], msg: null, busy: null };
  if (!a.open) return html`<button class="btn" style="border-style:dashed" data-act="add-open" data-brand="${brand.brand}">Post something else from ${brand.label}</button>`;
  return html`<div class="sc-add" data-adder="${brand.brand}"><label class="f">Post something else from ${brand.label}
      <input class="i" type="search" placeholder="Search by title" data-field="add-q" data-brand="${brand.brand}" value="${a.q}" autocomplete="off"></label>
    <div data-found="${brand.brand}">${foundHtml(brand.brand)}</div>
    <button type="button" class="sc-linkbtn mt" data-act="add-close" data-brand="${brand.brand}">Close</button></div>`;
}

function foundHtml(b) {
  const a = adders[b];
  return html`${a.q.trim().length >= 2 && !a.found.length && !a.msg?.error ? html`<p class="muted small">Nothing matches.</p>` : ''}
    <ul class="sc-found">${a.found.map((i) => html`<li><img src="${i.thumb}" alt=""><div class="t"><div>${i.title}</div><div class="muted small">${i.detail}</div></div>
      <button class="btn sm primary" data-act="add" data-brand="${b}" data-id="${i.id}" ${a.busy ? 'disabled' : ''}>${a.busy === i.id ? 'Adding…' : 'Add to today'}</button></li>`)}</ul>
    ${a.msg ? html`<p role="status" class="small" style="${a.msg.error ? 'color:var(--danger)' : ''}">${a.msg.text} ${a.msg.date ? html`<a href="#/socials?date=${a.msg.date}">Open that day</a>` : ''}</p>` : ''}`;
}

/** Runs an action for one card: shows what is happening, then reloads the roster, as the source's run() did. */
async function run(sid, label, fn) {
  const st = ui.get(sid);
  st.error = null;
  st.busy = label;
  draw();
  try {
    const r = await fn();
    if (r?.warning) toast(r.warning);
  } catch (e) { st.error = e.message || 'Something went wrong. Try again.'; }
  st.busy = null;
  try { await reload(); } catch (e) { fail(e); draw(); }
}

function chooseWindow(card, st, w) {
  st.windowKey = w.key;
  st.otherTime = false;
  const linkedin = card.variants.filter((v) => v.platform === 'linkedin').map((v) => v.id);
  if (w.weekend) {
    const toUntick = linkedin.filter((id) => st.enabled[id]);
    if (toUntick.length) { for (const id of toUntick) st.enabled[id] = false; st.weekendUnticked = toUntick; }
  } else if (st.weekendUnticked.length) {
    for (const id of st.weekendUnticked) st.enabled[id] = true;
    st.weekendUnticked = [];
  }
}

async function doSend(card, brand, st, mode) {
  const ak = activeKey(st, brand.windows);
  if (mode === 'schedule' && !st.showWhen) {
    st.showWhen = true;
    const firstFree = brand.windows.find((w) => !w.takenBy);
    if (!ak && !st.when && firstFree) chooseWindow(card, st, firstFree);
    return draw();
  }
  if (mode === 'schedule' && !(st.otherTime ? st.when : ak)) return toast('Pick a window or another time first', true);
  if (mode === 'now' && !(await confirmBox('Post now?', 'Post now to all ticked accounts?', 'Post now'))) return;
  const captions = onScreen(card, st);
  const ticked = captions.filter((v) => v.enabled).length;
  const images = 1 + st.selected.length;
  const verb = mode === 'draft' ? 'Saving draft to' : mode === 'schedule' ? 'Scheduling on' : 'Posting to';
  const label = view.data.status.sending
    ? `${verb} ${plural(ticked, 'account')} in Publer. Uploading ${plural(images, 'image')}, this can take up to a minute`
    : `Dry run: building the Publer request for ${plural(ticked, 'account')}`;
  const body = { mode, captions, windowKey: mode === 'schedule' && !st.otherTime ? ak : undefined, otherTime: mode === 'schedule' && st.otherTime ? st.when : undefined };
  await run(card.suggestionId, label, () => api(`/api/socials/posts/${card.postId}/send`, { method: 'POST', body }));
}

let searchTimer;
function onInput(e) {
  const t = e.target;
  const f = t.dataset.field;
  if (!f) return;
  if (f === 'add-q') {
    const b = t.dataset.brand;
    const a = adders[b];
    a.q = t.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      if (a.q.trim().length < 2) { a.found = []; } else {
        try { a.found = (await api(`/api/socials/search?brand=${b}&q=${encodeURIComponent(a.q)}`)).items; a.msg = null; } catch { a.msg = { error: true, text: 'Search is not answering. Try again.' }; }
      }
      const box = view.el.querySelector(`[data-found="${b}"]`);
      if (box) render(box, foundHtml(b));
    }, 250);
    return;
  }
  const st = ui.get(t.dataset.card);
  if (!st) return;
  if (f === 'brief') st.brief = t.value;
  if (f === 'when') {
    st.when = t.value;
    const b = view.el.querySelector(`[data-card="${t.dataset.card}"][data-act="send"][data-mode="schedule"]`);
    if (b) b.textContent = st.when ? `Schedule: ${st.when.replace('T', ' ')}` : 'Schedule';
  }
  if (f === 'caption') {
    const vid = t.dataset.var;
    st.captions[vid] = t.value;
    const over = t.value.length > Number(t.dataset.limit);
    t.classList.toggle('over', over);
    const n = view.el.querySelector(`[data-count="${vid}"]`);
    if (n) { n.textContent = `${t.value.length} / ${t.dataset.limit}`; n.classList.toggle('over', over); }
    // Only the box last typed in offers to be reused for the others.
    st.lastEdited = vid;
    view.el.querySelectorAll(`[data-card="${t.dataset.card}"][data-act="conform"]`).forEach((b) => { b.classList.toggle('hide', b.dataset.var !== vid); if (b.dataset.var === vid) b.disabled = !t.value.trim(); });
  }
}

function onChange(e) {
  const t = e.target;
  const st = ui.get(t.dataset.card);
  if (!st) return;
  if (t.dataset.field === 'overwrite') st.overwrite = t.checked;
  if (t.dataset.field === 'enabled') {
    st.enabled[t.dataset.var] = t.checked;
    run(t.dataset.card, 'Saving', () => api(`/api/socials/variants/${t.dataset.var}`, { method: 'PATCH', body: { enabled: t.checked } }));
  }
}

/** Saves a caption when its box loses focus, quietly, so the next box keeps the cursor. */
async function onBlur(e) {
  const t = e.target;
  if (t.dataset?.field !== 'caption') return;
  const st = ui.get(t.dataset.card);
  const vid = t.dataset.var;
  if (!st || st.server[vid]?.caption === st.captions[vid]) return;
  const caption = st.captions[vid];
  try {
    await api(`/api/socials/variants/${vid}`, { method: 'PATCH', body: { caption } });
    st.server[vid] = { ...st.server[vid], caption };
  } catch (err) { fail(err); }
}

async function onClick(e) {
  const t = e.target.closest('[data-act]');
  if (!t || !view.el.contains(t)) return;
  e.preventDefault();
  const act = t.dataset.act;
  if (act === 'tab') { view.brand = t.dataset.brand; return draw(); }
  if (act.startsWith('add')) return onAdd(act, t);
  const sid = t.dataset.card;
  const { card, brand } = findCard(sid);
  if (!card) return;
  const st = ui.get(sid);
  const url = `/api/socials/posts/${card.postId}`;
  switch (act) {
    case 'open': st.open = true; return draw();
    case 'close': st.open = false; return draw();
    case 'later': return run(sid, 'Saving', () => api(`/api/socials/cards/${sid}/decide`, { method: 'POST', body: { decision: 'later' } }));
    case 'never':
      if (!(await confirmBox('Retire this image?', 'It leaves rotation for good. You can restore it from the Ledger.', 'Never'))) return;
      return run(sid, 'Saving', () => api(`/api/socials/cards/${sid}/decide`, { method: 'POST', body: { decision: 'never' } }));
    case 'regen': return run(sid, 'Writing new captions', () => api(`${url}/regenerate`, { method: 'POST', body: { brief: st.brief, overwrite: st.overwrite } }));
    case 'reset': return run(sid, 'Clearing', () => api(`${url}/reset-job`, { method: 'POST', body: {} }));
    case 'mention': {
      const m = card.mentions.find((x) => x.id === t.dataset.id);
      return run(sid, `Tagging ${m?.name ?? ''}`, () => api(`${url}/mention`, { method: 'POST', body: { mentionId: t.dataset.id, captions: onScreen(card, st) } }));
    }
    case 'sib': {
      const id = t.dataset.id;
      const next = st.selected.includes(id) ? st.selected.filter((s) => s !== id) : st.selected.length < 4 ? [...st.selected, id] : st.selected;
      if (next === st.selected) return toast('Up to 4 extra images', true);
      st.selected = next;
      return run(sid, 'Saving', () => api(`${url}/siblings`, { method: 'POST', body: { ids: next } }));
    }
    case 'primary': return run(sid, 'Saving', () => api(`${url}/primary`, { method: 'POST', body: { itemId: t.dataset.id } }));
    case 'conform': {
      const vid = t.dataset.var;
      const others = card.variants.filter((v) => v.id !== vid);
      const hand = others.filter((v) => v.edited || st.captions[v.id] !== v.caption).length;
      if (hand && !(await confirmBox('Replace your edits?', `This replaces your own edits on ${plural(hand, 'other account')}. Continue?`, 'Replace'))) return;
      return run(sid, `Copying this caption to the other ${plural(others.length, 'account')}`, () => api(`${url}/conform`, { method: 'POST', body: { variantId: vid, caption: st.captions[vid] } }));
    }
    case 'window': { const w = brand.windows.find((x) => x.key === t.dataset.key); if (w && !w.takenBy) chooseWindow(card, st, w); return draw(); }
    case 'other': st.otherTime = true; return draw();
    case 'send': return doSend(card, brand, st, t.dataset.mode);
  }
}

async function onAdd(act, t) {
  const b = t.dataset.brand;
  const a = adders[b];
  if (act === 'add-open') { a.open = true; draw(); view.el.querySelector(`[data-field="add-q"][data-brand="${b}"]`)?.focus(); return; }
  if (act === 'add-close') { a.open = false; a.msg = null; return draw(); }
  const item = a.found.find((i) => i.id === t.dataset.id);
  if (!item) return;
  a.busy = item.id;
  a.msg = { error: false, text: `Adding ${item.title} and writing its captions…` };
  render(view.el.querySelector(`[data-found="${b}"]`), foundHtml(b));
  try {
    const r = await api('/api/socials/cards', { method: 'POST', body: { itemId: item.id } });
    a.msg = { error: false, text: r.warning ? `Added to today. ${r.warning}` : 'Added to today.', date: r.date === view.data.date ? undefined : r.date };
    a.q = ''; a.found = [];
  } catch (e) {
    a.msg = { error: true, text: e.message, date: e.data?.date };
  }
  a.busy = null;
  await reload();
}

// ---------------------------------------------------------------------------------------------- ledger
export async function ledger(el) {
  const d = await api('/api/socials/ledger');
  const fmt = (iso) => (iso ? clock(iso, true) : '');
  const postRow = (p) => html`<tr><td style="width:52px">${p.thumb ? html`<img class="sc-thumb" src="${p.thumb}" alt="">` : ''}</td>
    <td><strong>${p.title}</strong>${p.extra > 0 ? html` <span class="muted">(+${p.extra})</span>` : ''}${p.error?.startsWith('partial:') ? html`<div class="small" style="color:var(--warn)">not ${p.error.slice(8).split(',').join(', ')}</div>` : ''}</td>
    <td class="right nowrap ${p.state === 'failed' ? '' : 'muted'}" style="${p.state === 'failed' ? 'color:var(--danger)' : ''}">${p.state === 'failed' ? 'failed' : `${p.mode ?? p.state} · ${fmt(p.scheduledAt ?? p.sentAt)}${p.scheduledUntil ? ` to ${clock(p.scheduledUntil, false)}` : ''}`}</td></tr>`;
  render(el, html`${STYLE}
    <div class="crumbs"><a href="#/socials">Socials</a> /</div>
    <div class="page-head"><div><h1>Ledger <em>last 30 days</em></h1><p>What went to Publer for each brand, the dry runs, and every retired image.</p></div>
      <div class="row"><a class="btn" href="#/socials">Today</a></div></div>
    <div class="row" style="margin-bottom:14px">
      <span class="pill ${d.status.sending ? '' : 'grey'}">Sending ${d.status.sending ? 'on' : 'off (dry run)'}</span>
      <span class="pill ${d.status.jobs ? '' : 'grey'}">Daily jobs ${d.status.jobs ? 'on' : 'off'}</span>
      <span class="pill ${d.status.captions ? '' : 'warn'}">Captions ${d.status.captions ? d.status.model : 'not set up'}</span>
      <span class="pill ${d.status.shopify ? '' : 'warn'}">Shopify ${d.status.shopify ? 'set up' : 'not set up'}</span></div>
    <div class="grid g3">${d.brands.map((b) => html`<div class="card"><div class="card-head"><h2>${b.label}</h2><span class="muted small">${plural(b.posts.length, 'post')}</span></div>
      ${b.posts.length ? html`<table class="t"><tbody>${b.posts.map(postRow)}</tbody></table>` : html`<div class="empty">Nothing yet.</div>`}</div>`)}</div>
    <div class="card mt"><div class="card-head"><h2>Dry runs</h2><span class="muted small">built while sending is off; nothing went to Publer</span></div>
      ${d.dryRuns.length ? html`<table class="t"><tbody>${d.dryRuns.map((p) => html`<tr><td style="width:52px">${p.thumb ? html`<img class="sc-thumb" src="${p.thumb}" alt="">` : ''}</td>
        <td><strong>${p.title}</strong> <span class="muted small">${p.brand}</span><details><summary class="small">${MODE_WORD[p.dryRun.mode] ?? p.dryRun.mode}: ${plural(p.dryRun.requests.length, 'request')}, ${plural(p.dryRun.uploads.length, 'upload')}</summary><pre class="small" style="max-height:300px;overflow:auto;white-space:pre-wrap;word-break:break-all">${JSON.stringify({ uploads: p.dryRun.uploads, requests: p.dryRun.requests }, null, 2)}</pre></details></td>
        <td class="right nowrap muted">${fmt(p.dryRunAt)}</td></tr>`)}</tbody></table>` : html`<div class="empty">No dry runs yet.</div>`}</div>
    <div class="card mt"><div class="card-head"><h2>Retired <span class="muted" style="font-weight:400">(${d.retired.length})</span></h2></div>
      ${d.retired.length ? html`<table class="t"><tbody>${d.retired.map((i) => html`<tr><td style="width:52px"><img class="sc-thumb" src="${i.thumb}" alt=""></td><td>${i.title} <span class="muted small">· ${({ gallery: 'Kess Gallery', kessmedia: 'Kess Media', alexkess: 'Alex Kess' })[i.brand]} · ${i.reason === 'never' ? 'Never' : 'gone from the source'}</span></td>
        <td class="right"><button class="btn sm" data-restore="${i.id}">Restore</button></td></tr>`)}</tbody></table>` : html`<div class="empty">Nothing retired.</div>`}</div>
    ${isOwner() ? html`<div class="card mt"><div class="card-head"><h2>Run a job now</h2></div>
      <p class="muted small" style="margin-top:0">Like the Run button on the Vercel crons. While the Vercel app is still live, prefer re-running the import over Suggest, so both apps hold the same cards.</p>
      <div class="row"><button class="btn sm" data-run="sync">Sync sources</button><button class="btn sm" data-run="suggest">Suggest today</button><button class="btn sm" data-run="recaption">Fill missing captions</button></div>
      <pre class="small mt hide" id="runout" style="white-space:pre-wrap"></pre></div>` : ''}`);
  el.querySelectorAll('[data-restore]').forEach((b) => b.onclick = async () => { b.disabled = true; try { await api(`/api/socials/items/${b.dataset.restore}/restore`, { method: 'POST', body: {} }); toast('Restored to rotation'); ledger(el); } catch (e) { fail(e); b.disabled = false; } });
  el.querySelectorAll('[data-run]').forEach((b) => b.onclick = async () => {
    const out = el.querySelector('#runout');
    b.disabled = true;
    try { const r = await api(`/api/socials/run/${b.dataset.run}`, { method: 'POST', body: {} }); out.textContent = JSON.stringify(r, null, 2); out.classList.remove('hide'); toast('Done'); } catch (e) { fail(e); }
    b.disabled = false;
  });
}
