/**
 * Who outranks whom. One definition, used by the server and by the phone.
 *
 * It lived in five places, each deciding authority its own way, and one of
 * them decided it by asking whether a role appeared in a list. That is the
 * shape of rule that can lock the owner out of something: outranking everybody
 * does not help if the question being asked is "are you on this list".
 *
 * So the rule is stated once, here, and it has an absolute at the top. The
 * owner is not the highest number in a comparison that some other screen might
 * make differently — the owner is allowed everything, and every gate says so
 * by calling the same function.
 *
 * Lives inside field/app/ so the phone gets it from the static mount it
 * already has, with no route to add. qa-guard.js — the other file shared this
 * way — sits one directory up and needs a route of its own; this one does not
 * need to, so it does not.
 */

export const RANK = { field: 1, office: 2, admin: 3, owner: 4 };
export const ROLES = ['field', 'office', 'admin', 'owner'];

/** The role that runs the branch. Everything is theirs, by definition. */
export const TOP = 'owner';

/** Rank order: does this role reach that bar? */
export const atLeast = (role, min) => (RANK[role] || 0) >= (RANK[min] || 0);

/** Strictly above — for "you cannot edit somebody senior to you". */
export const outranks = (role, other) => (RANK[role] || 0) > (RANK[other] || 0);

/**
 * The one to reach for when something is granted to a named set of roles.
 *
 * A list of roles is a list of who it was switched on for. It is not a list of
 * who may see it, because the owner may always see it — that is what being the
 * owner means, and a phone form that had never been ticked for them was
 * invisible to the person who paid for the phone.
 */
export const may = (role, granted) =>
  role === TOP || (Array.isArray(granted) && granted.includes(role));
