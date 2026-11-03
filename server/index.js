import { createApp } from './app.js';
import { hashPassword, randomToken } from './lib/auth.js';
import { ensurePlans, seedDemo } from './seed.js';
import { startMonitor } from './lib/monitor.js';

const PORT = Number(process.env.PORT || 8787);
const { server, db } = createApp();

ensurePlans(db);
if (process.env.DEMO === '1') seedDemo(db, { ownerEmail: process.env.KESS_OWNER_EMAIL, ownerPassword: process.env.KESS_OWNER_PASSWORD });

if (!db.get("SELECT 1 FROM users WHERE role = 'owner'")) {
  const email = process.env.KESS_OWNER_EMAIL || 'alex@kess.media';
  const pw = process.env.KESS_OWNER_PASSWORD || randomToken(12);
  db.run("INSERT INTO users (email, name, role, password_hash) VALUES (?, 'Owner', 'owner', ?)", email, hashPassword(pw));
  console.log(`\nCreated owner account ${email}${process.env.KESS_OWNER_PASSWORD ? '' : `\nTemporary password: ${pw}\nChange it under Settings after signing in.`}\n`);
}

if (process.env.MONITOR !== '0') startMonitor(db, { intervalMin: Number(process.env.MONITOR_INTERVAL_MIN || 5) });

server.listen(PORT, () => console.log(`Kess Cloud running on http://localhost:${PORT}`));

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.close(); db.close(); process.exit(0); });
