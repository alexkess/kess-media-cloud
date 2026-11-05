// Caption writing with Claude over plain HTTPS (no SDK, per Kess Cloud's no-dependency rule).
// Rules, prompt, checks and fallbacks are ported exactly from kess-socials src/lib/captions.ts.
import { LINK, NO_LINK_IN_CAPTION } from './links.js';
import { cleanName, dedupeLocation, withShotOn } from './names.js';
import { captionModel } from './config.js';

const EM_DASH = /—/;
const HIDDEN_CONTEXT = new Set(['priceFrom']);

export const CAPTION_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['base', 'variants'],
  properties: {
    base: { type: 'string' },
    variants: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['account_id', 'caption'], properties: { account_id: { type: 'string' }, caption: { type: 'string' } } } },
  },
};

const RULES = [
  'Never use an em dash. Use full stops, commas or colons instead.',
  'Australian English spelling.',
  'Links are plain text, never markdown.',
  'Write a base caption first, then one variant per account that respects that platform\'s character limit and hashtag habit.',
  'Do not invent facts. If the context does not say where or when, do not guess.',
  'Do not repeat the opening line of any recent caption listed.',
  'Links: include the plain link in the caption on facebook, threads, bluesky, mastodon, google and pinterest. Never put a link in instagram, linkedin or twitter captions: on Instagram it is not clickable, and for LinkedIn and X the app adds the link as the first comment.',
  'Platform habits: google is a Google Business Profile update, plain and local, no hashtags, one or two sentences plus the link. twitter is X: the whole post including the link must fit 280 characters, at most 2 hashtags. mastodon: at most 3 hashtags written in CamelCase, no engagement bait.',
];

