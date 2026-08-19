import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useApi } from '../hooks/useApi';
import { Window, Body, Loading, Notice, formatDate } from '../components/ui';
import type { DiscordPayload } from '../types';

/**
 * Discord delivery.
 *
 * One incoming webhook, one channel, and no way for the channel to call back —
 * the same shape as Teams. No Acknowledge/Resolve buttons for the same reason:
 * those need a registered application with an endpoint Discord can reach.
 */
export function DiscordSettings({ onAuthLost }: { onAuthLost: () => void }) {
  const payload = useApi<DiscordPayload>('/settings/discord', onAuthLost);

  const [webhookUrl, setWebhookUrl] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!payload.data) return;
    setWebhookUrl('');
    setEnabled(payload.data.config.enabled);
  }, [payload.data]);

  const locked = payload.data?.envLocked ?? false;
  const status = payload.data?.status;

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
      title="DISCORD.CFG"
      note={status ? (status.ready ? 'ready' : 'off') : undefined}
      accent="var(--accent-tertiary)"
      actions={
        <>
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                const result = await api.post<{ ok: boolean; error?: string }>('/settings/discord/test');
                if (!result.ok) throw new Error(result.error ?? 'Test failed');
                return 'Test embed posted to the channel';
              })
            }
          >
            Send test
          </button>
          <button
            className="primary"
            disabled={busy || locked}
            onClick={() =>
              run(async () => {
                await api.put('/settings/discord', {
                  ...(webhookUrl ? { webhookUrl } : {}),
                  enabled,
                  changedBy: 'console',
                });
                setWebhookUrl('');
                payload.reload();
                return 'Discord settings saved';
              })
            }
          >
            Save
          </button>
        </>
      }
    >
      <Body>
        {payload.loading ? <Loading what="Discord settings" /> : null}
        {payload.error ? <Notice kind="error">{payload.error}</Notice> : null}
        {message ? <Notice kind={message.kind}>{message.text}</Notice> : null}

        {status && !status.ready && payload.data?.config.hasWebhook ? (
          <Notice>Alerts are not being delivered: {status.reason}.</Notice>
        ) : null}

        {locked ? (
          <Notice>
            Pinned by <code className="mono">DISCORD_WEBHOOK_URL</code> in the environment.
          </Notice>
        ) : null}

        <div className="toolbar">
          <label style={{ flex: 1, minWidth: '18rem' }}>
            Channel webhook URL
            <input
              type="password"
              autoComplete="off"
              disabled={locked}
              value={webhookUrl}
              placeholder={
                payload.data?.config.hasWebhook
                  ? `stored (${payload.data.config.webhookHint}) — leave blank to keep`
                  : 'https://discord.com/api/webhooks/…'
              }
              onChange={e => setWebhookUrl(e.target.value)}
            />
          </label>

          <label className="row" style={{ gap: '0.3rem', alignSelf: 'flex-end' }}>
            <input
              type="checkbox"
              disabled={locked}
              checked={enabled}
              onChange={e => setEnabled(e.target.checked)}
            />
            Send alerts to Discord
          </label>
        </div>

        <p className="muted">
          In Discord: channel → <em>Edit Channel</em> → <em>Integrations</em> → <em>Webhooks</em> →{' '}
          <em>New Webhook</em>. The URL it gives you is a credential — anyone holding it can post in
          that channel — so it is encrypted at rest and never returned by the API.
        </p>

        <p className="muted">
          Alerts arrive as an embed with the severity, the affected repositories and a link to the
          advisory. Acknowledging from Discord is not supported: that needs a registered application
          with an endpoint Discord can call back, which Slack does through its signing secret.
        </p>

        {payload.data?.config.updatedAt ? (
          <p className="muted">
            Changed {formatDate(payload.data.config.updatedAt)} by{' '}
            {payload.data.config.updatedBy ?? 'unknown'}
          </p>
        ) : null}
      </Body>
    </Window>
  );
}
