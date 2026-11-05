// Routes for Xero, Dropbox and Vimeo: connect (OAuth), settings, sync and job actions.
import { bad, notFound, HttpError } from '../lib/http.js';
import { requireAgency, requireOwner } from '../lib/auth.js';
import { getIntegration, saveIntegration, removeIntegration, makeState, checkState, setIntegrationStatus } from '../lib/integrations.js';
import { xeroConfigured, xeroAuthUrl, xeroConnect, xeroAccounts, xeroSync, pushInvoice, XERO_DEFAULTS, DEFAULT_SCOPES } from '../lib/xero.js';
import { dropboxConfigured, dropboxAuthUrl, dropboxConnect, dbx, createJobFolders, createUploadRequest, listFolder, sharedLink, folderFor, DROPBOX_DEFAULTS } from '../lib/dropbox.js';
import { vimeoConfigured, vimeoAccount, vimeoVideos, vimeoVideo } from '../lib/vimeo.js';
import { getJob, loadJob, addDelivery, jobEvent } from '../lib/studio.js';
import { loadInvoice } from '../lib/services.js';
import { markInvoicePaid } from './billing.js';

const PROVIDERS = {
  xero: { configured: xeroConfigured, authUrl: xeroAuthUrl, connect: xeroConnect, label: 'Xero' },
  dropbox: { configured: dropboxConfigured, authUrl: dropboxAuthUrl, connect: dropboxConnect, label: 'Dropbox' },
};

function cleanSettings(provider, b, prev) {
  const out = { ...prev };
  const str = (v, max = 200) => String(v ?? '').slice(0, max).trim();
  if (provider === 'xero') {
    if ('sales_account_code' in b) { if (!/^[A-Za-z0-9.-]{1,10}$/.test(str(b.sales_account_code))) throw bad('Account code looks wrong'); out.sales_account_code = str(b.sales_account_code); }
    if ('tax_type' in b) { if (!/^[A-Z0-9_]{2,20}$/.test(str(b.tax_type))) throw bad('Tax type looks wrong (e.g. OUTPUT)'); out.tax_type = str(b.tax_type); }
    if ('payment_account_id' in b) { const v = str(b.payment_account_id, 60); if (v && !/^[0-9a-f-]{36}$/i.test(v)) throw bad('Choose a bank account'); out.payment_account_id = v; }
    if ('auto_push' in b) out.auto_push = !!b.auto_push;
    if ('push_from' in b) { if (b.push_from && !/^\d{4}-\d{2}-\d{2}$/.test(b.push_from)) throw bad('Date must be YYYY-MM-DD'); out.push_from = b.push_from || ''; }
  }
  if (provider === 'dropbox') {
    if ('folder_template' in b) { const t = str(b.folder_template, 300); if (!t.startsWith('/') || !t.includes('{job}')) throw bad('The folder template must start with / and include {job}'); out.folder_template = t; }
    if ('subfolders' in b) out.subfolders = str(b.subfolders, 300);
    if ('request_folder' in b) out.request_folder = str(b.request_folder, 80) || 'Client uploads';
  }
  return out;
}

