// The nightly sync. Ported exactly from kess-socials src/lib/sync.ts.
export function planUpsert(all, fetched) {
  // Studio mockups and Dropbox imports are not in any source feed; the sync must never retire or revive them.
  // Map posters are found by a separate check; when that check was skipped (no posters at all), leave them as they are.
  const postersChecked = fetched.some((i) => i.sourceId.endsWith(':map-poster'));
  const existing = all.filter((e) => e.source !== 'studio' && e.source !== 'dropbox' && (postersChecked || !e.sourceId.endsWith(':map-poster')));
  const fetchedIds = new Set(fetched.map((i) => i.sourceId));
  const retire = fetched.length ? existing.filter((e) => e.status === 'active' && !fetchedIds.has(e.sourceId)).map((e) => e.sourceId) : [];
  const revive = existing.filter((e) => e.status === 'retired' && e.retiredReason !== 'never' && fetchedIds.has(e.sourceId)).map((e) => e.sourceId);
  // One upsert must never touch the same (brand, source_id) twice; keep the first.
  const seen = new Set();
  const upsert = fetched.filter((i) => (seen.has(i.sourceId) ? false : (seen.add(i.sourceId), true)));
  return { upsert, retire, revive };
}

/** A short error label for logs and reports, never the full message (which may embed a URL or payload). */
export function errorName(err) {
  if (err instanceof Error) {
    const match = err.message.match(/^[a-z]+(:[a-z0-9_-]+){1,5}/i);
    if (match) return match[0];
    return err.name;
  }
  return 'unknown';
}

/** deps: { db, sources: { [brand]: () => Promise<SourceItem[]> }, log } */
export async function runSync(deps) {
  const report = {};
  for (const brand of Object.keys(deps.sources)) {
    try {
      const fetched = await deps.sources[brand]();
      const plan = planUpsert(await deps.db.listSourceIds(brand), fetched);
      await deps.db.upsertItems(plan.upsert);
      if (plan.retire.length) await deps.db.setStatusBySourceIds(brand, plan.retire, 'retired');
      if (plan.revive.length) await deps.db.setStatusBySourceIds(brand, plan.revive, 'active');
      report[brand] = { upserted: plan.upsert.length, retired: plan.retire.length, revived: plan.revive.length };
      deps.log(`sync:${brand}`, report[brand]);
    } catch (err) {
      const name = errorName(err);
      report[brand] = { upserted: 0, retired: 0, revived: 0, error: name };
      deps.log(`sync:${brand}:failed`, { name });
    }
  }
  return report;
}
