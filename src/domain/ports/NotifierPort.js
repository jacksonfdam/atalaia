/**
 * Port interface for sending vulnerability notifications.
 * Infrastructure implementations (Slack, email, etc.) must fulfill this contract.
 */
export class NotifierPort {
  /**
   * Send a notification about a vulnerability.
   * @param {import('../entities/Vulnerability.js').default} vulnerability
   * @param {string} [explanation] - Optional client-friendly explanation
   * @returns {Promise<void>}
   */
  async notify(vulnerability, explanation) {
    throw new Error('NotifierPort.notify() not implemented');
  }
}
