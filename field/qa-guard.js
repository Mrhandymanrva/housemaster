/**
 * qa-guard — the duplicate rule as the phone sees it.
 *
 * The desktop can ask the database what set number is next. A phone in a
 * crawlspace with no bars cannot. So the phone carries a small ledger, one
 * entry per monitor, refreshed every time it syncs, and decides locally.
 *
 * The governing principle is that the two mistakes are not equal:
 *
 *   Asking for a duplicate that was not owed costs one extra monitor-day.
 *   Missing one that was owed costs a hole in the QA record that cannot be
 *   filled after the fact, because the house has already been tested.
 *
 * So every uncertainty resolves toward "take two." A stale ledger, an unknown
 * monitor, a device that has been out of sync for a while — all of them ask
 * for the duplicate. The office would rather explain a spare canister than a
 * missing quality check.
 *
 * No imports. This file runs in the app, in a service worker, and in tests.
 */

export const STALE_AFTER_DAYS = 14;

/**
 * A ledger entry the phone caches per monitor at sync time.
 *
 * { equipmentId, name, interval, completedSets, syncedAt, localSetsSinceSync }
 *
 * completedSets counts sets this monitor has FINISHED, not the one about to be
 * placed. Keeping it that way means a duplicate can reset it to zero and the
 * next set is number one, which is what a cycle reset should mean.
 */

export function decide(entry, now = new Date()) {
  const interval = entry?.interval ?? 10;

  // Never seen this monitor. It might be anywhere in its cycle.
  if (!entry || entry.completedSets == null || !entry.syncedAt) {
    return {
      requiresDuplicate: true,
      confident: false,
      sequence: null,
      interval,
      reason: 'This phone has not synced this monitor yet, so it cannot tell where it '
            + 'is in its cycle. Take two to be safe.',
      short: 'Take two monitors',
    };
  }

  const ageDays = (now - new Date(entry.syncedAt)) / 86400000;
  const local = entry.localSetsSinceSync ?? 0;
  const sequence = entry.completedSets + local + 1;   // the set about to be placed

  // Drifted too far to trust. Either the phone has been offline for a while
  // or someone else has been using this monitor.
  if (ageDays > STALE_AFTER_DAYS || local >= interval) {
    return {
      requiresDuplicate: true,
      confident: false,
      sequence,
      interval,
      reason: ageDays > STALE_AFTER_DAYS
        ? `Last synced ${Math.round(ageDays)} days ago. The count may have moved since. Take two.`
        : `${local} sets placed since this phone last synced. Take two.`,
      short: 'Take two monitors',
    };
  }

  const requires = sequence % interval === 0;
  const until = interval - (sequence % interval);

  return {
    requiresDuplicate: requires,
    confident: true,
    sequence,
    interval,
    reason: requires
      ? `Set ${sequence} on this monitor. Every ${interval}th set goes out as a pair.`
      : `Set ${sequence} on this monitor. The next duplicate is due on set ${sequence + until}.`,
    short: requires ? 'Take two monitors' : 'One monitor',
  };
}

/**
 * Is this submission allowed to leave the phone?
 * Called on the submit tap, before anything is queued.
 */
export function validateDeployment(entry, form, now = new Date()) {
  const qa = decide(entry, now);
  const problems = [];

  if (!form.primary_device) problems.push('Scan or pick the monitor you placed.');

  if (qa.requiresDuplicate) {
    if (!form.duplicate_device) {
      problems.push('This set needs a second monitor placed beside the first.');
    } else if (form.duplicate_device === form.primary_device) {
      problems.push('The duplicate has to be a different unit from the primary.');
    }
    if (form.duplicate_distance == null || form.duplicate_distance === '') {
      problems.push('Record how far apart the two units are.');
    } else if (Number(form.duplicate_distance) > 12) {
      problems.push('The two units are too far apart to compare — keep them within about four inches.');
    }
    if (!form.duplicate_photo) problems.push('Take one photo showing both units in place.');
  }

  return { ok: problems.length === 0, problems, qa };
}

/** After a set is queued, the local count moves even with no signal. */
export function advance(entry, { placedDuplicate }) {
  if (!entry) return entry;
  // A duplicate resets the cycle whether or not it was the one we owed —
  // an extra duplicate is still a duplicate, and still proves the unit.
  if (placedDuplicate) {
    return { ...entry, completedSets: 0, localSetsSinceSync: 0, dirty: true };
  }
  return { ...entry, localSetsSinceSync: (entry.localSetsSinceSync ?? 0) + 1, dirty: true };
}

/** Fold a fresh server ledger into the local one without losing queued sets. */
export function merge(local = [], server = [], syncedAt = new Date().toISOString()) {
  const byId = new Map(local.map((e) => [e.equipmentId, e]));
  return server.map((s) => {
    const mine = byId.get(s.equipmentId);
    // Queued-but-unsent sets still count. The server has not seen them yet.
    const pending = mine?.dirty ? (mine.localSetsSinceSync ?? 0) : 0;
    return {
      equipmentId: s.equipmentId,
      name: s.name,
      interval: s.interval ?? 10,
      // the server reports the number of the NEXT set; the ledger holds finished ones
      completedSets: Math.max(0, (s.sequence ?? 1) - 1),
      syncedAt,
      localSetsSinceSync: pending,
      dirty: pending > 0,
    };
  });
}

export default { decide, validateDeployment, advance, merge, STALE_AFTER_DAYS };
