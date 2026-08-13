import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useApi } from '../hooks/useApi';
import { Window, Body, Loading, Notice, formatDate } from '../components/ui';
import type { LlmPayload, LlmProvider } from '../types';

/**
 * Which model writes the plain-English explanation on an alert.
 *
 * The local/hosted split is the part worth being loud about: a hosted model
 * means the description of every vulnerability leaves the network and lands
 * with a third party. Both are reasonable choices; only one of them is a
 * decision someone should make by accident.
 */
export function LlmSettings({ onAuthLost }: { onAuthLost: () => void }) {
  const payload = useApi<LlmPayload>('/settings/llm', onAuthLost);

  const [provider, setProvider] = useState('ollama');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!payload.data) return;
    const { config } = payload.data;

    setProvider(config.provider);
    setModel(config.model ?? '');
    setBaseUrl(config.baseUrl ?? '');
    setApiKey('');
    setEnabled(config.enabled);
  }, [payload.data]);

  const descriptor: LlmProvider | undefined = payload.data?.providers.find(entry => entry.id === provider);
  const locked = payload.data?.envLocked ?? false;
  const status = payload.data?.status;

  /** Switching provider adopts its endpoint and model instead of carrying the old ones over. */
  function pick(id: string) {
    const next = payload.data?.providers.find(entry => entry.id === id);
    setProvider(id);
    setModel(next?.defaultModel ?? '');
    setBaseUrl(next?.baseUrl ?? '');
    setApiKey('');
  }

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ kind: 'ok', text: await action() });
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Window
      title="LLM.CFG"
      note={status ? (status.ready ? `${status.provider} · ${status.model}` : 'off') : undefined}
      accent="var(--accent-primary)"
      actions={
        <>
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                const result = await api.post<{
                  ok: boolean;
                  sample?: string;
                  error?: string;
                  durationMs?: number;
                }>('/settings/llm/test');
                if (!result.ok) throw new Error(result.error ?? 'Test failed');
                return `Answered in ${result.durationMs}ms: “${result.sample}”`;
              })
            }
          >
            Test model
          </button>
          <button
            className="primary"
            disabled={busy || locked}
            onClick={() =>
              run(async () => {
                await api.put('/settings/llm', {
                  provider,
                  model,
                  baseUrl,
                  // Omitted when untouched, so the stored key survives a save.
                  ...(apiKey ? { apiKey } : {}),
                  enabled,
                  changedBy: 'console',
                });
                setApiKey('');
                payload.reload();
                return 'Model settings saved';
              })
            }
          >
            Save
          </button>
        </>
      }
    >
      <Body>
        {payload.loading ? <Loading what="model settings" /> : null}
        {payload.error ? <Notice kind="error">{payload.error}</Notice> : null}
        {message ? <Notice kind={message.kind}>{message.text}</Notice> : null}

        {status && !status.ready ? (
          <Notice>
            Alerts carry the raw advisory text: {status.reason}. Explanations are optional — Atalaia
            works without a model.
          </Notice>
        ) : null}

        {locked ? (
          <Notice>
            Pinned by <code className="mono">LLM_PROVIDER</code> in the environment. Unset{' '}
            {payload.data?.envVars.join(', ')} to manage it here.
          </Notice>
        ) : null}

        {payload.data ? (
          <>
            <div className="toolbar">
              <label style={{ minWidth: '14rem' }}>
                Provider
                <select value={provider} disabled={locked} onChange={e => pick(e.target.value)}>
                  <optgroup label="Runs on your machine">
                    {payload.data.providers
                      .filter(entry => entry.kind === 'local')
                      .map(entry => (
                        <option key={entry.id} value={entry.id}>
                          {entry.label}
                        </option>
                      ))}
                  </optgroup>
                  <optgroup label="Sends the text to a third party">
                    {payload.data.providers
                      .filter(entry => entry.kind === 'hosted')
                      .map(entry => (
                        <option key={entry.id} value={entry.id}>
                          {entry.label}
                        </option>
                      ))}
                  </optgroup>
                </select>
              </label>

              <label style={{ flex: 1, minWidth: '12rem' }}>
                Model
                <input
                  disabled={locked}
                  value={model}
                  placeholder={descriptor?.defaultModel || 'model name'}
                  onChange={e => setModel(e.target.value)}
                />
              </label>

              <label className="row" style={{ gap: '0.3rem', alignSelf: 'flex-end' }}>
                <input
                  type="checkbox"
                  disabled={locked}
                  checked={enabled}
                  onChange={e => setEnabled(e.target.checked)}
                />
                Explain vulnerabilities
              </label>
            </div>

            <div className="toolbar">
              <label style={{ flex: 1, minWidth: '16rem' }}>
                Endpoint
                <input
                  disabled={locked}
                  value={baseUrl}
                  placeholder={descriptor?.baseUrl || 'https://…/v1'}
                  onChange={e => setBaseUrl(e.target.value)}
                />
              </label>

              {descriptor?.requiresKey || provider === 'custom' ? (
                <label style={{ flex: 1, minWidth: '14rem' }}>
                  API key
                  <input
                    type="password"
                    autoComplete="off"
                    disabled={locked}
                    value={apiKey}
                    placeholder={
                      payload.data.config.hasApiKey
                        ? `stored (${payload.data.config.apiKeyHint}) — leave blank to keep`
                        : descriptor?.requiresKey
                          ? 'required by this provider'
                          : 'optional'
                    }
                    onChange={e => setApiKey(e.target.value)}
                  />
                </label>
              ) : null}
            </div>

            {descriptor?.kind === 'hosted' ? (
              <Notice>
                Hosted model: the title and description of every vulnerability Atalaia explains are
                sent to {descriptor.label}. Pick a local provider to keep them on this machine.
              </Notice>
            ) : (
              <p className="muted">
                Local model: nothing about a vulnerability leaves this machine.
              </p>
            )}

            {descriptor?.note ? <p className="muted">{descriptor.note}</p> : null}
            {descriptor?.docsUrl ? (
              <p className="muted">
                <a href={descriptor.docsUrl} target="_blank" rel="noreferrer noopener">
                  {descriptor.label} documentation
                </a>
              </p>
            ) : null}

            <p className="muted">
              The explanation is written once, when a vulnerability is first stored, and travels
              with the Slack alert and the weekly report. Turning this off costs nothing else —
              alerts then carry the advisory text as published.
            </p>

            {payload.data.config.updatedAt ? (
              <p className="muted">
                Changed {formatDate(payload.data.config.updatedAt)} by{' '}
                {payload.data.config.updatedBy ?? 'unknown'}
              </p>
            ) : null}
          </>
        ) : null}
      </Body>
    </Window>
  );
}
