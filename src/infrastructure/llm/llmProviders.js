/**
 * Models that can write the plain-English explanation on an alert.
 *
 * Two families, and the difference matters more than the brand: a **hosted**
 * provider means every vulnerability description leaves the network and lands
 * with a third party, while a **local** one keeps it on the machine. Both are
 * legitimate choices; only one of them needs an API key.
 *
 * Everything except Anthropic speaks the OpenAI chat-completions shape, so one
 * client covers them: what differs is the base URL, the default model and
 * whether a key is required.
 *
 * @typedef {object} LlmProviderDescriptor
 * @property {string} id
 * @property {string} label
 * @property {'local'|'hosted'} kind
 * @property {'openai'|'anthropic'|'ollama'} api  Wire format
 * @property {string} baseUrl
 * @property {string} defaultModel
 * @property {boolean} requiresKey
 * @property {string} docsUrl
 * @property {string} [note]
 */

/** @type {LlmProviderDescriptor[]} */
export const LLM_PROVIDERS = [
    {
        id: 'ollama',
        label: 'Ollama (local)',
        kind: 'local',
        api: 'ollama',
        baseUrl: 'http://localhost:11434',
        defaultModel: 'llama3.1',
        requiresKey: false,
        docsUrl: 'https://ollama.com',
        note: 'Runs on this machine. Nothing about a vulnerability leaves the network.',
    },
    {
        id: 'lmstudio',
        label: 'LM Studio (local)',
        kind: 'local',
        api: 'openai',
        baseUrl: 'http://localhost:1234/v1',
        defaultModel: 'local-model',
        requiresKey: false,
        docsUrl: 'https://lmstudio.ai/docs/local-server',
        note: 'Any OpenAI-compatible local server; LM Studio serves one by default.',
    },
    {
        id: 'openai',
        label: 'OpenAI',
        kind: 'hosted',
        api: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        defaultModel: 'gpt-4o-mini',
        requiresKey: true,
        docsUrl: 'https://platform.openai.com/docs/api-reference/chat',
    },
    {
        id: 'anthropic',
        label: 'Anthropic',
        kind: 'hosted',
        api: 'anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        defaultModel: 'claude-sonnet-4-5',
        requiresKey: true,
        docsUrl: 'https://docs.anthropic.com/en/api/messages',
    },
    {
        id: 'gemini',
        label: 'Google Gemini',
        kind: 'hosted',
        api: 'openai',
        // Google serves an OpenAI-compatible surface next to its own API, which
        // is why this needs no client of its own.
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        defaultModel: 'gemini-2.5-flash',
        requiresKey: true,
        docsUrl: 'https://ai.google.dev/gemini-api/docs/openai',
        note: 'Key from Google AI Studio. Vertex AI is a different endpoint and authenticates with Google credentials — point "custom" at it if that is what you run.',
    },
    {
        id: 'openrouter',
        label: 'OpenRouter',
        kind: 'hosted',
        api: 'openai',
        baseUrl: 'https://openrouter.ai/api/v1',
        defaultModel: 'anthropic/claude-sonnet-4.5',
        requiresKey: true,
        docsUrl: 'https://openrouter.ai/docs',
        note: 'One key, many models — the model name selects the vendor.',
    },
    {
        id: 'groq',
        label: 'Groq',
        kind: 'hosted',
        api: 'openai',
        baseUrl: 'https://api.groq.com/openai/v1',
        defaultModel: 'llama-3.3-70b-versatile',
        requiresKey: true,
        docsUrl: 'https://console.groq.com/docs/openai',
    },
    {
        id: 'custom',
        label: 'Custom (OpenAI-compatible)',
        kind: 'hosted',
        api: 'openai',
        baseUrl: '',
        defaultModel: '',
        requiresKey: false,
        docsUrl: '',
        note: 'Anything that serves /chat/completions — vLLM, LiteLLM, a gateway of your own.',
    },
];

const BY_ID = new Map(LLM_PROVIDERS.map(provider => [provider.id, provider]));

/** @param {string} id */
export function getLlmProvider(id) {
    return BY_ID.get(String(id ?? '').toLowerCase());
}

/** The catalog as the console renders it. Nothing here is secret. */
export function listLlmProviders() {
    return LLM_PROVIDERS.map(provider => ({ ...provider, note: provider.note ?? null }));
}