/** input: { brand: BrandConfig, item: ContentItem, siblings: ContentItem[], recentCaptions: string[] } */
export function buildCaptionPrompt(input) {
  const system = [`You write social media captions for ${input.brand.brand}.`, 'Voice:', input.brand.voice, 'Rules:', ...RULES.map((r) => `- ${r}`)].join('\n');
  // Prices never appear in a post, so they never reach the writer.
  const ctx = Object.entries(input.item.context).filter(([k]) => !HIDDEN_CONTEXT.has(k)).filter(([, v]) => v !== null && v !== '' && !(Array.isArray(v) && !v.length)).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`);
  const user = [
    // Alex's brief comes first and outranks everything, including the stored name and the brand rules.
    input.item.brief ? `Brief from Alex (this overrides the name, the location and every other rule): ${input.item.brief}` : '',
    `Item: ${input.item.title} (${input.item.kind})`,
    // Alex Kess captions are location and name only, and most titles there are file names.
    input.brand.brand === 'alexkess' && input.item.kind === 'image' ? `Stored image name (use only if the brief does not name it): ${cleanName(input.item.title, input.item.parentTitle)}` : '',
    `Parent: ${input.item.parentTitle}`, `Link: ${input.item.parentUrl}`,
    ...ctx,
    input.item.source === 'dropbox' ? 'This photo comes straight from a job folder and has no written description. The image is attached: describe only what you can see, tied to the client and job above. Never name or guess who the people are.' : '',
    input.siblings.length ? `Carousel of ${input.siblings.length + 1} images from the same ${input.item.kind === 'product' ? 'product' : 'project'}.` : '',
    `Default hashtags: ${input.brand.defaultHashtags.join(' ')}`,
    'Accounts:', ...input.brand.accounts.map((a) => `- account_id ${a.accountId}: ${a.platform} "${a.label}" (max ${a.charLimit})`),
    input.recentCaptions.length ? 'Recent captions for this brand (do not echo):' : '', ...input.recentCaptions.map((c) => `- ${c.split('\n')[0]}`),
  ].filter(Boolean).join('\n');
  return { system, user };
}

export function checkCaptions(raw, accounts) {
  const problems = [];
  if (typeof raw !== 'object' || raw === null) return { ok: false, problems: ['not an object'] };
  const r = raw;
  if (typeof r.base !== 'string' || !r.base.trim()) problems.push('base missing');
  else if (EM_DASH.test(r.base)) problems.push('base contains an em dash');
  const variants = {};
  const list = Array.isArray(r.variants) ? r.variants : [];
  for (const a of accounts) {
    const v = list.find((x) => x.account_id === a.accountId);
    if (!v || typeof v.caption !== 'string' || !v.caption.trim()) { problems.push(`${a.accountId} missing`); continue; }
    if (EM_DASH.test(v.caption)) problems.push(`${a.accountId} contains an em dash`);
    if (v.caption.length > a.charLimit) problems.push(`${a.accountId} exceeds ${a.charLimit} characters`);
    if (NO_LINK_IN_CAPTION.includes(a.platform) && LINK.test(v.caption)) problems.push(`${a.accountId} must not contain a link`);
    variants[a.accountId] = v.caption.trim();
  }
  if (problems.length) return { ok: false, problems };
  return { ok: true, value: { base: r.base.trim(), variants } };
}

const scrub = (s) => s.replace(/\s*—\s*/g, ', ');

function fallback(raw, accounts) {
  const base = scrub(typeof raw === 'object' && raw && typeof raw.base === 'string' ? raw.base : 'Caption unavailable. Add a brief and regenerate.');
  const noLink = (text) => text.replace(new RegExp(LINK.source, 'gi'), '').replace(/[ \t]+\n/g, '\n').trim();
  return { base, variants: Object.fromEntries(accounts.map((a) => [a.accountId, (NO_LINK_IN_CAPTION.includes(a.platform) ? noLink(base) : base).slice(0, a.charLimit)])) };
}

/** Fixes the writer cannot be trusted with, for Alex Kess images: a location line never repeats the name,
 * and iPhoneography always says which phone and year. */
function tidy(input, set) {
  if (input.brand.brand !== 'alexkess' || input.item.kind !== 'image') return set;
  const { camera, year } = input.item.context;
  const shot = typeof camera === 'string' && typeof year === 'string';
  const fix = (c, limit) => { const d = dedupeLocation(c); return shot ? withShotOn(d, camera, year, limit) : d; };
  const limits = Object.fromEntries(input.brand.accounts.map((a) => [a.accountId, a.charLimit]));
  return { base: fix(set.base), variants: Object.fromEntries(Object.entries(set.variants).map(([id, c]) => [id, fix(c, limits[id])])) };
}

/** client: { complete(system, user, imageUrl?) => Promise<string> } */
export async function generateCaptions(client, input) {
  const { system, user } = buildCaptionPrompt(input);
  let raw = null;
  let problems = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await client.complete(system, attempt === 0 ? user : `${user}\n\nYour previous answer had these problems, fix them:\n${problems.map((p) => `- ${p}`).join('\n')}`, input.item.source === 'dropbox' ? input.item.imageUrl : undefined);
    try { raw = JSON.parse(text); } catch { problems = ['not valid JSON']; continue; }
    const r = checkCaptions(raw, input.brand.accounts);
    if (r.ok) return tidy(input, r.value);
    problems = r.problems;
  }
  return fallback(raw, input.brand.accounts);
}

export function mergeEdits(fresh, existing, overwrite) {
  if (overwrite) return fresh;
  const variants = { ...fresh.variants };
  for (const e of existing) if (e.edited && variants[e.accountId] !== undefined) variants[e.accountId] = e.caption;
  return { base: fresh.base, variants };
}

// ---------- Anthropic Messages API over fetch ----------
export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2026-10-21';
/** Models that take the server-side refusal fallback (`fallbacks: "default"`). */
const FALLBACK_MODELS = /^claude-(fable-5-1|opus-5-5|opus-5|sonnet-5-5)$/;

export class AnthropicAPIError extends Error {
  constructor(status, body) { super(`anthropic:${status}`); this.status = status; this.error = body; }
}
// Named like the SDK's classes, so describeError reports the same names the Vercel logs did.
const ERROR_CLASSES = {
  400: class BadRequestError extends AnthropicAPIError {}, 401: class AuthenticationError extends AnthropicAPIError {},
  403: class PermissionDeniedError extends AnthropicAPIError {}, 404: class NotFoundError extends AnthropicAPIError {},
  429: class RateLimitError extends AnthropicAPIError {}, 500: class InternalServerError extends AnthropicAPIError {},
};
const apiError = (status, body) => new (ERROR_CLASSES[status] || (status >= 500 ? ERROR_CLASSES[500] : AnthropicAPIError))(status, body);
const retryable = (status) => status === 408 || status === 409 || status === 429 || status >= 500;

/**
 * Caption client for the Anthropic Messages API, as plain fetch calls. Retries twice on 408/409/429/5xx and network
 * errors, like the SDK the Vercel app used. Structured outputs (output_config.format) make the answer JSON.
 */
export function anthropicCaptionClient(apiKey, { workspaceId = process.env.ANTHROPIC_WORKSPACE_ID, model = captionModel(), fetch: f = (u, i) => fetch(u, i), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), timeoutMs = 120_000 } = {}) {
  const fallbacks = FALLBACK_MODELS.test(model) && process.env.SOCIALS_CAPTION_FALLBACKS !== '0';
  return {
    model,
    async complete(system, user, imageUrl) {
      const headers = { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION };
      // Organisation-level keys must name a workspace; workspace-scoped keys do not need the header.
      if (workspaceId) headers['anthropic-workspace-id'] = workspaceId;
      // A policy decline on the caption model is re-run on a fallback model inside the same call.
      if (fallbacks) headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
      const body = {
        model, max_tokens: 16000, system,
        output_config: { format: { type: 'json_schema', schema: CAPTION_SCHEMA } },
        messages: [{ role: 'user', content: imageUrl ? [{ type: 'image', source: { type: 'url', url: imageUrl } }, { type: 'text', text: user }] : user }],
        ...(fallbacks ? { fallbacks: 'default' } : {}),
      };
      let lastErr;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt) await sleep(1000 * 2 ** (attempt - 1));
        let res;
        try {
          res = await f(ANTHROPIC_URL, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
        } catch (e) { lastErr = Object.assign(new Error('captions:network'), { name: 'APIConnectionError', cause: e }); continue; }
        const text = await res.text();
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch { json = null; }
        if (!res.ok) {
          lastErr = apiError(res.status, json);
          if (retryable(res.status)) continue;
          throw lastErr;
        }
        if (json?.stop_reason === 'refusal') throw new Error('captions:refusal');
        const block = (json?.content || []).find((b) => b.type === 'text');
        if (!block) throw new Error('captions:no-text');
        return block.text;
      }
      throw lastErr;
    },
  };
}

/** Codes only, never content: error class, HTTP status and the API's error type when present. */
export function describeError(err) {
  if (!(err instanceof Error)) return { name: 'unknown' };
  const e = err;
  const ctor = e.constructor?.name;
  const out = { name: ctor && ctor !== 'Error' && ctor !== 'AnthropicAPIError' ? ctor : e.name };
  if (typeof e.status === 'number') out.status = e.status;
  const type = e.error?.error?.type ?? e.error?.type;
  if (typeof type === 'string' && /^[a-z_]+$/.test(type)) out.type = type;
  if (out.name === 'Error' && /^[a-z]+(:[a-z0-9_-]+)+$/i.test(e.message)) out.name = e.message;
  // A 400 names the rejected request parameter; it never carries our content. Keep it short.
  const apiMessage = e.error?.error?.message;
  if (out.status === 400 && typeof apiMessage === 'string') out.detail = apiMessage.slice(0, 160);
  return out;
}
