import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useApi } from '../hooks/useApi';
import { Window, Body, Loading, Notice, formatDate } from '../components/ui';
import type { SlackPayload } from '../types';

/**
 * Where vulnerability alerts land.
 *
 * Two modes, because they can do different things: an incoming webhook is
 * permanently bound to the channel it was created for, while a bot token can
 * post to any channel it was invited to and can direct-message a person.
 */
export function SlackSettings({ onAuthLost }: { onAuthLost: () => void }) {
  const payload = useApi<SlackPayload>('/settings/slack', onAuthLost);

  const [mode, setMode] = useState<'webhook' | 'bot'>('webhook');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [botToken, setBotToken] = useState('');
  const [destination, setDestination] = useState('');
  const [notifyOwners, setNotifyOwners] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!payload.data) return;
    const { config } = payload.data;

    setMode(config.mode);
    setWebhookUrl('');
    setBotToken('');
    setDestination(config.destination ?? '');
    setNotifyOwners(config.notifyOwners);
    setEnabled(config.enabled);
  }, [payload.data]);

  const locked = payload.data?.envLocked ?? false;
  const status = payload.data?.status;
  const config = payload.data?.config;

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

  async function save() {
    await run(async () => {
      await api.put('/settings/slack', {
        mode,
        // Omitted when untouched, so the stored credential survives a save.
        ...(webhookUrl ? { webhookUrl } : {}),
        ...(botToken ? { botToken } : {}),
        destination,
        notifyOwners,
        enabled,
        changedBy: 'console',
      });
      setWebhookUrl('');
      setBotToken('');
      payload.reload();
      return 'Slack settings saved';
    });
  }

  async function test() {
    await run(async () => {
      const result = await api.post<{ ok: boolean; channel?: string; error?: string }>(
        '/settings/slack/test'
      );
      if (!result.ok) throw new Error(result.error ?? 'Test failed');
      return `Test message posted to ${result.channel}`;
    });
  }

  return (
    <Window
      title="SLACK.CFG"
      note={status ? (status.ready ? `ready · ${status.mode}` : 'not ready') : undefined}
      accent="var(--accent-primary)"
      actions={
        <>
          <button disabled={busy} onClick={test}>
            Send test
          </button>
          <button className="primary" disabled={busy || locked} onClick={save}>
            Save
          </button>
        </>
      }
    >
      <Body>
        {payload.loading ? <Loading what="Slack settings" /> : null}
        {payload.error ? <Notice kind="error">{payload.error}</Notice> : null}
        {message ? <Notice kind={message.kind}>{message.text}</Notice> : null}

        {status && !status.ready ? (
          <Notice>Alerts are not being delivered: {status.reason}.</Notice>
        ) : null}

        {locked ? (
          <Notice>
            Delivery is pinned by <code className="mono">SLACK_WEBHOOK_URL</code> in the
            environment. Unset it to manage the destination here.
          </Notice>
        ) : null}

        {payload.data ? (
          <>
            <div className="toolbar">
              <label style={{ minWidth: '14rem' }}>
                Integration
                <select
                  value={mode}
                  disabled={locked}
                  onChange={e => setMode(e.target.value as 'webhook' | 'bot')}
                >
                  <option value="webhook">Incoming webhook (one fixed channel)</option>
                  <option value="bot">Bot token (choose channel or person)</option>
                </select>
              </label>

              <label className="row" style={{ gap: '0.3rem', alignSelf: 'flex-end' }}>
                <input
                  type="checkbox"
                  disabled={locked}
                  checked={enabled}
                  onChange={e => setEnabled(e.target.checked)}
                />
                Send alerts to Slack
              </label>
            </div>

            {mode === 'webhook' ? (
              <div className="toolbar">
                <label style={{ flex: 1, minWidth: '18rem' }}>
                  Webhook URL
                  <input
                    type="password"
                    autoComplete="off"
                    disabled={locked}
                    value={webhookUrl}
                    placeholder={
                      config?.hasWebhook
                        ? `stored (${config.webhookHint}) — leave blank to keep`
                        : 'https://hooks.slack.com/services/…'
                    }
                    onChange={e => setWebhookUrl(e.target.value)}
                  />
                </label>
              </div>
            ) : (
              <div className="toolbar">
                <label style={{ flex: 1, minWidth: '16rem' }}>
                  Bot token
                  <input
                    type="password"
                    autoComplete="off"
                    disabled={locked}
                    value={botToken}
                    placeholder={
                      config?.hasBotToken
                        ? `stored (${config.botHint}) — leave blank to keep`
                        : 'xoxb-…'
                    }
                    onChange={e => setBotToken(e.target.value)}
                  />
                </label>

                <label style={{ flex: 1, minWidth: '14rem' }}>
                  Send to
                  <input
                    disabled={locked}
                    value={destination}
                    placeholder="#security or U01ABCDEF"
                    onChange={e => setDestination(e.target.value)}
                  />
                </label>
              </div>
            )}

            {mode === 'bot' ? (
              <>
                <p className="muted">
                  A channel (<code className="mono">#security</code> or its ID) or a person (their
                  Slack member ID, <code className="mono">U…</code>, which sends a direct message).
                  The bot must be invited to a private channel before it can post there — scopes:{' '}
                  <code className="mono">chat:write</code>, plus{' '}
                  <code className="mono">chat:write.public</code> for public channels it has not
                  joined.
                </p>

                <label className="row" style={{ gap: '0.3rem' }}>
                  <input
                    type="checkbox"
                    disabled={locked}
                    checked={notifyOwners}
                    onChange={e => setNotifyOwners(e.target.checked)}
                  />
                  Also direct-message the owners a vulnerability belongs to
                </label>
                <p className="muted">
                  Uses the Slack member ID on each owner below. Owners without one are skipped.
                </p>
              </>
            ) : (
              <p className="muted">
                An incoming webhook always posts to the channel it was created for — Slack ignores
                any other destination. Switch to a bot token to choose where alerts go or to
                direct-message people.
              </p>
            )}

            {!payload.data.interactivity.configured ? (
              <Notice>
                The Acknowledge and Resolve buttons need{' '}
                <code className="mono">{payload.data.interactivity.envVar}</code> in the
                environment. Without it, inbound clicks are rejected.
              </Notice>
            ) : null}

            {config?.updatedAt ? (
              <p className="muted">
                Changed {formatDate(config.updatedAt)} by {config.updatedBy ?? 'unknown'}
              </p>
            ) : null}
          </>
        ) : null}
      </Body>
    </Window>
  );
}
