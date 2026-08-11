/**
 * The desktop's view of who outranks whom — the same file the server and the
 * phone use, re-exported so every surface answers the question identically.
 *
 * It was defined five separate times across this codebase. Five copies of a
 * rule about authority is five chances for one screen to disagree with another
 * about what the owner is allowed to do.
 */
export * from '../../../field/app/roles.js';
