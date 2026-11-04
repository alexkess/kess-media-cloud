// Kess Cloud feedback overlay: pin comments, highlight text and draw on a page.
// Loaded on /preview/<site>/...?feedback=1 (signed-in) and /review/<token>/... (review links).
// Everything lives in a shadow root so the client site's CSS can't touch it (and vice versa).
// User text is only ever inserted as text nodes (never parsed as HTML).
(() => {
  const cfg = JSON.parse(document.currentScript.dataset.config);
  const guest = cfg.mode === 'guest';
  const store = { get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
  let items = [];
  let mode = 'idle'; // idle | comment | draw
  let showResolved = false, hidden = false, panelOpen = false, openId = null, skipClick = false;

  // ---------- DOM helpers ----------
  function h(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'class') e.className = v;
      else if (k === 'style') e.style.cssText = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
    return e;
  }
  // replaceChildren() would print null/false as text, so filter them out.
  const fill = (parent, ...kids) => parent.replaceChildren(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false));
  const svg = (tag, attrs = {}) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const ago = (s) => { const m = Math.round((Date.now() - new Date(s.replace(' ', 'T') + 'Z')) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
  const docSize = () => ({ w: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth), h: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) });

  async function api(path, method = 'GET', body) {
    const r = await fetch(cfg.api + path, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Kess': '1' }, body: body ? JSON.stringify(body) : undefined });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
    return data;
  }

  // ---------- shadow root ----------
  const host = h('div', { id: 'kess-feedback', style: 'position:absolute;top:0;left:0;width:0;height:0;z-index:2147483000' });
  const root = host.attachShadow({ mode: 'open' });
  root.append(h('style', {}, `
    :host{all:initial}*{box-sizing:border-box;font-family:Inter,system-ui,-apple-system,sans-serif}
    .layer{position:absolute;top:0;left:0;pointer-events:none}
    .layer svg{position:absolute;top:0;left:0;overflow:visible}
    .capture{position:absolute;top:0;left:0;display:none;cursor:crosshair;touch-action:none;pointer-events:auto}
    .capture.on{display:block}
    .hover{position:absolute;border:2px solid #7BBF9A;background:rgba(123,191,154,.12);border-radius:3px;display:none;pointer-events:none}
    .hl{position:absolute;background:rgba(255,214,0,.35);border-bottom:2px solid #e0b400;pointer-events:none}
    .pin{position:absolute;width:28px;height:28px;margin:-28px 0 0 -4px;border-radius:14px 14px 14px 2px;background:#1E5C34;color:#fff;font:700 12px/28px Inter,system-ui;text-align:center;pointer-events:auto;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.35);border:2px solid #fff;transition:transform .1s}
    .pin:hover,.pin.on{transform:scale(1.15)}.pin.resolved{background:#8a8a8a}.pin.mine{background:#1a1a1a;color:#7BBF9A}
    .bar{position:fixed;right:16px;bottom:16px;display:flex;gap:4px;align-items:center;background:#1a1a1a;color:#F2EDE6;border-radius:999px;padding:5px;box-shadow:0 8px 30px rgba(0,0,0,.35);pointer-events:auto;font-size:13px}
    .bar button{all:unset;cursor:pointer;padding:8px 13px;border-radius:999px;font:600 13px Inter,system-ui;color:#F2EDE6;display:flex;gap:6px;align-items:center}
    .bar button:hover{background:#2c2c2c}.bar button.on{background:#7BBF9A;color:#1a1a1a}
    .bar .count{background:#7BBF9A;color:#1a1a1a;border-radius:99px;padding:0 7px;font-size:11px}
    .bar .lbl{padding:0 8px 0 10px;color:#aaa;font-size:12px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .hint{position:fixed;left:50%;top:14px;transform:translateX(-50%);background:#1E5C34;color:#fff;font:600 13px Inter,system-ui;padding:8px 16px;border-radius:99px;box-shadow:0 4px 18px rgba(0,0,0,.3);pointer-events:none}
    .pop{position:absolute;width:320px;background:#fff;color:#1a1a1a;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.3);pointer-events:auto;font-size:13px;line-height:1.45;overflow:hidden}
    .pop header{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:#F6F4F0;border-bottom:1px solid #eee;font-weight:700}
    .pop .body{padding:12px;max-height:340px;overflow:auto}
    .pop textarea,.pop input{width:100%;border:1px solid #d6d2cb;border-radius:8px;padding:8px 10px;font:13px Inter,system-ui;resize:vertical;margin:0 0 8px;color:#1a1a1a;background:#fff}
    .pop textarea:focus,.pop input:focus{outline:2px solid #7BBF9A;border-color:#1E5C34}
    .row{display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap}
    .btn{all:unset;cursor:pointer;padding:6px 12px;border-radius:99px;border:1px solid #ddd;font:600 12px Inter,system-ui;color:#1a1a1a;background:#fff}
    .btn.primary{background:#1E5C34;border-color:#1E5C34;color:#fff}.btn.ghost{border-color:transparent}.btn.danger{color:#B3261E}
    .msg{margin-bottom:10px}.msg .meta{color:#777;font-size:11.5px;margin-bottom:2px}.msg p{margin:0;white-space:pre-wrap;word-wrap:break-word}
    .reply{border-left:3px solid #E8EDE6;padding-left:9px}
    .quote{background:#FFF6CC;border-radius:6px;padding:4px 8px;margin-bottom:8px;font-style:italic}
    .tag{display:inline-block;font-size:10.5px;font-weight:700;padding:0 7px;border-radius:99px;background:#E8EDE6;color:#1E5C34;margin-left:4px}
    .x{all:unset;cursor:pointer;font-size:18px;line-height:1;color:#777;padding:0 4px}
    .panel{position:fixed;top:0;right:0;bottom:0;width:340px;max-width:92vw;background:#fff;color:#1a1a1a;box-shadow:-8px 0 30px rgba(0,0,0,.2);pointer-events:auto;display:flex;flex-direction:column;font-size:13px}
    .panel header{padding:14px 16px;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center}
    .panel h2{margin:0;font-size:15px}.panel .sub{color:#777;font-size:12px}
    .panel .list{overflow:auto;flex:1}.panel .it{display:flex;gap:10px;padding:11px 16px;border-bottom:1px solid #f1efea;cursor:pointer}
    .panel .it:hover{background:#F6F8F5}.panel .n{flex:none;width:24px;height:24px;border-radius:12px;background:#1E5C34;color:#fff;font:700 11px/24px Inter;text-align:center}
    .panel .it.resolved .n{background:#999}.panel .it p{margin:2px 0 0;color:#444;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
    .panel footer{padding:10px 16px;border-top:1px solid #eee;font-size:12px;display:flex;justify-content:space-between;align-items:center}
    .empty{padding:24px 16px;color:#777;text-align:center}
    .toasts{position:fixed;left:50%;bottom:80px;transform:translateX(-50%);display:flex;flex-direction:column;gap:6px;align-items:center;pointer-events:none}
    .toast{background:#1a1a1a;color:#fff;padding:9px 16px;border-radius:10px;font:13px Inter,system-ui;box-shadow:0 4px 16px rgba(0,0,0,.25)}
    .toast.err{background:#B3261E}
    @media (max-width:600px){.bar .lbl{display:none}.pop{width:calc(100vw - 24px)}}
  `));
  const layer = h('div', { class: 'layer' });
  const drawSvg = svg('svg');
  const pinsBox = h('div');
  const hover = h('div', { class: 'hover' });
  const capture = h('div', { class: 'capture' });
  const liveSvg = svg('svg', { style: 'position:absolute;top:0;left:0;overflow:visible;pointer-events:none' });
  layer.append(drawSvg, pinsBox, hover);
  capture.append(liveSvg);
  const popBox = h('div');
  const toasts = h('div', { class: 'toasts' });
  const ui = h('div');
  root.append(layer, capture, popBox, ui, toasts);

  function toast(text, err) {
    const t = h('div', { class: 'toast' + (err ? ' err' : '') }, text);
    toasts.append(t); setTimeout(() => t.remove(), err ? 5000 : 2500);
  }

  // ---------- anchoring ----------
  const sections = () => [...document.querySelectorAll('main > section')];
  function selectorFor(el) {
    const parts = [];
    for (let e = el; e && e !== document.body && e.nodeType === 1; e = e.parentElement) {
      const tag = e.tagName.toLowerCase();
      const same = e.parentElement ? [...e.parentElement.children].filter((c) => c.tagName === e.tagName) : [];
      parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(e) + 1})` : tag);
    }
    return ['body', ...parts].join(' > ');
  }
  const sectionOf = (el) => { const s = el?.closest?.('main > section'); return s ? sections().indexOf(s) : -1; };
  function anchorEl(a) {
    let el = null;
    try { el = a.selector ? document.querySelector(a.selector) : null; } catch {}
    if (!el && a.section >= 0) el = sections()[a.section] || null;
    return el;
  }
  const absRect = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: r.width || 1, h: r.height || 1 }; };
  function pointFor(item) {
    const a = item.anchor; const el = anchorEl(a);
    if (el) {
      const r = absRect(el);
      if (item.kind === 'draw' && item.shape.points?.length) { const [px, py] = item.shape.points[0]; return { x: r.x + px * r.w, y: r.y + py * r.h }; }
      if (item.kind === 'text') {
        const rects = quoteRects(el, a.quote);
        if (rects?.length) { const last = rects[rects.length - 1]; return { x: last.x + last.w, y: last.y }; }
        if (item.shape.box) return { x: r.x + item.shape.box.x * r.w + item.shape.box.w * r.w, y: r.y + item.shape.box.y * r.h };
      }
      return { x: r.x + a.fx * r.w, y: r.y + a.fy * r.h };
    }
    return { x: a.docX * docSize().w, y: a.docY };
  }
  // Find the quoted text inside the anchor element so highlights follow reflowed lines.
  function quoteRects(el, quote) {
    if (!el || !quote) return null;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes = []; let text = '';
    for (let n = walker.nextNode(); n; n = walker.nextNode()) { nodes.push([n, text.length]); text += n.nodeValue; }
    const norm = (t) => t.replace(/\s+/g, ' ');
    // map whitespace-normalised positions back to raw offsets
    const map = []; let out = '';
    for (let i = 0; i < text.length; i++) { const c = /\s/.test(text[i]) ? ' ' : text[i]; if (c === ' ' && out.endsWith(' ')) continue; out += c; map.push(i); }
    const at = out.indexOf(norm(quote).trim());
    if (at < 0) return null;
    const start = map[at], end = map[at + norm(quote).trim().length - 1] + 1;
    const pos = (o) => { for (let i = nodes.length - 1; i >= 0; i--) if (nodes[i][1] <= o) return [nodes[i][0], Math.min(o - nodes[i][1], nodes[i][0].nodeValue.length)]; return null; };
    const a = pos(start), b = pos(end); if (!a || !b) return null;
    const range = document.createRange(); range.setStart(...a); range.setEnd(...b);
    return [...range.getClientRects()].filter((r) => r.width > 1).map((r) => ({ x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }));
  }

  function elementAt(x, y) { host.style.display = 'none'; const el = document.elementFromPoint(x, y); host.style.display = ''; return el; }

  // ---------- rendering ----------
  const pageItems = () => items.filter((i) => i.page_slug === cfg.page);
  const visible = () => pageItems().filter((i) => showResolved || i.status === 'open');
  const numberOf = (item) => pageItems().indexOf(item) + 1;

  function render() {
    const { w, h: dh } = docSize();
    for (const e of [layer, capture]) { e.style.width = w + 'px'; e.style.height = dh + 'px'; }
    for (const s of [drawSvg, liveSvg]) { s.setAttribute('width', w); s.setAttribute('height', dh); }
    drawSvg.replaceChildren(); pinsBox.replaceChildren();
    if (!hidden) for (const item of visible()) {
      const el = anchorEl(item.anchor);
      const colour = item.status === 'resolved' ? '#9a9a9a' : '#E5484D';
      if (el && item.kind === 'draw' && item.shape.points) {
        const r = absRect(el);
        const d = item.shape.points.map(([px, py], i) => `${i ? 'L' : 'M'}${(r.x + px * r.w).toFixed(1)} ${(r.y + py * r.h).toFixed(1)}`).join(' ');
        drawSvg.append(svg('path', { d, fill: 'none', stroke: colour, 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: item.status === 'resolved' ? 0.5 : 0.9 }));
      }
      if (el && item.kind === 'text') {
        const r = absRect(el), b = item.shape.box;
        const rects = quoteRects(el, item.anchor.quote) || (b ? [{ x: r.x + b.x * r.w, y: r.y + b.y * r.h, w: b.w * r.w, h: b.h * r.h }] : []);
        for (const q of rects) pinsBox.append(h('div', { class: 'hl', style: `left:${q.x}px;top:${q.y}px;width:${q.w}px;height:${q.h}px;opacity:${item.status === 'resolved' ? 0.4 : 1}` }));
      }
      const p = pointFor(item);
      pinsBox.append(h('div', { class: `pin ${item.status === 'resolved' ? 'resolved' : ''} ${openId === item.id ? 'on' : ''}`, style: `left:${p.x}px;top:${p.y}px`, title: item.body.slice(0, 80), onclick: (e) => { e.stopPropagation(); openThread(item); } }, String(numberOf(item))));
    }
    renderBar();
    if (panelOpen) renderPanel();
  }

  function renderBar() {
    const open = pageItems().filter((i) => i.status === 'open').length;
    const btn = (key, label, title, fn) => h('button', { class: mode === key ? 'on' : '', title, onclick: fn }, label);
    fill(ui,
      h('div', { class: 'bar' },
        h('span', { class: 'lbl', title: cfg.label }, cfg.label || 'Feedback'),
        btn('comment', '💬 Comment', 'Click anything on the page, or select text, to comment', () => setMode(mode === 'comment' ? 'idle' : 'comment')),
        btn('draw', '✏️ Draw', 'Circle or mark something, then add a comment', () => setMode(mode === 'draw' ? 'idle' : 'draw')),
        h('button', { class: panelOpen ? 'on' : '', title: 'All comments on this page', onclick: () => { panelOpen = !panelOpen; render(); } }, 'List', h('span', { class: 'count' }, String(open))),
        h('button', { title: hidden ? 'Show comments' : 'Hide comments to see the page clearly', onclick: () => { hidden = !hidden; render(); } }, hidden ? '👁 Show' : '🙈 Hide')),
      mode === 'comment' ? h('div', { class: 'hint' }, 'Click anything to pin a comment, or select some text. Esc to stop.') : null,
      mode === 'draw' ? h('div', { class: 'hint' }, 'Draw a circle or arrow on the page, then add your comment. Esc to stop.') : null,
      panelOpen ? h('div', { class: 'panel', id: 'panel' }) : null,
    );
  }

  function renderPanel() {
    const panel = ui.querySelector('#panel'); if (!panel) return;
    const list = pageItems().filter((i) => showResolved || i.status === 'open');
    const others = items.filter((i) => i.page_slug !== cfg.page && i.status === 'open');
    fill(panel,
      h('header', {}, h('div', {}, h('h2', {}, 'Comments on this page'), h('div', { class: 'sub' }, `${pageItems().filter((i) => i.status === 'open').length} open · ${pageItems().filter((i) => i.status === 'resolved').length} resolved`)), h('button', { class: 'x', title: 'Close', onclick: () => { panelOpen = false; render(); } }, '×')),
      h('div', { class: 'list' }, list.length ? list.map((i) => h('div', { class: `it ${i.status}`, onclick: () => { scrollTo({ top: Math.max(0, pointFor(i).y - 160), behavior: 'smooth' }); openThread(i); } },
        h('span', { class: 'n' }, String(numberOf(i))),
        h('div', {}, h('strong', {}, i.author), h('span', { style: 'color:#888;font-size:11.5px' }, ` · ${ago(i.created_at)}${i.replies.length ? ` · ${i.replies.length} repl${i.replies.length === 1 ? 'y' : 'ies'}` : ''}`), h('p', {}, i.body))))
        : h('div', { class: 'empty' }, 'No comments here yet. Use Comment or Draw to add one.'),
      others.length ? h('div', { class: 'empty', style: 'text-align:left;padding:12px 16px' }, `${others.length} open on other pages: `, ...[...new Set(others.map((o) => o.page_slug))].map((s) => h('a', { href: pageLink(s), style: 'color:#1E5C34;margin-right:8px' }, '/' + s))) : null),
      h('footer', {}, h('label', {}, h('input', { type: 'checkbox', checked: showResolved, onchange: (e) => { showResolved = e.target.checked; render(); } }), ' Show resolved'), h('span', { style: 'color:#888' }, guest ? 'Kess Media sees every comment' : '')),
    );
  }
  function pageLink(slug) {
    const u = new URL(location.href);
    u.pathname = u.pathname.replace(new RegExp(`/${cfg.page.replace(/[-]/g, '\\-')}/?$`), '/').replace(/\/?$/, '/') + slug;
    u.searchParams.delete('fb');
    return u.toString();
  }

  // ---------- modes ----------
  function setMode(m) {
    mode = m;
    capture.classList.toggle('on', m === 'draw');
    hover.style.display = 'none';
    document.documentElement.style.cursor = m === 'comment' ? 'crosshair' : '';
    closePop();
    render();
  }
  const fromOverlay = (e) => e.composedPath().includes(host);

  document.addEventListener('mousemove', (e) => {
    if (mode !== 'comment' || fromOverlay(e)) { hover.style.display = 'none'; return; }
    const el = e.target; if (!(el instanceof Element) || el === document.documentElement || el === document.body) return;
    const r = absRect(el);
    Object.assign(hover.style, { display: 'block', left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
  }, true);

  document.addEventListener('mouseup', (e) => {
    if (mode !== 'comment' || fromOverlay(e)) return;
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
    const range = sel.getRangeAt(0);
    let el = range.commonAncestorContainer; if (el.nodeType !== 1) el = el.parentElement;
    const r = absRect(el), rr = range.getBoundingClientRect();
    const box = { x: (rr.left + scrollX - r.x) / r.w, y: (rr.top + scrollY - r.y) / r.h, w: rr.width / r.w, h: rr.height / r.h };
    skipClick = true; setTimeout(() => { skipClick = false; }, 300);
    compose({ kind: 'text', anchor: { selector: selectorFor(el), section: sectionOf(el), fx: box.x + box.w, fy: box.y, quote: sel.toString().trim().slice(0, 500), tag: el.tagName.toLowerCase(), docX: (rr.right + scrollX) / docSize().w, docY: rr.top + scrollY }, shape: { box } },
      { x: rr.right + scrollX, y: rr.bottom + scrollY + 8 });
  }, true);

  document.addEventListener('click', (e) => {
    if (mode !== 'comment' || fromOverlay(e)) return;
    e.preventDefault(); e.stopPropagation();
    if (skipClick) return;
    const el = e.target instanceof Element ? e.target : e.target.parentElement;
    const r = absRect(el);
    const x = e.pageX, y = e.pageY;
    compose({ kind: 'pin', anchor: { selector: selectorFor(el), section: sectionOf(el), fx: (x - r.x) / r.w, fy: (y - r.y) / r.h, tag: el.tagName.toLowerCase(), docX: x / docSize().w, docY: y } }, { x: x + 12, y: y + 8 });
    hover.style.display = 'none';
  }, true);
  document.addEventListener('submit', (e) => { if (mode === 'comment') e.preventDefault(); }, true);

  // drawing
  let stroke = null;
  capture.addEventListener('pointerdown', (e) => {
    closePop();
    stroke = { pts: [[e.pageX, e.pageY]], path: svg('path', { fill: 'none', stroke: '#E5484D', 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }) };
    liveSvg.replaceChildren(stroke.path);
    capture.setPointerCapture(e.pointerId);
  });
  capture.addEventListener('pointermove', (e) => {
    if (!stroke) return;
    const [lx, ly] = stroke.pts[stroke.pts.length - 1];
    if (Math.hypot(e.pageX - lx, e.pageY - ly) < 3) return;
    stroke.pts.push([e.pageX, e.pageY]);
    stroke.path.setAttribute('d', stroke.pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' '));
  });
  capture.addEventListener('pointerup', () => {
    if (!stroke) return;
    const pts = stroke.pts; stroke = null;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const bb = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    if (pts.length < 3 || (bb.w < 8 && bb.h < 8)) { liveSvg.replaceChildren(); return; }
    const cx = bb.x + bb.w / 2 - scrollX, cy = bb.y + bb.h / 2 - scrollY;
    const hit = elementAt(cx, cy);
    const el = hit?.closest?.('main > section') || hit || document.body;
    const r = absRect(el);
    const step = Math.max(1, Math.ceil(pts.length / 300));
    const points = pts.filter((_, i) => i % step === 0 || i === pts.length - 1).map(([x, y]) => [(x - r.x) / r.w, (y - r.y) / r.h]);
    compose({ kind: 'draw', anchor: { selector: selectorFor(el), section: sectionOf(el), fx: (bb.x - r.x) / r.w, fy: (bb.y - r.y) / r.h, docX: bb.x / docSize().w, docY: bb.y }, shape: { points } },
      { x: bb.x + bb.w + 12, y: bb.y }, () => liveSvg.replaceChildren());
  });

  // ---------- popups ----------
  function closePop() { popBox.replaceChildren(); if (openId) { openId = null; render(); } }
  function place(pop, at) {
    const w = Math.min(320, innerWidth - 24);
    const x = Math.min(Math.max(scrollX + 12, at.x), scrollX + innerWidth - w - 12);
    const y = Math.min(Math.max(scrollY + 12, at.y), scrollY + innerHeight - 260);
    pop.style.left = x + 'px'; pop.style.top = y + 'px';
    popBox.replaceChildren(pop);
  }
  function guestFields() {
    if (!guest) return [];
    const me = store.get('kc-reviewer') || {};
    return [h('input', { name: 'guest_name', placeholder: 'Your name', value: me.name || '', required: true, autocomplete: 'name' }), h('input', { name: 'guest_email', type: 'email', placeholder: 'Email (optional, for replies)', value: me.email || '', autocomplete: 'email' })];
  }
  function guestValues(form) {
    if (!guest) return {};
    const v = { guest_name: form.querySelector('[name=guest_name]').value.trim(), guest_email: form.querySelector('[name=guest_email]').value.trim() };
    store.set('kc-reviewer', { name: v.guest_name, email: v.guest_email });
    return v;
  }

  function compose(draft, at, onCancel) {
    closePop();
    const text = h('textarea', { rows: 4, placeholder: draft.kind === 'draw' ? 'What should change here?' : 'What should change?', required: true });
    const cancel = () => { popBox.replaceChildren(); onCancel?.(); };
    const form = h('form', { class: 'body', onsubmit: async (e) => {
      e.preventDefault();
      if (!text.value.trim()) return text.focus();
      const btn = form.querySelector('.primary'); btn.textContent = 'Posting…';
      try {
        const item = await api('/feedback', 'POST', { ...draft, ...guestValues(form), body: text.value, page_slug: cfg.page, version: cfg.version, viewport_w: innerWidth });
        items.push(item); popBox.replaceChildren(); liveSvg.replaceChildren(); onCancel = null;
        toast('Comment added'); render();
      } catch (err) { btn.textContent = 'Post'; toast(err.message, true); }
    } },
    draft.anchor.quote ? h('div', { class: 'quote' }, `“${draft.anchor.quote.slice(0, 160)}”`) : null,
    text, ...guestFields(),
    h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn ghost', onclick: cancel }, 'Cancel'), h('button', { type: 'submit', class: 'btn primary' }, 'Post')));
    const pop = h('div', { class: 'pop', onkeydown: (e) => { if (e.key === 'Escape') cancel(); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) form.requestSubmit(); } },
      h('header', {}, draft.kind === 'draw' ? 'Comment on your drawing' : draft.kind === 'text' ? 'Comment on the selected text' : 'New comment', h('button', { class: 'x', type: 'button', onclick: cancel }, '×')), form);
    place(pop, at);
    setTimeout(() => text.focus(), 0);
  }

  function openThread(item) {
    openId = item.id;
    render();
    const msg = (who, kind, when, body) => h('div', { class: 'msg' }, h('div', { class: 'meta' }, h('strong', {}, who), kind === 'agency' ? h('span', { class: 'tag' }, 'Kess Media') : kind === 'guest' ? h('span', { class: 'tag' }, 'guest') : null, ` · ${ago(when)}`), h('p', {}, body));
    const reply = h('textarea', { rows: 2, placeholder: 'Reply…' });
    const canResolve = !guest && (cfg.agency || item.mine);
    const act = async (fn, okMsg) => { try { await fn(); toast(okMsg); await load(); const again = items.find((i) => i.id === item.id); if (again) openThread(again); else closePop(); } catch (e) { toast(e.message, true); } };
    const form = h('form', { onsubmit: (e) => { e.preventDefault(); if (!reply.value.trim()) return; act(() => api(`/feedback/${item.id}/replies`, 'POST', { body: reply.value, ...guestValues(form) }), 'Reply sent'); } },
      reply, ...(guest && !(store.get('kc-reviewer') || {}).name ? guestFields() : guest ? [h('input', { type: 'hidden', name: 'guest_name', value: store.get('kc-reviewer').name }), h('input', { type: 'hidden', name: 'guest_email', value: store.get('kc-reviewer').email || '' })] : []),
      h('div', { class: 'row' },
        canResolve ? h('button', { type: 'button', class: 'btn', onclick: () => act(() => api(`/feedback/${item.id}`, 'PATCH', { status: item.status === 'open' ? 'resolved' : 'open' }), item.status === 'open' ? 'Resolved' : 'Reopened') }, item.status === 'open' ? '✓ Resolve' : 'Reopen') : null,
        cfg.agency ? h('button', { type: 'button', class: 'btn', title: 'Add to the requests board', onclick: () => act(async () => { const r = await api(`/feedback/${item.id}/request`, 'POST', {}); window.open(`/#/requests/${r.request_id}`, '_blank'); }, 'Request created') }, item.request_id ? 'Open request' : '→ Request') : null,
        h('button', { type: 'submit', class: 'btn primary' }, 'Reply')));
    const pop = h('div', { class: 'pop', onkeydown: (e) => { if (e.key === 'Escape') closePop(); } },
      h('header', {}, h('span', {}, `#${numberOf(item)} `, item.status === 'resolved' ? h('span', { class: 'tag' }, 'resolved') : null, item.version !== cfg.version ? h('span', { class: 'tag', title: 'Left on a different version' }, item.version) : null),
        h('span', {}, cfg.agency || item.mine ? h('button', { class: 'x', title: 'Delete', onclick: () => { if (confirm('Delete this comment?')) act(() => api(`/feedback/${item.id}`, 'DELETE'), 'Deleted'); } }, '🗑') : null, h('button', { class: 'x', onclick: closePop }, '×'))),
      h('div', { class: 'body' },
        item.anchor.quote ? h('div', { class: 'quote' }, `“${item.anchor.quote.slice(0, 200)}”`) : null,
        msg(item.author, item.author_kind, item.created_at, item.body),
        item.viewport_w && item.viewport_w < 700 ? h('div', { class: 'meta', style: 'color:#777;font-size:11.5px;margin:-6px 0 8px' }, `📱 left on a ${item.viewport_w}px-wide screen`) : null,
        ...item.replies.map((r) => h('div', { class: 'reply' }, msg(r.author, r.author_kind, r.created_at, r.body))),
        form));
    const p = pointFor(item);
    place(pop, { x: p.x + 24, y: p.y - 10 });
  }

  // ---------- boot ----------
  async function load() {
    try { items = await api('/feedback'); } catch (e) { toast(e.message, true); }
    render();
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.composedPath().includes(host)) { if (popBox.childNodes.length) closePop(); else if (mode !== 'idle') setMode('idle'); } });
  addEventListener('resize', () => render());
  new ResizeObserver(() => render()).observe(document.body);
  document.body.append(host);
  load().then(() => {
    const f = cfg.focus && items.find((i) => i.id === cfg.focus);
    if (f) { if (f.status === 'resolved') showResolved = true; setTimeout(() => { scrollTo({ top: Math.max(0, pointFor(f).y - 160) }); openThread(f); }, 400); }
    else if (!items.some((i) => i.page_slug === cfg.page)) setTimeout(() => toast(guest ? 'Use Comment or Draw (bottom right) to leave feedback' : 'Feedback mode: use Comment or Draw (bottom right)'), 600);
  });
  // Re-place pins while late fonts and images settle.
  let n = 0; const settle = setInterval(() => { render(); if (++n > 8) clearInterval(settle); }, 500);
})();
