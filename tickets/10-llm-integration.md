# Ticket #10: LLM Integration

**Status:** TODO
**Verified:** ❌
**Depends On:** #2 (Domain), #4 (Source Priority)
**Blocks:** #11
**Priority:** MEDIUM

---

## Task Description

Add provider-agnostic LLM integration to generate client-friendly explanations for vulnerabilities.

### What Needs to Be Built

1. **`src/domain/ports/LLMPort.js`** — Interface (already in #2)
2. **`src/infrastructure/llm/llmAdapter.js`** — Factory pattern for providers
3. **`src/infrastructure/llm/openaiProvider.js`** — OpenAI implementation
4. **`src/infrastructure/llm/ollamaProvider.js`** — Ollama (local) implementation
5. **`src/infrastructure/llm/prompts/explainCve.txt`** — Prompt template
6. **Update `monitorVulns.js`** — Generate explanations for new vulns

---

## Why This Matters

- **Accessibility:** Non-technical teams understand vulnerability impact
- **Consistency:** Standardized explanations across all vulns
- **Extensibility:** Can swap LLM providers without code changes
- **Fallback:** If LLM fails, use raw description

---

## Acceptance Criteria

- [ ] LLM factory creates provider based on `LLM_PROVIDER` env var
- [ ] OpenAI provider sends requests to OpenAI API with model from config
- [ ] Ollama provider sends requests to local Ollama instance
- [ ] Prompt template includes CVE ID, title, severity, exploit status
- [ ] Generated explanation stored in `client_explanation` field
- [ ] If LLM unavailable, fallback to raw description (never block)
- [ ] Logging includes LLM provider used and duration
- [ ] Explanations max 3 sentences, plain English

---

## Implementation Steps

### Step 1: Create LLM Adapter

`src/infrastructure/llm/llmAdapter.js`:
```javascript
import logger from '../logger.js';
import { OpenAIProvider } from './openaiProvider.js';
import { OllamaProvider } from './ollamaProvider.js';

export function createLLMAdapter(config) {
  switch (config.LLM_PROVIDER?.toLowerCase()) {
    case 'openai':
      return new OpenAIProvider(config.OPENAI_API_KEY, config.OPENAI_MODEL);
    case 'ollama':
      return new OllamaProvider(config.OLLAMA_URL, config.OLLAMA_MODEL);
    default:
      logger.warn({ provider: config.LLM_PROVIDER }, 'Unknown LLM provider, defaulting to no-op');
      return new NoOpProvider();
  }
}

class NoOpProvider {
  async complete() {
    return null; // Fallback: no explanation
  }
}
```

### Step 2: OpenAI Provider

`src/infrastructure/llm/openaiProvider.js`:
```javascript
import axios from 'axios';
import logger from '../logger.js';

export class OpenAIProvider {
  constructor(apiKey, model = 'gpt-4o-mini') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async complete(prompt) {
    try {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          max_tokens: 150
        },
        { headers: { Authorization: `Bearer ${this.apiKey}` }, timeout: 10000 }
      );

      return response.data.choices[0].message.content.trim();
    } catch (error) {
      logger.error({ provider: 'openai', error: error.message }, 'LLM request failed');
      return null;
    }
  }
}
```

### Step 3: Ollama Provider

`src/infrastructure/llm/ollamaProvider.js`:
```javascript
import axios from 'axios';
import logger from '../logger.js';

export class OllamaProvider {
  constructor(url = 'http://localhost:11434', model = 'llama2') {
    this.url = url;
    this.model = model;
  }

  async complete(prompt) {
    try {
      const response = await axios.post(
        `${this.url}/api/generate`,
        { model: this.model, prompt, stream: false },
        { timeout: 30000 }
      );

      return response.data.response.trim();
    } catch (error) {
      logger.error({ provider: 'ollama', error: error.message }, 'LLM request failed');
      return null;
    }
  }
}
```

### Step 4: Prompt Template

`src/infrastructure/llm/prompts/explainCve.txt`:
```
You are a cybersecurity expert writing for a non-technical business audience.

Given the following vulnerability information, write a clear 2-3 sentence explanation that covers:
1. What the vulnerability is (in plain English)
2. What could happen if it's exploited (business impact)
3. How urgent it is to address

Vulnerability:
- CVE ID: {{cveId}}
- Title: {{title}}
- Description: {{description}}
- Severity: {{severity}} (CVSS: {{cvssScore}})
- Known Exploited: {{exploited}}
- Affected Technologies: {{technologies}}

Write in a professional but accessible tone. Avoid jargon. If the severity is CRITICAL or it's known to be exploited, make the urgency very clear.
```

### Step 5: Update monitorVulns

```javascript
import { createLLMAdapter } from '../infrastructure/llm/llmAdapter.js';

export async function monitorVulns(cache, notifier, config) {
  const llm = createLLMAdapter(config);

  // ... fetch and merge vulnerabilities ...

  for (const vuln of newVulns) {
    // Generate explanation
    let explanation = vuln.description;
    if (llm) {
      const prompt = renderPrompt('explainCve.txt', {
        cveId: vuln.cveId,
        title: vuln.title,
        description: vuln.description,
        severity: vuln.severity,
        cvssScore: vuln.cvssScore,
        exploited: vuln.exploited,
        technologies: vuln.affectedTechnologies.join(', ')
      });

      const llmExplanation = await llm.complete(prompt);
      if (llmExplanation) {
        explanation = llmExplanation;
        vuln.clientExplanation = explanation;
      }
    }

    await notifier.notify(vuln, explanation);
    await cache.add(vuln);
  }
}
```

---

## Validation Conditions

### Condition 1: Adapter Factory Exists
```bash
test -f src/infrastructure/llm/llmAdapter.js
echo "✅ LLM adapter exists"
```

### Condition 2: Providers Exist
```bash
test -f src/infrastructure/llm/openaiProvider.js && \
test -f src/infrastructure/llm/ollamaProvider.js && \
echo "✅ Providers exist"
```

### Condition 3: Prompt Template Exists
```bash
test -f src/infrastructure/llm/prompts/explainCve.txt
echo "✅ Prompt template exists"
```

### Condition 4: Factory Creates Correct Provider
```javascript
import { createLLMAdapter } from 'src/infrastructure/llm/llmAdapter.js';

const oaiConfig = { LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'test', OPENAI_MODEL: 'gpt-4o-mini' };
const oai = createLLMAdapter(oaiConfig);
console.assert(oai.constructor.name === 'OpenAIProvider', 'OpenAI provider not created');

const ollamaConfig = { LLM_PROVIDER: 'ollama', OLLAMA_URL: 'http://localhost', OLLAMA_MODEL: 'llama2' };
const ollama = createLLMAdapter(ollamaConfig);
console.assert(ollama.constructor.name === 'OllamaProvider', 'Ollama provider not created');

console.log('✅ Factory creates correct providers');
```

### Condition 5: Providers Have complete() Method
```javascript
import { OpenAIProvider } from 'src/infrastructure/llm/openaiProvider.js';
const oai = new OpenAIProvider('test-key');
console.assert(typeof oai.complete === 'function', 'complete() missing');
console.log('✅ Providers have complete() method');
```

### Condition 6: No Blocking on LLM Failure
```bash
# Test with invalid API key, app should still work (fallback)
OPENAI_API_KEY=invalid npm run dev &
sleep 3
curl http://localhost:3000/health | grep -q "ok"
kill $!
echo "✅ App handles LLM failures gracefully"
```

---

## Proof Required

Before marking VERIFIED, provide:

1. **File existence** (Condition 1-3)
2. **Node.js factory test output** (Condition 4)
3. **Method existence test** (Condition 5)
4. **App logs** showing fallback when LLM unavailable (Condition 6)
5. **Git diff** showing all new files

---

## Proof of Verification

_To be filled in after implementation_

```
Condition 1: [✅/❌] Adapter exists
Condition 2: [✅/❌] Providers exist
Condition 3: [✅/❌] Prompt template exists
Condition 4: [✅/❌] Factory creates correct provider
Condition 5: [✅/❌] complete() method present
Condition 6: [✅/❌] Graceful fallback

Overall Status: TODO → IN_PROGRESS → VERIFIED ✅
Verified At: [timestamp]
Verified By: [name]
```

---

## Notes

- Default provider: none (no-op)
- OpenAI: requires API key, has cost
- Ollama: requires local setup, free
- If LLM fails: use raw description, log warning
- Template variables: {{variable}} format
