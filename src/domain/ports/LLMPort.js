/**
 * Port interface for LLM providers.
 * Infrastructure implementations (OpenAI, Ollama, etc.) must fulfill this contract.
 */
export class LLMPort {
  /**
   * Send a prompt to the LLM and return the completion.
   * @param {string} prompt
   * @returns {Promise<string|null>} The completion text, or null on failure
   */
  async complete(prompt) {
    throw new Error('LLMPort.complete() not implemented');
  }
}
