/**
 * Writing an approved plan.
 *
 * Separate from the route so the statements it builds can be read back in a
 * test rather than only in production. The mistakes available here — a
 * placeholder that does not line up with its value, an update aimed at no
 * particular row, a blank cell written over something real — all produce a
 * server that starts fine and corrupts records quietly, which is the class of
 * bug worth spending a fake database client on.
 *
 * Takes a client rather than opening its own transaction: the caller decides
 * what is atomic with what, and here that means all of it or none of it.
 */

const ident = (s) => `"${String(s).replace(/"/g, '')}"`;

/**
 * Blank cells are skipped rather than written as null.
 *
 * A sheet of unit numbers and current mileages is meant to fill those two
 * things in. Writing its empty columns would erase the plates, the policies
 * and the drivers it never mentioned — and the office would have no way to
 * know until somebody went looking for one.
 */
const written = (values) =>
  Object.entries(values).filter(([, v]) => v !== null && v !== undefined);

export async function applyPlan(client, { table, entityKey, plan, userId = null }) {
  let created = 0;
  let updated = 0;

  for (const row of plan.rows) {
    const entries = written(row.values);
    if (!entries.length) continue;

    try {
      if (row.action === 'update' && row.matchId) {
        const set = entries.map(([k], i) => `${ident(k)} = $${i + 1}`).join(', ');
        const vals = entries.map(([, v]) => v);
        vals.push(row.matchId);
        await client.query(
          `UPDATE ${ident(table)} SET ${set} WHERE id = $${vals.length}`, vals);
        await log(client, entityKey, row.matchId, 'update', row, userId);
        updated++;
      } else {
        const cols = entries.map(([k]) => ident(k)).join(', ');
        const ph = entries.map((_, i) => `$${i + 1}`).join(', ');
        const { rows } = await client.query(
          `INSERT INTO ${ident(table)} (${cols}) VALUES (${ph}) RETURNING id`,
          entries.map(([, v]) => v));
        await log(client, entityKey, rows[0].id, 'create', row, userId);
        created++;
      }
    } catch (err) {
      // Name the line. "duplicate key value violates unique constraint" on its
      // own sends somebody hunting through forty rows by hand.
      const e = new Error(`Line ${row.line} could not be saved — ${err.message}. Nothing was saved.`);
      e.status = 400;
      throw e;
    }
  }

  return { created, updated };
}

/** The same audit trail a hand edit leaves, marked as having come from a paste. */
function log(client, entity, id, action, row, userId) {
  return client.query(
    `INSERT INTO audit_log (user_id, entity, entity_id, action, diff) VALUES ($1,$2,$3,$4,$5)`,
    [userId, entity, id, action,
     JSON.stringify({ source: 'import', line: row.line, values: row.values })]
  );
}
