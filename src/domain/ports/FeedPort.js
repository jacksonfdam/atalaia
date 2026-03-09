/**
 * Port interface for vulnerability feed sources.
 * Each feed implementation (CISA, Snyk, VulDB, etc.) must fulfill this contract.
 */
export class FeedPort {
  /**
   * Fetch vulnerabilities from this feed source.
   * @returns {Promise<import('../entities/Vulnerability.js').default[]>}
   */
  async fetch() {
    throw new Error('FeedPort.fetch() not implemented');
  }
}
