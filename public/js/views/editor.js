import { api, html, raw, render, esc, modal, field, toast, fail, confirmBox, isAgency, state, uploadFiles } from '../lib.js';

const { SECTION_TYPES, blankSection } = await import('/shared/sections.js');

function summary(s) {
  if (s.heading) return `${s.heading}${s.accent ? ' ' + s.accent : ''}`;
  const list = s.items || s.images;
  if (list?.length) return list[0].title || list[0].value || list[0].q || `${list.length} items`;
  return '';
}

function inputFor(f, value, path, locked) {
  const dis = locked ? ' disabled' : '';
  const name = `data-path="${esc(path)}"`;
  switch (f.type) {
    case 'textarea': return `<textarea class="i" rows="3" ${name}${dis}>${esc(value)}</textarea>`;
    case 'richtext': return `<textarea class="i" rows="7" ${name}${dis}>${esc(value)}</textarea>`;
    case 'boolean': return `<input type="checkbox" ${name}${value === true || value === 'true' ? ' checked' : ''}${dis}>`;
    case 'select': return `<select class="i" ${name}${dis}>${f.options.map((o) => `<option${o === value ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    case 'image': return `<div class="img-field"><input class="i" ${name} value="${esc(value)}" placeholder="https://… or pick a file"${dis}><button type="button" class="btn sm" data-pick="${esc(path)}"${dis}>Files</button></div>${value ? `<img class="thumb" src="${esc(value)}" alt="">` : ''}`;
    default: return `<input class="i" ${name} value="${esc(value)}"${dis}>`;
  }
}

function fieldsHtml(fields, obj, prefix, opts) {
  return fields.map((f) => {
    const path = `${prefix}.${f.key}`;
    if (f.type === 'list') {
      const items = obj[f.key] || [];
      return `<div><div class="row between"><strong class="small">${esc(f.label)}</strong>${opts.canStructure ? `<button type="button" class="btn sm" data-add-item="${esc(path)}">+ Add</button>` : ''}</div>
        <div class="stack" style="margin-top:6px">${items.map((it, i) => `<div class="list-item">${opts.canStructure ? `<div class="x row"><button type="button" class="btn sm ghost" data-move-item="${esc(path)}.${i}" data-dir="-1" title="Move up">↑</button><button type="button" class="btn sm ghost danger" data-del-item="${esc(path)}.${i}" title="Remove">✕</button></div>` : ''}
          ${f.fields.map((sf) => `<label class="f">${esc(sf.label)}${inputFor(sf, it[sf.key], `${path}.${i}.${sf.key}`, false)}</label>`).join('')}</div>`).join('') || '<div class="muted small">None yet.</div>'}</div></div>`;
    }
    const locked = !opts.agency && f.key === 'style';
    if (f.type === 'boolean') return `<label class="check">${inputFor(f, obj[f.key], path, locked)} ${esc(f.label)}</label>`;
    return `<label class="f">${esc(f.label)}${inputFor(f, obj[f.key], path, locked)}</label>`;
  }).join('');
}

const getPath = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);
function setPath(obj, path, v) {
  const ks = path.split('.');
  const last = ks.pop();
  const parent = ks.reduce((o, k) => o[k], obj);
  parent[last] = v;
}

