// Publer over plain fetch. Ported from kess-socials src/lib/publer.ts.
// Kess Cloud addition: nothing reaches Publer unless SOCIALS_SEND=1 (see config.js and send.js).
import { createHash } from 'node:crypto';
import { captionHasLink, LINK_AS_FIRST_COMMENT } from './links.js';
import { sendingOn } from './config.js';

export const PUBLER_BASE = 'https://app.publer.com/api/v1';
const JOB_POLL_MS = 2000;
const JOB_POLL_TRIES = 25;

export class PublerError extends Error {
  constructor(message, status) { super(message); this.name = 'PublerError'; this.status = status; /** Jobs Publer had already accepted before this error. */ this.submittedJobIds = undefined; }
}

/** input: { mode, scheduledAt?, entries: [{account, caption, scheduledAt?}], mediaIds, link?, title? } */
export function buildPostBody(input) {
  // Publer keys a post's content by platform, so one post can carry one caption per platform.
  // A second account on the same platform (company page and personal profile on LinkedIn) goes into its own post.
  const posts = [];
  for (const { account, caption, scheduledAt } of input.entries) {
    if (account.requiresMedia && !input.mediaIds.length) throw new PublerError(`Publer: ${account.platform} needs an image`);
    const acc = { id: account.accountId };
    // Staggered schedules give each account its own time; otherwise every account shares the post's time.
    const at = scheduledAt ?? input.scheduledAt;
    if (input.mode === 'schedule' && at) acc.scheduled_at = at;
    if (account.boardId) acc.album_id = account.boardId;
    // LinkedIn and X are reported to cut reach for links in the post, so the link goes in the first comment (account entry, verified 2026-09-27).
    if (input.link && LINK_AS_FIRST_COMMENT.includes(account.platform) && !captionHasLink(caption, input.link)) acc.comments = [{ text: input.link }];
    // Several images are still type photo: Publer builds the carousel itself, and its own carousel type errors on Instagram.
    const type = input.mediaIds.length ? 'photo' : 'status';
    const net = { type, text: caption };
    // Google Business shows the print only: carousel extras (map poster, mockups) stay on the social accounts.
    if (input.mediaIds.length) net.media = (account.platform === 'google' ? input.mediaIds.slice(0, 1) : input.mediaIds).map((id) => ({ id }));
    if (account.platform === 'pinterest') { if (input.title) net.title = input.title; if (input.link) net.link = input.link; }
    let post = posts.find((p) => !(account.platform in p.networks));
    if (!post) { post = { accounts: [], networks: {} }; posts.push(post); }
    post.accounts.push(acc);
    post.networks[account.platform] = net;
  }
  return { bulk: { state: input.mode === 'draft' ? 'draft' : 'scheduled', posts } };
}

/**
 * The exact requests submitPost makes, in order. Publer applies every batch in one request to every account in that
 * request, which duplicated captions across accounts that share a platform (verified 2026-09-24), so each batch goes
 * in its own request. Used for real sends and for dry runs, so a dry run shows exactly what would be sent.
 */
export function publerRequests(input) {
  const path = input.mode === 'now' ? '/posts/schedule/publish' : '/posts/schedule';
  const { bulk } = buildPostBody(input);
  return bulk.posts.map((post) => ({ method: 'POST', path, body: { bulk: { state: bulk.state, posts: [post] } } }));
}

export function createPublerClient({ apiKey, workspaceId, fetch: f, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  async function request(method, path, body) {
    const headers = { Authorization: `Bearer-API ${apiKey}`, 'Publer-Workspace-Id': workspaceId };
    if (body) headers['Content-Type'] = 'application/json';
    const res = await f(`${PUBLER_BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 401 || res.status === 403) {
      // Which credential is wrong? Lengths and a one-way fingerprint only, never the key. The workspace id is not a secret.
      const fp = createHash('sha256').update(apiKey).digest('hex').slice(0, 8);
      console.error('[publer] auth rejected', { status: res.status, keyLength: apiKey.length, keyFingerprint: fp, workspaceId });
    }
    if (!res.ok) throw new PublerError(`Publer ${res.status} ${path.split('?')[0]}`, res.status);
    return res.json();
  }

  async function pollJob(jobId) {
    for (let i = 0; i < JOB_POLL_TRIES; i++) {
      const job = await request('GET', `/job_status/${jobId}`);
      if (job.status === 'complete') return job;
      if (job.status === 'failed') throw new PublerError('Publer: job failed');
      await sleep(JOB_POLL_MS);
    }
    throw new PublerError('Publer: job timed out');
  }

  return {
    async uploadImage(url, name) {
      const { job_id } = await request('POST', '/media/from-url', { media: [{ url, name }] });
      const job = await pollJob(job_id);
      const id = job.payload?.[0]?.id;
      if (!id) throw new PublerError('Publer: upload returned no media id');
      return id;
    },
    /** Hands the post to Publer and returns as soon as the POST responds, before the job runs. */
    async submitPost(input) {
      const jobIds = [];
      for (const req of publerRequests(input)) {
        try {
          const { job_id } = await request(req.method, req.path, req.body);
          jobIds.push(job_id);
        } catch (err) {
          if (err instanceof PublerError && jobIds.length) err.submittedJobIds = [...jobIds];
          throw err;
        }
      }
      return { jobId: jobIds.join(',') };
    },
    /** Waits for a submitted job. Resolves with the accounts Publer refused when at least one other account was accepted. */
    async awaitJob(jobId, expected) {
      // A post may span several jobs (one per batch), stored comma separated.
      const failures = [];
      for (const id of jobId.split(',').filter(Boolean)) {
        const job = await pollJob(id);
        failures.push(...Object.values(job.payload?.failures ?? {}).flat());
      }
      const rejected = failures.map((r) => ({ provider: typeof r?.provider === 'string' ? r.provider : 'unknown', message: typeof r?.message === 'string' ? r.message.slice(0, 160) : 'rejected' }));
      // Everything refused (or we cannot tell how many were expected): a failed send. Some refused: report them, the rest exist.
      if (rejected.length && (expected === undefined || rejected.length >= expected)) throw new PublerError(`Publer: post rejected (${rejected.map((r) => `${r.provider}: ${r.message}`).join('; ')})`);
      return { rejected };
    },
  };
}

/** A secret pasted into a field twice ("abcabc") is a common slip; use one copy. */
export function undouble(value) {
  if (!value || value.length % 2) return value;
  const half = value.length / 2;
  return value.slice(0, half) === value.slice(half) ? value.slice(0, half) : value;
}

/** The only fetch the live Publer client uses. Refuses outright unless SOCIALS_SEND=1, as a second lock behind send.js. */
export const guardedFetch = (u, i) => {
  if (!sendingOn()) return Promise.reject(new PublerError('Publer: sending is off (SOCIALS_SEND is not 1)'));
  return fetch(u, i);
};

export function publerFromEnv(fetchImpl = guardedFetch) {
  if (!sendingOn()) throw new PublerError('Publer: sending is off');
  // Pasted secrets often carry a stray tab or newline, which breaks the Authorization header.
  const apiKey = undouble(process.env.PUBLER_API_KEY?.trim());
  const workspaceId = process.env.PUBLER_WORKSPACE_ID?.trim();
  if (!apiKey || !workspaceId) throw new PublerError('Publer: not configured');
  return createPublerClient({ apiKey, workspaceId, fetch: fetchImpl });
}
