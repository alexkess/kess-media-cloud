// Shared helpers for the Socials tests (not a test file itself).
import assert from 'node:assert/strict';

/** vitest's toMatchObject: every key in expected matches, recursively. */
export function like(actual, expected, path = '') {
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
    assert.ok(actual && typeof actual === 'object', `${path || 'value'} is an object`);
    for (const [k, v] of Object.entries(expected)) like(actual[k], v, `${path}.${k}`);
  } else assert.deepEqual(actual, expected, path);
}

export const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/** A queue-driven fake fetch that records every call. */
export function fakeFetch(handler) {
  const calls = [];
  const f = async (url, init = {}) => { calls.push({ url: String(url), init, body: init.body ? JSON.parse(init.body) : undefined }); return handler(String(url), init, calls.length - 1); };
  f.calls = calls;
  return f;
}
