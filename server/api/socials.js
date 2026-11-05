// Socials API: the kess-socials Review roster, Ledger and jobs, for agency users only.
import { bad } from '../lib/http.js';
import { requireAgency, requireOwner } from '../lib/auth.js';
import { clampRosterDate, daysBetween, ROSTER_DAYS, shiftDate, sydneyDate } from '../lib/socials/dates.js';
import { makeStore } from '../lib/socials/store.js';
import { loadRoster } from '../lib/socials/load.js';
import { socialsStatus } from '../lib/socials/config.js';
import * as act from '../lib/socials/actions.js';

const MAX_IDS = 10;
const idList = (v) => (Array.isArray(v) ? v.slice(0, MAX_IDS).map(String) : []);

export default function register(r) {
  r.get('/api/socials/roster', async (ctx) => {
    requireAgency(ctx);
    const now = new Date();
    const today = sydneyDate(now);
    const date = clampRosterDate(ctx.query.get('date') || undefined, today);
    const age = daysBetween(date, today);
    const data = loadRoster(makeStore(ctx.db), date, today, now);
    return {
      ...data, today, age, rosterDays: ROSTER_DAYS, status: socialsStatus(),
      prevDate: age < ROSTER_DAYS - 1 ? shiftDate(date, -1) : null, nextDate: age > 0 ? shiftDate(date, 1) : null,
    };
  });

  r.post('/api/socials/cards/:id/decide', async (ctx) => {
    requireAgency(ctx);
    const b = await ctx.body();
    return act.decide(ctx.db, ctx.user, ctx.params.id, b.decision);
  });

  r.post('/api/socials/cards', async (ctx) => {
    requireAgency(ctx);
    const b = await ctx.body();
    return act.addCard(ctx.db, ctx.user, b.itemId, { extraItemIds: idList(b.extraItemIds).slice(0, 4) });
  });

  r.get('/api/socials/search', async (ctx) => {
    requireAgency(ctx);
    return act.searchCards(ctx.db, ctx.query.get('brand'), ctx.query.get('q'));
  });

  r.post('/api/socials/items/:id/restore', async (ctx) => { requireAgency(ctx); return act.restoreItem(ctx.db, ctx.params.id); });
  r.patch('/api/socials/items/:id/brief', async (ctx) => { requireAgency(ctx); const b = await ctx.body(); return act.saveBrief(ctx.db, ctx.params.id, b.brief); });

  r.post('/api/socials/posts/:id/siblings', async (ctx) => { requireAgency(ctx); const b = await ctx.body(); return act.setSiblings(ctx.db, ctx.params.id, idList(b.ids)); });
  r.post('/api/socials/posts/:id/primary', async (ctx) => { requireAgency(ctx); const b = await ctx.body(); return act.makePrimary(ctx.db, ctx.params.id, b.itemId); });
  r.post('/api/socials/posts/:id/regenerate', async (ctx) => {
    requireAgency(ctx);
    const b = await ctx.body();
    return act.regenerate(ctx.db, ctx.params.id, b.brief, Boolean(b.overwrite));
  });
  r.post('/api/socials/posts/:id/reset-job', async (ctx) => { requireAgency(ctx); return act.resetPublerJob(ctx.db, ctx.params.id); });
  r.post('/api/socials/posts/:id/conform', async (ctx) => {
    requireAgency(ctx);
    const b = await ctx.body(200_000);
    return act.conformOthers(ctx.db, ctx.params.id, String(b.variantId ?? ''), typeof b.caption === 'string' ? b.caption.slice(0, 10_000) : '');
  });
  r.post('/api/socials/posts/:id/mention', async (ctx) => {
    requireAgency(ctx);
    const b = await ctx.body(200_000);
    return act.addMention(ctx.db, ctx.params.id, String(b.mentionId ?? ''), b.captions);
  });
  r.post('/api/socials/posts/:id/send', async (ctx) => {
    requireAgency(ctx);
    const b = await ctx.body(200_000);
    return act.send(ctx.db, ctx.user, ctx.params.id, { mode: b.mode, windowKey: b.windowKey || undefined, otherTime: b.otherTime || undefined, captions: b.captions });
  });

  r.patch('/api/socials/variants/:id', async (ctx) => {
    requireAgency(ctx);
    const b = await ctx.body(100_000);
    return act.updateVariant(ctx.db, ctx.params.id, { caption: typeof b.caption === 'string' ? b.caption : undefined, enabled: typeof b.enabled === 'boolean' ? b.enabled : undefined });
  });

  r.get('/api/socials/ledger', async (ctx) => { requireAgency(ctx); return { ...act.ledger(ctx.db), status: socialsStatus() }; });

  // Run a job by hand, like the Run button on a Vercel cron. Owner only. Works whatever SOCIALS_JOBS says.
  r.post('/api/socials/run/:job', async (ctx) => {
    requireOwner(ctx);
    const job = ctx.params.job;
    if (job === 'sync') return act.syncNow(ctx.db);
    if (job === 'suggest') return act.suggestNow(ctx.db);
    if (job === 'recaption') return act.recaptionNow(ctx.db);
    throw bad('Unknown job');
  });
}
