import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useApi } from '../hooks/useApi';
import { Window, Body, Loading, Notice, formatDate } from '../components/ui';
import type { CallbackState, SettingsPayload } from '../types';

/**
 * Schedules, switches and the credential inventory — the settings that belong
 * to no single integration. Everything integration-specific lives in its own
 * tab beside this one.
 */
export function GeneralSettings({ onAuthLost }: { onAuthLost: () => void }) {
  const payload = useApi<SettingsPayload>('/settings', onAuthLost);
  // Where Slack and Telegram reach this instance. Only the running process
  // knows it: on a tunnel the hostname is handed out at boot.
  const callbacks = useApi<CallbackState>('/callbacks', onAuthLost);
  const [draft, setDraft] = useState<Record<string, boolean | string | number>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (payload.data) {
      setDraft(Object.fromEntries(payload.data.settings.map(s => [s.key, s.value])));
    }
  }, [payload.data]);

  const dirty = payload.data
    ? payload.data.settings.filter(s => s.editable && draft[s.key] !== s.value)
    : [];

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const changes = Object.fromEntries(dirty.map(s => [s.key, draft[s.key]]));
      await api.put('/settings', { settings: changes, changedBy: 'console' });
      setMessage({ kind: 'ok', text: `Saved ${dirty.length} setting${dirty.length === 1 ? '' : 's'}` });
      payload.reload();
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Window
        title="SETTINGS.INI"
        note={dirty.length ? `${dirty.length} unsaved` : undefined}
        accent="var(--violet)"
        actions={
          <button className="primary" disabled={busy || dirty.length === 0} onClick={save}>
            Save
          </button>
        }
      >
        <Body>
          {payload.loading ? <Loading what="settings" /> : null}
          {payload.error ? <Notice kind="error">{payload.error}</Notice> : null}
          {message ? <Notice kind={message.kind}>{message.text}</Notice> : null}

          {payload.data
            ? payload.data.settings.map(setting => (
                <div
                  key={setting.key}
                  style={{
                    padding: '0.5rem 0',
                    borderBottom: '1px solid rgba(0,0,0,0.15)',
                  }}
                >
                  <div className="row">
                    <strong style={{ fontSize: '0.8rem' }}>{setting.label}</strong>
                    <span className="badge" style={{ background: 'var(--win-mid)' }}>
                      {setting.source}
                    </span>
                    <span className="spacer" style={{ flex: 1 }} />

                    {setting.type === 'boolean' ? (
                      <label className="row" style={{ gap: '0.3rem' }}>
                        <input
                          type="checkbox"
                          disabled={!setting.editable}
                          checked={Boolean(draft[setting.key])}
                          onChange={e => setDraft({ ...draft, [setting.key]: e.target.checked })}
                        />
                        {draft[setting.key] ? 'On' : 'Off'}
                      </label>
                    ) : (
                      <input
                        disabled={!setting.editable}
                        value={String(draft[setting.key] ?? '')}
                        onChange={e => setDraft({ ...draft, [setting.key]: e.target.value })}
                        size={26}
                      />
                    )}
                  </div>

                  <p className="muted" style={{ marginTop: '0.2rem' }}>
                    <code className="mono">{setting.key}</code>
                    {setting.help ? ` — ${setting.help}` : ''}
                  </p>

                  {!setting.editable ? (
                    <p className="muted">
                      Pinned by <code className="mono">{setting.envVar}</code> in the environment.
                      Unset it to manage this here.
                    </p>
                  ) : null}

                  {setting.updatedAt ? (
                    <p className="muted">
                      Changed {formatDate(setting.updatedAt)} by {setting.updatedBy ?? 'unknown'}
                    </p>
                  ) : null}
                </div>
              ))
            : null}
        </Body>
      </Window>

      <Window
        title="PUBLIC_URL.SYS"
        note={callbacks.data ? (callbacks.data.url ? 'reachable' : 'none') : undefined}
        accent="var(--cyan)"
      >
        <Body>
          {callbacks.loading ? <Loading what="callback state" /> : null}

          {callbacks.data?.url ? (
            <>
              <p>
                <code className="mono">{callbacks.data.url}</code>
              </p>
              <p className="muted">
                {callbacks.data.source === 'tunnel'
                  ? `Opened by the ${callbacks.data.provider} tunnel at boot — a restart hands out a different address, and the integrations are told again.`
                  : 'From PUBLIC_URL in the environment.'}
                {callbacks.data.establishedAt
                  ? ` Established ${formatDate(callbacks.data.establishedAt)}.`
                  : null}
              </p>
              <p className="muted">
                Told to: Slack {callbacks.data.published.slack ? 'yes' : 'no'} · Telegram{' '}
                {callbacks.data.published.telegram ? 'yes' : 'no'}
              </p>
            </>
          ) : null}

          {callbacks.data && !callbacks.data.url ? (
            <Notice>
              No public address{callbacks.data.reason ? `: ${callbacks.data.reason}` : null}. Slack
              and Telegram buttons cannot reach this instance. Set{' '}
              <code className="mono">PUBLIC_URL</code>, or pick a tunnel below, then restart the
              API.
            </Notice>
          ) : null}

          <div className="grid cols-2" style={{ marginTop: '0.6rem' }}>
            {callbacks.data?.providers.map(provider => (
              <div className="row" key={provider.name}>
                <span
                  className="badge"
                  style={{
                    background:
                      callbacks.data?.provider === provider.name
                        ? 'var(--green)'
                        : provider.configured
                          ? 'var(--cyan)'
                          : 'var(--win-mid)',
                    color:
                      callbacks.data?.provider === provider.name || provider.configured
                        ? 'var(--win-black)'
                        : '#fff',
                  }}
                >
                  {callbacks.data?.provider === provider.name
                    ? 'IN USE'
                    : provider.configured
                      ? 'READY'
                      : 'NOT SET'}
                </span>
                <span style={{ fontSize: '0.76rem' }}>{provider.label}</span>
                <span className="muted mono">{provider.reason ?? provider.name}</span>
              </div>
            ))}
          </div>

          <p className="muted" style={{ marginTop: '0.5rem' }}>
            <code className="mono">TUNNEL_PROVIDER</code> picks one — <code className="mono">auto</code>{' '}
            takes the first that is ready, <code className="mono">none</code> opens nothing. In
            containers nothing opens unless this is set: a public hostname is not something to hand
            out by accident.
          </p>
        </Body>
      </Window>

      <Window title="CREDENTIALS.SYS" accent="var(--severity-high)">
        <Body cool>
          <p className="muted" style={{ marginBottom: '0.5rem' }}>
            Secrets are environment-only. The console can tell you whether one is present, never
            what it is, and cannot change it.
          </p>

          <div className="grid cols-2">
            {payload.data?.credentials.map(credential => (
              <div className="row" key={credential.key}>
                <span
                  className="badge"
                  style={{
                    background: credential.configured ? 'var(--green)' : 'var(--win-mid)',
                    color: credential.configured ? 'var(--win-black)' : '#fff',
                  }}
                >
                  {credential.configured ? 'SET' : 'MISSING'}
                </span>
                <span style={{ fontSize: '0.76rem' }}>{credential.label}</span>
                <span className="muted mono">{credential.envVar}</span>
              </div>
            ))}
          </div>
        </Body>
      </Window>
    </>
  );
}
