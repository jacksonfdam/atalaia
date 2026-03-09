/**
 * Vulnerability status lifecycle enum.
 * OPEN → ACKNOWLEDGED → RESOLVED
 */
export const Status = Object.freeze({
  OPEN: 'OPEN',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  RESOLVED: 'RESOLVED',
});

/**
 * Valid status transitions.
 * OPEN can go to ACKNOWLEDGED or RESOLVED.
 * ACKNOWLEDGED can only go to RESOLVED.
 * RESOLVED is terminal.
 */
const VALID_TRANSITIONS = Object.freeze({
  [Status.OPEN]: [Status.ACKNOWLEDGED, Status.RESOLVED],
  [Status.ACKNOWLEDGED]: [Status.RESOLVED],
  [Status.RESOLVED]: [],
});

/**
 * @param {string} status
 * @returns {boolean}
 */
export function isValidStatus(status) {
  return Object.values(Status).includes(status);
}

/**
 * @param {string} from - Current status
 * @param {string} to - Target status
 * @returns {boolean}
 */
export function isValidTransition(from, to) {
  const allowed = VALID_TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
}
