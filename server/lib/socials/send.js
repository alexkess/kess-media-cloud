// Sending a card to Publer. Ported from kess-socials src/lib/send.ts, with one Kess Cloud addition:
// a dry run. Unless SOCIALS_SEND=1 the same checks run and the exact Publer requests are built and kept on the
// post, but nothing is uploaded or submitted, and rotation, the decision and the post state are left as they were.
import { DRAFT_REST_DAYS } from './rotation.js';
import { publerRequests } from './publer.js';

/** Shown when a post already carries a Publer job id, so a blind retry could double post. */
export const MAYBE_SENT = 'A post may already exist in Publer. Check Publer before retrying.';
export const DRY_RUN_NOTE = 'Dry run: sending is off. Nothing went to Publer.';

/**
 * deps: { db, publer, now, log, dryRun? }   input: { postId, mode, scheduledAt?, scheduledTimes?, by }
 * With dryRun, publer is never touched.
 */
export async function sendPost(deps, input) {
  if (input.mode === 'schedule' && !input.scheduledAt && !input.scheduledTimes) return { ok: false, error: 'pick a time' };
  if (deps.dryRun) return dryRun(deps, input);
  if (!(await deps.db.lockPost(input.postId, deps.now().toISOString()))) return { ok: false, error: 'already sent' };
  try {
    const post = await deps.db.getPost(input.postId);

    const finish = async (mode, scheduledAt, accounts, scheduledUntil = null) => {
      const at = deps.now().toISOString();
      await deps.db.updatePost(post.id, { state: 'sent', mode, scheduled_at: scheduledAt, scheduled_until: scheduledUntil, sent_at: at, error: null });
      // A draft may never be published, and the app cannot see inside Publer: rest its images briefly instead of for 90 days.
      if (mode === 'draft') await deps.db.restItems(post.itemIds, new Date(deps.now().getTime() + DRAFT_REST_DAYS * 86_400_000).toISOString());
      else await deps.db.markPosted(post.itemIds, at);
      await deps.db.setDecision(post.suggestionId, 'approved', input.by, at);
      deps.log('send:sent', { post: post.id, mode, accounts });
    };

    // A previous attempt already handed this post to Publer. Never submit it again.
    if (post.publerJobId) {
      deps.log('send:resuming', { post: post.id });
      try {
        await deps.publer.awaitJob(post.publerJobId);
      } catch (err) {
        const name = err instanceof Error ? err.name : 'unknown';
        await deps.db.updatePost(post.id, { state: 'failed', error: name });
        deps.log('send:resume-failed', { post: post.id, name });
        return { ok: false, error: MAYBE_SENT };
      }
      await finish(post.mode ?? input.mode, post.scheduledAt, 0, post.scheduledUntil);
      return { ok: true };
    }

    const { entries, items, link, title, startsAt, until } = await prepare(deps, post, input);

    const mediaIds = [];
    // One at a time: Publer fetches each image by URL and answers with a job to wait on.
    for (const item of items) mediaIds.push(await deps.publer.uploadImage(item.imageUrl, `${item.brand}-${item.sourceId}.jpg`));

    const { jobId } = await deps.publer.submitPost({ mode: input.mode, scheduledAt: input.scheduledAt, entries, mediaIds, link, title });
    // Record the job before polling, so a crash here cannot lose it and cause a second post.
    await deps.db.updatePost(post.id, { publer_job_id: jobId, mode: input.mode, scheduled_at: startsAt, scheduled_until: until });
    const rejected = (await deps.publer.awaitJob(jobId, entries.length))?.rejected ?? [];

    await finish(input.mode, startsAt, entries.length - rejected.length, until);
    if (rejected.length) {
      // Providers only in the row; Publer's own wording goes to the screen and the log.
      await deps.db.updatePost(post.id, { error: `partial:${rejected.map((r) => r.provider).join(',')}` });
      deps.log('send:partial', { post: post.id, rejected: rejected.map((r) => `${r.provider}: ${r.message}`) });
      return { ok: true, warning: `Sent, except ${rejected.map((r) => `${r.provider} (${r.message})`).join('; ')}` };
    }
    return { ok: true };
  } catch (err) {
    const name = err instanceof Error ? err.name : 'unknown';
    const message = err instanceof Error ? err.message : 'send failed';
    // Some batches were already accepted: record them so a retry resumes and never posts them twice.
    const accepted = err?.submittedJobIds;
    try {
      await deps.db.updatePost(input.postId, { state: 'failed', error: name, ...(accepted?.length ? { publer_job_id: accepted.join(',') } : {}) });
    } catch (markErr) {
      deps.log('send:mark-failed-failed', { post: input.postId, name: markErr instanceof Error ? markErr.name : 'unknown' });
    }
    deps.log('send:failed', { post: input.postId, name });
    return { ok: false, error: message };
  }
}

