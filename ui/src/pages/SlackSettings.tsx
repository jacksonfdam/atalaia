import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useApi } from '../hooks/useApi';
import { Window, Body, Loading, Notice, formatDate } from '../components/ui';
import { Owners } from './Owners';
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
  const [signingSecret, setSigningSecret] = useState('');
  const [appToken, setAppToken] = useState('');
  const [appId, setAppId] = useState('');
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
    setSigningSecret('');
    setAppToken('');
    setAppId(config.appId ?? '');
    setNotifyOwners(config.notifyOwners);
    setEnabled(config.enabled);
  }, [payload.data]);

  const locked = payload.data?.envLocked ?? false;
  const env = payload.data?.env;
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
        // Omitted when untouched, so the stored credential survives a save;
        // and omitted when the environment pins it, which the API refuses.
        ...(webhookUrl && !env?.webhookUrl ? { webhookUrl } : {}),
        ...(botToken ? { botToken } : {}),
        ...(signingSecret && !env?.signingSecret ? { signingSecret } : {}),
        ...(appToken && !env?.appToken ? { appToken } : {}),
        ...(env?.appId ? {} : { appId }),
        ...(locked ? {} : { destination, notifyOwners }),
        ...(env?.enabled === null || env?.enabled === undefined ? { enabled } : {}),
        changedBy: 'console',
      });
      setWebhookUrl('');
      setBotToken('');
      setSigningSecret('');
      setAppToken('');
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
    <>
    <Window
      title="SLACK.CFG"
      note={status ? (status.ready ? `ready · ${status.mode}` : 'not ready') : undefined}
      accent="var(--accent-primary)"
      actions={
        <>
          <button disabled={busy} onClick={test}>
            Send test
          </button>
          <button className="primary" disabled={busy} onClick={save}>
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
                  disabled={env?.enabled !== null && env?.enabled !== undefined}
                  checked={env?.enabled ?? enabled}
                  onChange={e => setEnabled(e.target.checked)}
                />
                Send alerts to Slack
                {env?.enabled !== null && env?.enabled !== undefined ? (
                  <span className="muted mono"> SLACK_ENABLED</span>
                ) : null}
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

            <div className="toolbar">
              <label style={{ flex: 1, minWidth: '14rem' }}>
                Signing secret
                <input
                  type="password"
                  autoComplete="off"
                  disabled={env?.signingSecret}
                  value={signingSecret}
                  placeholder={
                    env?.signingSecret
                      ? 'set by SLACK_SIGNING_SECRET'
                      : config?.hasSigningSecret
                        ? `stored (${config.signingHint}) — leave blank to keep`
                        : 'verifies the Acknowledge / Resolve clicks'
                  }
                  onChange={e => setSigningSecret(e.target.value)}
                />
              </label>

              <label style={{ flex: 1, minWidth: '12rem' }}>
                App-level token
                <input
                  type="password"
                  autoComplete="off"
                  disabled={env?.appToken}
                  value={appToken}
                  placeholder={
                    env?.appToken
                      ? 'set by SLACK_APP_TOKEN'
                      : config?.hasAppToken
                        ? `stored (${config.appTokenHint}) — leave blank to keep`
                        : 'xapp-… (development only)'
                  }
                  onChange={e => setAppToken(e.target.value)}
                />
              </label>

              <label style={{ minWidth: '10rem' }}>
                App ID
                <input
                  disabled={env?.appId}
                  value={appId}
                  placeholder={env?.appId ? 'set by SLACK_APP_ID' : 'A01234567'}
                  onChange={e => setAppId(e.target.value)}
                />
              </label>
            </div>

            <p className="muted">
              The signing secret verifies what Slack sends back when someone clicks a button. The
              app-level token and app ID are only used in development, to point the app's Request
              URL at the current ngrok tunnel.
            </p>

            {!payload.data.interactivity.configured ? (
              <Notice>
                The Acknowledge and Resolve buttons need a signing secret — set it above or as{' '}
                <code className="mono">{payload.data.interactivity.envVar}</code>. Without it,
                inbound clicks are rejected.
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

    {/* Owners are what "direct-message the owners" routes to, so they belong
        with the integration rather than on a page of their own. */}
    <Owners onAuthLost={onAuthLost} />
    </>
  );
}
