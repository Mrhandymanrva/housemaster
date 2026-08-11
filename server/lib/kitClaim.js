/**
 * Working out what a tech's answer means for the equipment records.
 *
 * The screen asks one question — what have you actually got with you — and the
 * answer has to turn into the smallest set of changes that makes the records
 * true. The trap is treating "not ticked" as "give it back": most of what is
 * on the list belongs to somebody else, and a tech scrolling past it has said
 * nothing about it at all. Only kit that was already theirs can be let go by
 * leaving it unticked.
 *
 * Kept apart from the route because this is the part with rules in it. The
 * SQL underneath is four straightforward updates; deciding which four is where
 * an inspector quietly ends up holding a colleague's ladder.
 */

/**
 * @param me         employee id of whoever is answering
 * @param items      every claimable asset, as the database currently has it
 * @param claimed    what the tech ticked: [{ id, condition }]
 * @param vehicleId  the van they are in, or null
 */
export function planClaim({ me, items, claimed = [], vehicleId = null }) {
  if (!me) throw new Error('Nobody to claim it for.');

  const byId = new Map(items.map((i) => [i.id, i]));
  const ticked = new Map();
  for (const c of claimed) {
    if (byId.has(c.id)) ticked.set(c.id, c);
  }

  const take = [];
  const update = [];
  const release = [];

  for (const item of items) {
    const mine = item.assigned_employee_id === me;
    const pick = ticked.get(item.id);

    if (pick) {
      const condition = pick.condition || null;
      if (!mine) {
        // Taking it off whoever had it. Recorded rather than silently moved:
        // "where did my ladder go" should have an answer.
        take.push({
          id: item.id, name: item.name, condition,
          from: item.assigned_employee_id || null,
          fromName: item.holder_name || null,
        });
      } else if (
        (condition && condition !== item.condition) ||
        (vehicleId || null) !== (item.assigned_vehicle_id || null)
      ) {
        update.push({ id: item.id, name: item.name, condition });
      }
      continue;
    }

    // Unticked and mine: handed back. Unticked and somebody else's: not this
    // tech's business, and nothing happens to it.
    if (mine) release.push({ id: item.id, name: item.name });
  }

  return {
    vehicleId: vehicleId || null,
    take,
    update,
    release,
    // What the tech will be holding once this is applied — the number the
    // screen reports back, so it comes from the same reasoning as the writes.
    holding: items.filter((i) => ticked.has(i.id)).length,
  };
}

/** Whether anything at all would change, so a no-op save can be skipped. */
export const changesAnything = (plan) =>
  plan.take.length > 0 || plan.update.length > 0 || plan.release.length > 0;
