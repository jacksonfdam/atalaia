import { useEffect, useState } from 'react';
import { ApiError, api } from '../api/client';
import { useApi } from '../hooks/useApi';
import { Window, Body, Loading, Notice, formatDate } from '../components/ui';
import type { CallbackState, TelegramChats, TelegramPayload } from '../types';

/**
 * Telegram delivery, and the callback the buttons come back through.
 *
 * Two things have to be right and they fail differently: the bot token, which
 * BotFather issues, and the chat id, which is where messages go. "Send test"
 * proves both at once — it is the only way to find out that the bot is not in
 * the group it is supposed to post to.
 *
 * The webhook is the second half. Telegram will only call an address it has
 * been given, and on a laptop that address changes every restart, so it is
 * registered at boot from whatever public URL the process has — and can be
 * re-registered here when the tunnel hands out a new one.
 */
export function TelegramSettings({ onAuthLost }: { onAuthLost: () => void }) {
  const payload = useApi<TelegramPayload>('/settings/telegram', onAuthLost);
  // Where this instance is reachable, which is what the buttons depend on.
  const callbacks = useApi<CallbackState>('/callbacks', onAuthLost);
  // Chats that have written to the bot: the only way a chat id is ever known.
  const chats = useApi<TelegramChats>('/settings/telegram/chats', onAuthLost);

  const [botToken, setBotToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [notifyOwners, setNotifyOwners] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!payload.data) return;
    setBotToken('');
    setChatId(payload.data.config.chatId ?? '');
    setNotifyOwners(payload.data.config.notifyOwners);
    setEnabled(payload.data.config.enabled);
  }, [payload.data]);

  const locked = payload.data?.envLocked ?? false;
  const status = payload.data?.status;
  const webhook = payload.data?.webhook;

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ kind: 'ok', text: await action() });
    } catch (err) {
      const hint =
        err instanceof ApiError ? (err.body as { hint?: string } | null)?.hint : undefined;
      setMessage({ kind: 'error', text: [(err as Error).message, hint].filter(Boolean).join(' — ') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Window
      title="TELEGRAM.CFG"
      note={status ? (status.ready ? 'ready' : 'off') : undefined}
      accent="var(--cyan)"
      actions={
        <>
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                const result = await api.post<{
                  ok: boolean;
                  error?: string;
                  hint?: string;
                  chat?: string;
                }>('/settings/telegram/test');
                if (!result.ok) {
                  throw new Error([result.error, result.hint].filter(Boolean).join(' — '));
                }
                return `Test message posted to ${result.chat ?? 'the chat'}`;
              })
            }
          >
            Send test
          </button>
          <button
            // A webhook is registered against the bot, so without a token there
            // is nothing to register — better greyed out than a 400.
            disabled={busy || !payload.data?.config.hasToken}
            onClick={() =>
              run(async () => {
                const result = await api.post<{ registered: boolean; url?: string; reason?: string }>(
                  '/settings/telegram/webhook'
                );
                if (!result.registered) throw new Error(result.reason ?? 'Could not register');
                payload.reload();
                return `Telegram will call ${result.url}`;
              })
            }
          >
            Register webhook
          </button>
          <button
            className="primary"
            disabled={busy || locked}
            onClick={() =>
              run(async () => {
                await api.put('/settings/telegram', {
                  ...(botToken ? { botToken } : {}),
                  chatId,
                  notifyOwners,
                  enabled,
                  changedBy: 'console',
                });
                setBotToken('');
                payload.reload();
                return 'Telegram settings saved';
              })
            }
          >
            Save
          </button>
        </>
      }
    >
      <Body>
        {payload.loading ? <Loading what="Telegram settings" /> : null}
        {payload.error ? <Notice kind="error">{payload.error}</Notice> : null}
        {message ? <Notice kind={message.kind}>{message.text}</Notice> : null}

        {status && !status.ready && payload.data?.config.hasToken ? (
          <Notice>Alerts are not being delivered: {status.reason}.</Notice>
        ) : null}

        {locked ? (
          <Notice>
            Pinned by <code className="mono">TELEGRAM_BOT_TOKEN</code> in the environment.
          </Notice>
        ) : null}

        <div className="toolbar">
          <label style={{ flex: 1, minWidth: '18rem' }}>
            Bot token
            <input
              type="password"
              autoComplete="off"
              disabled={locked}
              value={botToken}
              placeholder={
                payload.data?.config.hasToken
                  ? `stored (${payload.data.config.tokenHint ?? 'env'}) — leave blank to keep`
                  : '123456789:AA…'
              }
              onChange={e => setBotToken(e.target.value)}
            />
          </label>

          <label style={{ minWidth: '12rem' }}>
            Chat id
            <input
              autoComplete="off"
              value={chatId}
              placeholder="-1001234567890 or @channel"
              onChange={e => setChatId(e.target.value)}
            />
          </label>
        </div>

        <div className="toolbar">
          <label className="row" style={{ gap: '0.3rem' }}>
            <input
              type="checkbox"
              disabled={locked}
              checked={enabled}
              onChange={e => setEnabled(e.target.checked)}
            />
            Send alerts to Telegram
          </label>

          <label className="row" style={{ gap: '0.3rem' }}>
            <input
              type="checkbox"
              disabled={locked}
              checked={notifyOwners}
              onChange={e => setNotifyOwners(e.target.checked)}
            />
            Also message owners directly
          </label>
        </div>

        {chats.data && chats.data.count > 0 ? (
          <div style={{ margin: '0.4rem 0 0.6rem' }}>
            <p className="eyebrow">Chats the bot has heard from</p>
            <div className="row" style={{ flexWrap: 'wrap', gap: '0.35rem' }}>
              {chats.data.chats.map(chat => (
                <button
                  key={chat.chat_id}
                  onClick={() => setChatId(chat.chat_id)}
                  title={`Use ${chat.chat_id}`}
                >
                  {chat.title ?? chat.username ?? chat.chat_id}
                  <span className="muted mono"> {chat.chat_id}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <p className="muted">
            No chat has written to the bot yet. Send it <code className="mono">/start</code> — it
            replies with that chat's id, and the id appears here to pick from. A bot cannot open a
            conversation, which is why Telegram answers “chat not found” until you do.
          </p>
        )}

        <p className="muted">
          Talk to <code className="mono">@BotFather</code> to create a bot and get its token. For the
          chat id: add the bot to the group or channel, then use the numeric id (groups start with{' '}
          <code className="mono">-100</code>). An owner is only messaged directly if they have
          started a conversation with the bot and their chat id is on their owner record.
        </p>

        <h3>Callbacks</h3>

        {callbacks.data ? (
          callbacks.data.url ? (
            <p className="muted">
              This instance answers at <code className="mono">{callbacks.data.url}</code>
              {callbacks.data.source === 'tunnel'
                ? ` — a ${callbacks.data.provider} tunnel, so the address changes on every restart.`
                : ' — from PUBLIC_URL.'}
            </p>
          ) : (
            <Notice>
              This instance has no address the internet can reach
              {callbacks.data.reason ? `: ${callbacks.data.reason}` : null}. Set{' '}
              <code className="mono">PUBLIC_URL</code>, or{' '}
              <code className="mono">TUNNEL_PROVIDER=cloudflared</code> to open one at boot — no
              account needed — then restart the API.
            </Notice>
          )
        ) : null}

        {webhook?.registered ? (
          <p className="muted">
            Telegram calls <code className="mono">{webhook.url}</code>
            {webhook.setAt ? ` — registered ${formatDate(webhook.setAt)}` : null}.
          </p>
        ) : (
          <p className="muted">
            No webhook registered: the Acknowledge and Resolve buttons will do nothing until there is
            one. It is registered automatically at boot from <code className="mono">PUBLIC_URL</code>{' '}
            or the tunnel, and by the button above once this instance has a public address.
          </p>
        )}

        {webhook?.live?.lastErrorMessage ? (
          <Notice kind="error">
            Telegram’s last delivery failed: {webhook.live.lastErrorMessage}
            {webhook.live.lastErrorAt ? ` (${formatDate(webhook.live.lastErrorAt)})` : null}
          </Notice>
        ) : null}

        {webhook?.live && (webhook.live.pendingUpdates ?? 0) > 0 ? (
          <Notice>{webhook.live.pendingUpdates} updates waiting at Telegram.</Notice>
        ) : null}

        <p className="muted">
          Buttons are authenticated by a secret token Telegram returns on every callback — Telegram
          signs nothing else. The secret is generated here, stored encrypted, and never shown.
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