export default async function editor(t, site, pageId) {
  const agency = isAgency();
  const pages = site.pages;
  let page = pages.find((p) => String(p.id) === String(pageId)) || pages[0];
  if (!page) { render(t, html`<div class="card empty">No pages.</div>`); return; }
  const open = new Set([0]);
  let saveTimer, saving = false, dirty = false, device = 'desktop';
  const opts = { agency, canStructure: agency };

  const previewUrl = () => `/preview/${site.id}/${page.slug}`;

  function draw() {
    render(t, html`<div class="editor">
      <div class="card" style="padding:12px"><div class="row between" style="margin-bottom:6px"><h3>Pages</h3>${agency ? html`<button class="btn sm" id="addpage">+ Page</button>` : ''}</div>
        <div class="pagelist">${pages.map((p, i) => html`<a href="#/sites/${site.id}/pages/${p.id}" class="${p.id === page.id ? 'on' : ''}" data-pg="${p.id}"><span>${p.title}</span><span class="muted small mono">/${p.slug}</span></a>`)}</div>
        ${agency ? html`<div class="row mt"><button class="btn sm" id="pgup" title="Move page up">↑</button><button class="btn sm" id="pgdown" title="Move page down">↓</button><button class="btn sm" id="pgset">Page settings</button></div>` : ''}
        <div class="callout small mt">${agency ? 'Edits save to the draft automatically. Use “Send for approval” or “Publish now” to put them live.' : 'Edits save to a draft. When you are done, go to Versions and send your edits to Kess Media.'}</div></div>
      <div><div class="card" style="padding:12px 14px;margin-bottom:12px"><div class="row between"><div><h2>${page.title}</h2><span class="muted small" id="status">All changes saved</span></div>
        ${!agency ? html`<button class="btn sm" id="pgset">Page title and description</button>` : ''}</div></div>
        <div id="secs">${raw(page.sections.map((s, i) => `<div class="sec-card${open.has(i) ? '' : ' closed'}" data-i="${i}"><header data-toggle="${i}"><span class="ty">${esc(SECTION_TYPES[s.type]?.label || s.type)}</span><span class="sum">${esc(summary(s))}</span>
          ${agency ? `<button type="button" class="btn sm ghost" data-mv="${i}" data-dir="-1" title="Move up">↑</button><button type="button" class="btn sm ghost" data-mv="${i}" data-dir="1" title="Move down">↓</button><button type="button" class="btn sm ghost" data-dup="${i}" title="Duplicate">⧉</button><button type="button" class="btn sm ghost danger" data-del="${i}" title="Delete section">✕</button>` : ''}</header>
          <div class="body">${fieldsHtml(SECTION_TYPES[s.type]?.fields || [], s, String(i), opts)}</div></div>`).join(''))}</div>
        ${agency ? html`<div class="row"><select class="i" id="newtype" style="width:auto">${Object.entries(SECTION_TYPES).map(([k, d]) => html`<option value="${k}">${d.label}</option>`)}</select><button class="btn" id="addsec">+ Add section</button></div>` : ''}
      </div>
      <div class="pv ${device === 'mobile' ? 'mobile' : ''}"><div class="row between" style="margin-bottom:8px"><span class="small muted">Live preview (draft)</span><span class="row"><button class="btn sm ${device === 'desktop' ? 'primary' : ''}" data-dev="desktop">Desktop</button><button class="btn sm ${device === 'mobile' ? 'primary' : ''}" data-dev="mobile">Mobile</button><a class="btn sm" href="${previewUrl()}" target="_blank" rel="noopener">↗</a></span></div>
        <iframe id="pv" title="Page preview" src="${previewUrl()}"></iframe></div></div>`);
    bind();
  }

  function status(s) { const el = t.querySelector('#status'); if (el) el.textContent = s; }

  async function save(body = { sections: page.sections }) {
    clearTimeout(saveTimer);
    saving = true; status('Saving…');
    try {
      const p = await api(`/api/sites/${site.id}/pages/${page.id}`, { method: 'PATCH', body });
      Object.assign(page, p);
      dirty = false; status('All changes saved');
      const f = t.querySelector('#pv');
      if (f) { const y = f.contentWindow?.scrollY || 0; f.onload = () => f.contentWindow.scrollTo(0, y); f.src = previewUrl(); }
    } catch (e) { status('Not saved'); fail(e); }
    saving = false;
  }
  const queueSave = () => { dirty = true; status('Unsaved changes…'); clearTimeout(saveTimer); saveTimer = setTimeout(() => save(), 900); };

  function bind() {
    t.querySelectorAll('[data-path]').forEach((inp) => {
      const ev = inp.type === 'checkbox' || inp.tagName === 'SELECT' ? 'change' : 'input';
      inp.addEventListener(ev, () => {
        setPath(page.sections, inp.dataset.path, inp.type === 'checkbox' ? inp.checked : inp.value);
        const card = inp.closest('.sec-card');
        if (card) card.querySelector('.sum').textContent = summary(page.sections[card.dataset.i]);
        queueSave();
      });
    });
    t.querySelectorAll('[data-toggle]').forEach((h) => h.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const i = Number(h.dataset.toggle);
      open.has(i) ? open.delete(i) : open.add(i);
      h.parentElement.classList.toggle('closed');
    }));
    const restructure = (fn) => { fn(); draw(); save(); };
    t.querySelectorAll('[data-mv]').forEach((b) => b.onclick = () => {
      const i = Number(b.dataset.mv), j = i + Number(b.dataset.dir);
      if (j < 0 || j >= page.sections.length) return;
      restructure(() => { [page.sections[i], page.sections[j]] = [page.sections[j], page.sections[i]]; open.clear(); open.add(j); });
    });
    t.querySelectorAll('[data-dup]').forEach((b) => b.onclick = () => restructure(() => { const i = Number(b.dataset.dup); page.sections.splice(i + 1, 0, structuredClone(page.sections[i])); open.add(i + 1); }));
    t.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
      if (!await confirmBox('Delete this section?', 'You can restore it from an earlier version if needed.', 'Delete')) return;
      restructure(() => { page.sections.splice(Number(b.dataset.del), 1); open.clear(); });
    });
    t.querySelectorAll('[data-add-item]').forEach((b) => b.onclick = () => restructure(() => { const list = getPath(page.sections, b.dataset.addItem); list.push({}); }));
    t.querySelectorAll('[data-del-item]').forEach((b) => b.onclick = () => restructure(() => { const ks = b.dataset.delItem.split('.'); const i = Number(ks.pop()); getPath(page.sections, ks.join('.')).splice(i, 1); }));
    t.querySelectorAll('[data-move-item]').forEach((b) => b.onclick = () => restructure(() => { const ks = b.dataset.moveItem.split('.'); const i = Number(ks.pop()); const list = getPath(page.sections, ks.join('.')); if (i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]]; }));
    t.querySelector('#addsec')?.addEventListener('click', () => restructure(() => { page.sections.push(blankSection(t.querySelector('#newtype').value)); open.clear(); open.add(page.sections.length - 1); }));
    t.querySelectorAll('[data-pick]').forEach((b) => b.onclick = () => pickImage(b.dataset.pick));
    t.querySelectorAll('[data-dev]').forEach((b) => b.onclick = () => { device = b.dataset.dev; t.querySelector('.pv').classList.toggle('mobile', device === 'mobile'); t.querySelectorAll('[data-dev]').forEach((x) => x.classList.toggle('primary', x === b)); });
    t.querySelectorAll('[data-pg]').forEach((a) => a.addEventListener('click', async (e) => { if (dirty || saving) { e.preventDefault(); await save(); location.hash = a.getAttribute('href'); } }));
    t.querySelectorAll('#pgset').forEach((b) => b.onclick = pageSettings);
    t.querySelector('#addpage')?.addEventListener('click', addPage);
    t.querySelector('#pgup')?.addEventListener('click', () => movePage(-1));
    t.querySelector('#pgdown')?.addEventListener('click', () => movePage(1));
  }

  async function pickImage(path) {
    const files = (await api(`/api/assets${agency ? `?client_id=${site.client_id}` : ''}`)).filter((f) => f.mime.startsWith('image/'));
    const v = await modal({ title: 'Choose an image', wide: true, submit: '', cancel: 'Close', body: html`<div class="drop-zone" id="dz">Drop images here or click to upload<input type="file" accept="image/*" multiple class="hide" id="fi"></div>
      <div class="files mt">${files.map((f) => html`<button type="button" class="file" data-url="${f.url}" data-alt="${f.alt || ''}" style="cursor:pointer;padding:0;text-align:left"><div class="pic" style="background-image:url('${f.url}')"></div><div class="meta"><strong>${f.filename}</strong></div></button>`)}</div>`,
      onOpen: (form, close) => {
        const choose = (url, alt) => {
          setPath(page.sections, path, url);
          const altPath = path.endsWith('.image') ? path.replace(/\.image$/, '.imageAlt') : path.endsWith('.src') ? path.replace(/\.src$/, '.alt') : null;
          if (altPath && alt && !getPath(page.sections, altPath)) setPath(page.sections, altPath, alt);
          close(true); draw(); save();
        };
        form.querySelectorAll('[data-url]').forEach((b) => b.onclick = () => choose(location.origin + b.dataset.url, b.dataset.alt));
        const dz = form.querySelector('#dz'), fi = form.querySelector('#fi');
        dz.onclick = () => fi.click();
        const up = async (list) => { try { const [r] = await uploadFiles([...list], { client_id: site.client_id, site_id: site.id }); if (r) choose(location.origin + r.url, ''); } catch (e) { fail(e); } };
        fi.onchange = () => up(fi.files);
        dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('over'); };
        dz.ondragleave = () => dz.classList.remove('over');
        dz.ondrop = (e) => { e.preventDefault(); up(e.dataTransfer.files); };
      } });
    void v;
  }

  async function pageSettings() {
    const v = await modal({ title: 'Page settings', body: html`${field('Title', 'title', { value: page.title, required: true })}
      ${agency ? html`<div class="two">${field('URL slug', 'slug', { value: page.slug, hint: page.slug === '' ? 'home page' : '', attrs: page.slug === '' ? 'disabled' : '' })}${field('Menu label', 'nav_label', { value: page.nav_label || '', placeholder: page.title })}</div>` : ''}
      ${field('Meta description', 'description', { type: 'textarea', value: page.description, hint: 'what Google shows under the title, 120 to 160 characters' })}
      ${agency ? field('Show in the menu', 'in_nav', { type: 'checkbox', value: page.in_nav }) : ''}
      ${agency && page.slug !== '' ? html`<button type="button" class="btn sm danger" id="delpage" style="justify-self:start">Delete page</button>` : ''}`,
      onOpen: (f, close) => f.querySelector('#delpage')?.addEventListener('click', async () => {
        close(null);
        if (!await confirmBox(`Delete “${page.title}”?`, 'The live site keeps it until you publish again.', 'Delete page')) return;
        try { await api(`/api/sites/${site.id}/pages/${page.id}`, { method: 'DELETE' }); location.hash = `#/sites/${site.id}/pages`; } catch (e) { fail(e); }
      }) });
    if (!v) return;
    if (page.slug === '') delete v.slug;
    await save(v);
    draw();
  }

  async function addPage() {
    const v = await modal({ title: 'Add a page', submit: 'Add page', body: html`${field('Title', 'title', { required: true, placeholder: 'e.g. Pricing' })}${field('Start with', 'start', { type: 'select', options: [['blank', 'Hero only'], ['service', 'Hero, features and call to action'], ['contact', 'Contact form'], ['copy', `Copy of “${page.title}”`]] })}` });
    if (!v) return;
    let sections;
    if (v.start === 'copy') sections = structuredClone(page.sections);
    else {
      const hero = { ...blankSection('hero'), style: 'light', heading: v.title };
      sections = v.start === 'service' ? [hero, blankSection('features'), { ...blankSection('cta'), heading: 'Get in touch', ctaLabel: 'Contact us', ctaHref: 'contact' }]
        : v.start === 'contact' ? [hero, { ...blankSection('contact'), heading: 'Send us a message' }] : [hero];
    }
    try { const p = await api(`/api/sites/${site.id}/pages`, { method: 'POST', body: { title: v.title, sections } }); location.hash = `#/sites/${site.id}/pages/${p.id}`; } catch (e) { fail(e); }
  }

  async function movePage(dir) {
    const i = pages.indexOf(page), j = i + dir;
    if (j < 0 || j >= pages.length) return;
    [pages[i], pages[j]] = [pages[j], pages[i]];
    try { await api(`/api/sites/${site.id}/pages/reorder`, { method: 'POST', body: { ids: pages.map((p) => p.id) } }); draw(); } catch (e) { fail(e); }
  }

  draw();
  window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); } }, { once: true });
  void state;
}
