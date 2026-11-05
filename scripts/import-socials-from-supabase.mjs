#!/usr/bin/env node
// Copies Kess Socials (the Vercel app) from Supabase into a Kess Cloud database, so rotation history carries over.
//
//   node --env-file=../kess-socials/.env.local scripts/import-socials-from-supabase.mjs --db ./data/kess-cloud.db
//   ... --dry      fetch everything and report what would change, write nothing
//
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (read only: nothing in Supabase is changed).
// Copies brand_config, mention, content_item (including Dropbox and Studio mockup rows), suggestion, post and
// post_variant. Images are not copied: their URLs keep pointing at Supabase storage and the CDNs.
// Safe to re-run: rows are matched by their Supabase ids. Run it where the database file lives (your Mac for a
// local copy, or the server over ssh); Kess Cloud can keep running, SQLite waits for its turn.
import { resolve } from 'node:path';
import { openDb } from '../server/db.js';
import { fetchSupabaseTables, importSocials } from '../server/lib/socials/importer.js';

const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : undefined; };
const dbFile = resolve(arg('--db') || process.env.DB_FILE || './data/kess-cloud.db');
const dryRun = process.argv.includes('--dry');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!url || !key) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (for example with --env-file=../kess-socials/.env.local).');
  process.exit(1);
}

console.log(`Reading Supabase at ${new URL(url).host}…`);
const data = await fetchSupabaseTables({ url, key });
for (const [t, rows] of Object.entries(data)) console.log(`  ${t.padEnd(14)} ${rows.length}`);
const db = openDb(dbFile);
db.exec('PRAGMA busy_timeout = 10000');
const report = importSocials(db, data, { dryRun });
db.close();
console.log(`${dryRun ? 'Dry run, nothing written. Would import' : `Imported into ${dbFile}`}:`);
for (const [k, v] of Object.entries(report)) console.log(`  ${k.padEnd(18)} ${v}`);