/** Everything a send needs before Publer is touched: ticked accounts, items, per-account times, the link. */
async function prepare(deps, post, input) {
  const variants = (await deps.db.variants(post.id)).filter((v) => v.enabled && v.caption.trim());
  if (!variants.length) throw new Error('no accounts ticked');
  const cfg = (await deps.db.brandConfigs()).find((c) => c.brand === post.brand);
  if (!cfg) throw new Error('brand config missing');
  const byId = new Map((await deps.db.getItems(post.itemIds)).map((i) => [i.id, i]));
  const items = post.itemIds.map((id) => byId.get(id)).filter(Boolean);
  if (!items.length) throw new Error('items missing');
  const primary = items[0];

  // A staggered time that has slipped into the past (the page sat open) moves to a few minutes from now, one minute apart.
  const soonest = deps.now().getTime() + 5 * 60_000;
  let bumped = 0;
  const entries = variants.flatMap((v) => {
    const account = cfg.accounts.find((a) => a.accountId === v.accountId);
    if (!account) return [];
    const planned = input.mode === 'schedule' ? input.scheduledTimes?.[account.accountId] : undefined;
    const scheduledAt = planned && Date.parse(planned) < soonest ? new Date(soonest + bumped++ * 60_000).toISOString() : planned;
    return [{ account, caption: v.caption, ...(scheduledAt ? { scheduledAt } : {}) }];
  });
  const times = entries.flatMap((e) => (e.scheduledAt ? [e.scheduledAt] : [])).sort();
  const startsAt = times[0] ?? input.scheduledAt ?? null;
  const until = times.length > 1 ? times[times.length - 1] : null;
  const link = primary.kind === 'essay' ? String(primary.context.canonicalUrl ?? primary.parentUrl) : primary.parentUrl;
  return { entries, items, link, title: primary.title, startsAt, until };
}

/** Builds the exact Publer requests and keeps them on the post. No upload, no submit, no state or rotation change. */
async function dryRun(deps, input) {
  let post;
  try { post = await deps.db.getPost(input.postId); } catch { return { ok: false, error: 'post missing' }; }
  if (post.state === 'sent') return { ok: false, error: 'already sent' };
  const at = deps.now().toISOString();
  try {
    let record;
    if (post.publerJobId) {
      // A real send already reached Publer: a retry would only re-check that job, never submit again.
      record = { at, mode: input.mode, resume: true, jobId: post.publerJobId, uploads: [], requests: [{ method: 'GET', path: `/job_status/${post.publerJobId.split(',')[0]}` }] };
    } else {
      const { entries, items, link, title, startsAt, until } = await prepare(deps, post, input);
      // Placeholders stand in for the media ids Publer would hand back after each upload.
      const uploads = items.map((item, n) => ({ method: 'POST', path: '/media/from-url', body: { media: [{ url: item.imageUrl, name: `${item.brand}-${item.sourceId}.jpg` }] }, mediaId: `dry-run-media-${n + 1}` }));
      const requests = publerRequests({ mode: input.mode, scheduledAt: input.scheduledAt, entries, mediaIds: uploads.map((u) => u.mediaId), link, title });
      record = { at, mode: input.mode, scheduledAt: startsAt, scheduledUntil: until, accounts: entries.map((e) => ({ accountId: e.account.accountId, platform: e.account.platform, label: e.account.label, scheduledAt: e.scheduledAt ?? startsAt })), uploads, requests };
    }
    await deps.db.updatePost(post.id, { dry_run: record, dry_run_at: at });
    deps.log('send:dry-run', { post: post.id, mode: input.mode, requests: record.requests.length });
    return { ok: true, dryRun: true, warning: DRY_RUN_NOTE };
  } catch (err) {
    deps.log('send:dry-run-failed', { post: post.id, name: err instanceof Error ? err.name : 'unknown' });
    return { ok: false, error: err instanceof Error ? err.message : 'dry run failed' };
  }
}
