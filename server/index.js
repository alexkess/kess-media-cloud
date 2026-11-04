const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`Kess Cloud needs Node.js 22.13 or newer (you have ${process.versions.node}). Download the LTS from https://nodejs.org`);
  process.exit(1);
}
const { createApp } = await import('./app.js');
const { hashPassword, randomToken } = await import('./lib/auth.js');
const { ensurePlans, seedDemo } = await import('./seed.js');
const { startMonitor } = await import('./lib/monitor.js');
const { startJobs } = await import('./lib/jobs.js');
const { ensureStudioDefaults } = await import('./studio-seed.js');
const { join, dirname } = await import('node:path');
const { fileURLToPath } = await import('node:url');

const PORT = Number(process.env.PORT || 8787);
const { server, db } = createApp();

ensurePlans(db);
ensureStudioDefaults(db);
if (process.env.DEMO === '1' || process.argv.includes('--demo')) seedDemo(db, { ownerEmail: process.env.KESS_OWNER_EMAIL, ownerPassword: process.env.KESS_OWNER_PASSWORD });

if (!db.get("SELECT 1 FROM users WHERE role = 'owner'")) {
  const email = process.env.KESS_OWNER_EMAIL || 'alex@kess.media';
  const pw = process.env.KESS_OWNER_PASSWORD || randomToken(12);
  db.run("INSERT INTO users (email, name, role, password_hash) VALUES (?, 'Owner', 'owner', ?)", email, hashPassword(pw));
  console.log(`\nCreated owner account ${email}${process.env.KESS_OWNER_PASSWORD ? '' : `\nTemporary password: ${pw}\nChange it under Settings after signing in.`}\n`);
}

if (process.env.MONITOR !== '0') startMonitor(db, { intervalMin: Number(process.env.MONITOR_INTERVAL_MIN || 5) });

if (process.env.JOBS !== '0') startJobs(db, process.env.DATA_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', 'data'));

server.listen(PORT, () => console.log(`Kess Cloud running on http://localhost:${PORT}`));

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.close(); db.close(); process.exit(0); });