export default function register(r, { dataDir }) {
  const redirectFor = (ctx, provider) => `${ctx.baseUrl}/oauth/${provider}/callback`;

  r.get('/api/integrations/apps', async (ctx) => {
    requireAgency(ctx);
    const out = {};
    for (const [key, p] of Object.entries(PROVIDERS)) {
      const integ = getIntegration(ctx.db, key, dataDir);
      out[key] = { configured: p.configured(), connected: !!integ?.secrets, account_name: integ?.account_name || null, settings: integ?.settings || (key === 'xero' ? XERO_DEFAULTS : DROPBOX_DEFAULTS),
        last_sync_at: integ?.last_sync_at || null, last_error: integ?.last_error || null, connected_at: integ?.connected_at || null, redirect_uri: redirectFor(ctx, key) };
    }
    out.xero.scopes = process.env.XERO_SCOPES || DEFAULT_SCOPES;
    out.dropbox.example_folder = folderFor(out.dropbox.settings.folder_template, { client: 'Harbourside Dental', job: 'Team headshots', date: new Date().toISOString().slice(0, 10) });
    out.vimeo = { configured: vimeoConfigured() };
    return out;
  });

  // ----- OAuth connect -----
  r.get('/oauth/:provider/start', async (ctx) => {
    requireOwner(ctx);
    const p = PROVIDERS[ctx.params.provider];
    if (!p) throw notFound();
    if (!p.configured()) throw bad(`${p.label} is not set up on the server yet (missing app keys).`);
    ctx.res.writeHead(302, { Location: p.authUrl({ redirectUri: redirectFor(ctx, ctx.params.provider), state: makeState(ctx.params.provider, ctx.user.id, dataDir) }) });
    ctx.res.end();
  });

  r.get('/oauth/:provider/callback', async (ctx) => {
    const provider = ctx.params.provider;
    const p = PROVIDERS[provider];
    if (!p) throw notFound();
    const back = (q) => { ctx.res.writeHead(302, { Location: `/#/settings?${q}` }); ctx.res.end(); };
    if (!ctx.user || ctx.user.role !== 'owner') return back(`integration_error=${encodeURIComponent('Sign in as the owner, then connect again.')}`);
    if (ctx.query.get('error')) return back(`integration_error=${encodeURIComponent(`${p.label}: ${ctx.query.get('error_description') || ctx.query.get('error')}`)}`);
    if (!checkState(ctx.query.get('state'), provider, ctx.user.id, dataDir)) return back(`integration_error=${encodeURIComponent('That sign-in link expired. Please try connecting again.')}`);
    try {
      const name = await p.connect(ctx.db, { code: ctx.query.get('code'), redirectUri: redirectFor(ctx, provider), user: ctx.user, dataDir });
      return back(`connected=${provider}&name=${encodeURIComponent(name || '')}`);
    } catch (e) {
      return back(`integration_error=${encodeURIComponent(`${p.label}: ${e.message}`)}`);
    }
  });

  r.post('/api/integrations/:provider/disconnect', async (ctx) => {
    requireOwner(ctx);
    const provider = ctx.params.provider;
    if (!PROVIDERS[provider]) throw notFound();
    if (provider === 'dropbox') await dbx(ctx.db, dataDir, 'auth/token/revoke', null).catch(() => {});
    removeIntegration(ctx.db, provider);
    return { ok: true };
  });

  r.patch('/api/integrations/:provider/settings', async (ctx) => {
    requireOwner(ctx);
    const provider = ctx.params.provider;
    const integ = getIntegration(ctx.db, provider, dataDir);
    if (!PROVIDERS[provider]) throw notFound();
    if (!integ) throw bad(`Connect ${PROVIDERS[provider].label} first`);
    saveIntegration(ctx.db, provider, { settings: cleanSettings(provider, await ctx.body(), integ.settings), dataDir });
    return getIntegration(ctx.db, provider, dataDir).settings;
  });

  // ----- Xero -----
  r.get('/api/integrations/xero/accounts', async (ctx) => {
    requireOwner(ctx);
    try { return await xeroAccounts(ctx.db, dataDir); } catch (e) { throw new HttpError(502, `Xero: ${e.message}`); }
  });
  r.post('/api/integrations/xero/sync', async (ctx) => {
    requireAgency(ctx);
    return xeroSync(ctx.db, dataDir, (inv) => markInvoicePaid(ctx.db, inv, { via: 'xero' }));
  });
  r.post('/api/invoices/:id/xero', async (ctx) => {
    requireAgency(ctx);
    const inv = loadInvoice(ctx.db, Number(ctx.params.id));
    if (inv.status === 'draft') throw bad('Send the invoice first. Drafts stay out of Xero.');
    const out = await pushInvoice(ctx.db, dataDir, inv.id);
    if (out.skipped) throw bad(out.skipped === 'not connected' ? 'Xero is not connected' : `Skipped: ${out.skipped}`);
    if (out.error) throw new HttpError(502, `Xero: ${out.error}`);
    return loadInvoice(ctx.db, inv.id);
  });

  // ----- Dropbox -----
  const withDropbox = async (ctx, fn) => {
    requireAgency(ctx);
    if (!getIntegration(ctx.db, 'dropbox', dataDir)?.secrets) throw bad('Connect Dropbox in Settings first');
    try { return await fn(); } catch (e) { if (e instanceof HttpError) throw e; setIntegrationStatus(ctx.db, 'dropbox', { error: e.message }); throw new HttpError(502, `Dropbox: ${e.message}`); }
  };

  r.get('/api/dropbox/list', (ctx) => withDropbox(ctx, async () => {
    const path = String(ctx.query.get('path') || '/');
    if (!path.startsWith('/') || path.includes('..')) throw bad('Invalid path');
    return { path, entries: await listFolder(ctx.db, dataDir, path) };
  }));
  r.post('/api/studio/jobs/:id/dropbox/folder', (ctx) => withDropbox(ctx, async () => {
    const job = getJob(ctx.db, Number(ctx.params.id));
    const client = ctx.db.get('SELECT name FROM clients WHERE id = ?', job.client_id);
    const path = await createJobFolders(ctx.db, dataDir, job, client.name);
    jobEvent(ctx.db, job.id, ctx.user.name, 'dropbox.folder', path);
    return loadJob(ctx.db, job.id);
  }));
  r.post('/api/studio/jobs/:id/dropbox/request', (ctx) => withDropbox(ctx, async () => {
    const job = getJob(ctx.db, Number(ctx.params.id));
    const client = ctx.db.get('SELECT name FROM clients WHERE id = ?', job.client_id);
    const url = await createUploadRequest(ctx.db, dataDir, job, client.name, ctx.settings().agency_name);
    jobEvent(ctx.db, job.id, ctx.user.name, 'dropbox.upload_link', url);
    return loadJob(ctx.db, job.id);
  }));
  r.post('/api/studio/jobs/:id/dropbox/deliver', (ctx) => withDropbox(ctx, async () => {
    const job = getJob(ctx.db, Number(ctx.params.id));
    const b = await ctx.body();
    const path = String(b.path || '');
    if (!path.startsWith('/') || path.includes('..')) throw bad('Choose a folder or file');
    const url = await sharedLink(ctx.db, dataDir, path);
    await addDelivery(ctx.db, job, { url, provider: 'dropbox', label: String(b.label || path.split('/').pop()).slice(0, 200), note: String(b.note || '').slice(0, 1000), notify: !!b.notify, user: ctx.user });
    return loadJob(ctx.db, job.id);
  }));

  // ----- Vimeo -----
  const withVimeo = async (ctx, fn) => {
    requireAgency(ctx);
    if (!vimeoConfigured()) throw bad('Vimeo is not set up on the server yet (VIMEO_TOKEN).');
    try { return await fn(); } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(502, `Vimeo: ${e.message}`); }
  };
  r.get('/api/vimeo/account', (ctx) => withVimeo(ctx, () => vimeoAccount()));
  r.get('/api/vimeo/videos', (ctx) => withVimeo(ctx, () => vimeoVideos({ query: ctx.query.get('query') || '', page: ctx.query.get('page') || 1 })));
  r.post('/api/studio/jobs/:id/vimeo', (ctx) => withVimeo(ctx, async () => {
    const job = getJob(ctx.db, Number(ctx.params.id));
    const b = await ctx.body();
    const v = await vimeoVideo(b.video_id);
    if (!v.link) throw bad('That video has no shareable link. Check its privacy settings in Vimeo.');
    await addDelivery(ctx.db, job, { url: v.link, provider: 'vimeo', label: String(b.label || v.name).slice(0, 200), note: String(b.note || '').slice(0, 1000), notify: !!b.notify && !b.include_review, user: ctx.user });
    if (b.include_review && v.review_link) {
      await addDelivery(ctx.db, getJob(ctx.db, job.id), { url: v.review_link, provider: 'vimeo', label: `Review and comment: ${v.name}`.slice(0, 200), note: 'Click anywhere on the video to leave a comment at that moment.', notify: !!b.notify, user: ctx.user });
    }
    return loadJob(ctx.db, job.id);
  }));
}
