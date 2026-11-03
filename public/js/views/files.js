import { api, html, render, ago, modal, field, toast, fail, confirmBox, isAgency, uploadFiles } from '../lib.js';

const kb = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

export default async function files(el, _p, q) {
  const agency = isAgency();
  const clientId = q.get('client') || '';
  const [rows, clients] = await Promise.all([api(`/api/assets${clientId ? `?client_id=${clientId}` : ''}`), agency ? api('/api/clients') : Promise.resolve([])]);
  render(el, html`<div class="page-head"><div><h1>Files</h1><p>${agency ? 'Images, logos and documents for every client. Images can be used straight in the page editor.' : 'Send us photos, logos and documents for your website.'}</p></div>
    ${agency ? html`<select class="i" id="cl" style="width:auto"><option value="">All clients</option>${clients.map((c) => html`<option value="${c.id}" ${String(c.id) === clientId ? 'selected' : ''}>${c.name}</option>`)}</select>` : ''}</div>
    ${!agency || clientId ? html`<div class="drop-zone" id="dz">Drop files here or click to upload<br><span class="small">Images, PDF, MP4, ZIP · up to 14 MB each</span><input type="file" multiple class="hide" id="fi"></div>` : html`<div class="callout">Choose a client to upload files for them.</div>`}
    <div class="files mt">${rows.map((f) => html`<div class="file"><a href="${f.url}" target="_blank" rel="noopener"><div class="pic" style="${f.mime.startsWith('image/') ? `background-image:url('${f.url}')` : ''}">${f.mime.startsWith('image/') ? '' : f.filename.split('.').pop().toUpperCase()}</div></a>
      <div class="meta"><strong title="${f.filename}">${f.filename}</strong><span class="muted">${kb(f.size)} · ${ago(f.created_at)}${f.client_name ? ` · ${f.client_name}` : ''}<br>by ${f.uploaded_by_name || '—'}</span>
      <div class="row" style="margin-top:6px"><button class="btn sm" data-copy="${f.url}">Copy link</button>${f.mime.startsWith('image/') ? html`<button class="btn sm" data-alt="${f.id}" data-v="${f.alt || ''}">Alt</button>` : ''}<button class="btn sm ghost danger" data-del="${f.id}">✕</button></div></div></div>`)}</div>
    ${!rows.length ? html`<div class="empty">No files yet.</div>` : ''}`);
  el.querySelector('#cl')?.addEventListener('change', (e) => { location.hash = '#/files' + (e.target.value ? `?client=${e.target.value}` : ''); });
  const dz = el.querySelector('#dz'), fi = el.querySelector('#fi');
  if (dz) {
    const up = async (list) => { try { const r = await uploadFiles([...list], { client_id: clientId ? Number(clientId) : undefined }); toast(`${r.length} file${r.length === 1 ? '' : 's'} uploaded`); files(el, _p, q); } catch (e) { fail(e); } };
    dz.onclick = () => fi.click();
    fi.onchange = () => up(fi.files);
    dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('over'); };
    dz.ondragleave = () => dz.classList.remove('over');
    dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('over'); up(e.dataTransfer.files); };
  }
  el.querySelectorAll('[data-copy]').forEach((b) => b.onclick = () => { navigator.clipboard?.writeText(location.origin + b.dataset.copy); toast('Link copied'); });
  el.querySelectorAll('[data-alt]').forEach((b) => b.onclick = async () => {
    const v = await modal({ title: 'Describe this image', body: field('Alt text', 'alt', { value: b.dataset.v, hint: 'what a screen reader should say, used automatically in the editor' }) });
    if (!v) return;
    try { await api(`/api/assets/${b.dataset.alt}`, { method: 'PATCH', body: v }); toast('Saved'); files(el, _p, q); } catch (e) { fail(e); }
  });
  el.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
    if (!await confirmBox('Delete file?', 'Pages using this image will show a broken image.', 'Delete')) return;
    try { await api(`/api/assets/${b.dataset.del}`, { method: 'DELETE' }); files(el, _p, q); } catch (e) { fail(e); }
  });
}
