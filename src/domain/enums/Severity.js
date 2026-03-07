/**
 * Vulnerability severity levels, aligned with DB schema CHECK constraint.
 */
export const Severity = Object.freeze({
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
  UNKNOWN: 'UNKNOWN',
});

/**
 * @param {string} severity
 * @returns {boolean}
 */
export function isValidSeverity(severity) {
  return Object.values(Severity).includes(severity);
}

/**
 * Normalize mixed-case severity strings (e.g. "Critical") to uppercase enum values.
 * @param {string} raw
 * @returns {string}
 */
export function normalizeSeverity(raw) {
  if (!raw || typeof raw !== 'string') return Severity.UNKNOWN;
  const upper = raw.toUpperCase();
  return isValidSeverity(upper) ? upper : Severity.UNKNOWN;
}
