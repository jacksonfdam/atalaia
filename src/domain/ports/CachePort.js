/**
 * Port interface for vulnerability persistence.
 * Infrastructure implementations must fulfill this contract.
 */
export class CachePort {
  /**
   * Check if a vulnerability exists by CVE ID.
   * @param {string} cveId
   * @returns {boolean}
   */
  has(cveId) {
    throw new Error('CachePort.has() not implemented');
  }

  /**
   * Persist a new vulnerability.
   * @param {import('../entities/Vulnerability.js').default} vulnerability
   * @returns {void}
   */
  add(vulnerability) {
    throw new Error('CachePort.add() not implemented');
  }

  /**
   * Retrieve a single vulnerability by CVE ID.
   * @param {string} cveId
   * @returns {object|null}
   */
  get(cveId) {
    throw new Error('CachePort.get() not implemented');
  }

  /**
   * Retrieve all stored vulnerabilities.
   * @returns {object[]}
   */
  getAll() {
    throw new Error('CachePort.getAll() not implemented');
  }

  /**
   * Update specific fields on a vulnerability.
   * @param {string} cveId
   * @param {object} updates - Key/value pairs to update
   * @returns {void}
   */
  update(cveId, updates) {
    throw new Error('CachePort.update() not implemented');
  }

  /**
   * Delete vulnerabilities matching criteria.
   * @param {object} criteria - e.g. { status: 'RESOLVED', olderThanDays: 30 }
   * @returns {number} Number of deleted rows
   */
  deleteWhere(criteria) {
    throw new Error('CachePort.deleteWhere() not implemented');
  }
}
