import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useApi } from '../hooks/useApi';
import { Window, Body, Loading, Notice, formatDate } from '../components/ui';
import type { EmailPayload, EmailProvider } from '../types';

/**
 * Weekly report delivery.
 *
 * The provider decides which fields exist — SendGrid only wants an API key,
 * Mailgun wants a login and a host — so the form is rendered from the
 * descriptor the API returns rather than hardcoded here. The stored credential
 * never comes back: an empty secret field means "keep the one you have".
 */
export function EmailSettings({ onAuthLost }: { onAuthLost: () => void }) {
  const payload = useApi<EmailPayload>('/settings/email', onAuthLost);

  const [providerId, setProviderId] = useState<string>('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [secret, setSecret] = useState('');
  const [common, setCommon] = useState({ from: '', recipients: '', template: 'professional', enabled: false });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!payload.data) return;
    const { config } = payload.data;

    setProviderId(config.provider);
    setValues({
      host: config.host ?? '',
      port: config.port ? String(config.port) : '',
      username: config.username ?? '',
    });
    setSecret('');
    setCommon({
      from: config.from ?? '',
      recipients: config.recipients ?? '',
      template: config.template,
      enabled: config.enabled,
    });
  }, [payload.data]);

  const provider: EmailProvider | undefined = payload.data?.providers.find(p => p.id === providerId);
  const locked = payload.data?.envLocked ?? false;

  /** Switching provider adopts its defaults instead of carrying the old host over. */
  function pickProvider(id: string) {
    const next = payload.data?.providers.find(p => p.id === id);
    setProviderId(id);
    setSecret('');
    setValues({
      host: next?.defaults.host ?? '',
      port: next?.defaults.port ? String(next.defaults.port) : '',
      username: next?.defaults.username ?? '',
    });
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

  async function save() {
    await run(async () => {
      await api.put('/settings/email', {
        provider: providerId,
        host: values.host || undefined,
        port: values.port || undefined,
        username: values.username || undefined,
        // Omitted entirely when untouched, so the stored credential survives.
        ...(secret ? { secret } : {}),
        from: common.from,
        recipients: common.recipients,
        template: common.template,
        enabled: common.enabled,
        changedBy: 'console',
      });
      setSecret('');
      payload.reload();
      return 'Email settings saved';
    });
  }

  async function test(send: boolean) {
    await run(async () => {
      const result = await api.post<{ ok: boolean; error?: string; to?: string[]; host?: string }>(
        '/settings/email/test',
        { send }
      );
      if (!result.ok) throw new Error(result.error ?? 'Test failed');
      return send
        ? `Test email sent to ${result.to?.join(', ')}`
        : `Connected and authenticated against ${result.host}`;
    });
  }

  const status = payload.data?.status;

  return (
    <Window
      title="EMAIL.CFG"
      note={status ? (status.ready ? `ready · ${status.recipients} recipients` : 'not ready') : undefined}
      accent="var(--accent-secondary)"
      actions={
        <>
          <button disabled={busy} onClick={() => test(false)}>
            Test connection
          </button>
          <button disabled={busy || !status?.ready} onClick={() => test(true)}>
            Send test
          </button>
          <button className="primary" disabled={busy || locked} onClick={save}>
            Save
          </button>
        </>
      }
    >
      <Body>
        {payload.loading ? <Loading what="email settings" /> : null}
        {payload.error ? <Notice kind="error">{payload.error}</Notice> : null}
        {message ? <Notice kind={message.kind}>{message.text}</Notice> : null}

        {status && !status.ready ? (
          <Notice>The weekly report is not being delivered: {status.reason}.</Notice>
        ) : null}

        {locked ? (
          <Notice>
            Delivery is pinned by <code className="mono">SMTP_HOST</code> in the environment. Unset{' '}
            {payload.data?.envVars.join(', ')} to manage it here.
          </Notice>
        ) : null}

        {payload.data ? (
          <>
            <div className="toolbar">
              <label style={{ minWidth: '12rem' }}>
                Provider
                <select value={providerId} disabled={locked} onChange={e => pickProvider(e.target.value)}>
                  {payload.data.providers.map(entry => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="row" style={{ gap: '0.3rem', alignSelf: 'flex-end' }}>
                <input
                  type="checkbox"
                  disabled={locked}
                  checked={common.enabled}
                  onChange={e => setCommon({ ...common, enabled: e.target.checked })}
                />
                Send the weekly report
              </label>
            </div>

            {provider?.note ? <p className="muted">{provider.note}</p> : null}
            {provider?.docsUrl ? (
              <p className="muted">
                <a href={provider.docsUrl} target="_blank" rel="noreferrer noopener">
                  {provider.label} SMTP documentation
                </a>
              </p>
            ) : null}

            <div className="toolbar">
              {provider?.fields.map(field =>
                field.secret ? (
                  <label key={field.name} style={{ flex: 1, minWidth: '14rem' }}>
                    {field.label}
                    <input
                      type="password"
                      autoComplete="off"
                      disabled={locked}
                      value={secret}
                      placeholder={
                        payload.data?.config.hasSecret
                          ? `stored (${payload.data.config.secretHint}) — leave blank to keep`
                          : field.placeholder ?? ''
                      }
                      onChange={e => setSecret(e.target.value)}
                    />
                  </label>
                ) : (
                  <label key={field.name} style={{ flex: 1, minWidth: '10rem' }}>
                    {field.label}
                    <input
                      disabled={locked}
                      value={values[field.name] ?? ''}
                      placeholder={field.placeholder ?? ''}
                      onChange={e => setValues({ ...values, [field.name]: e.target.value })}
                    />
                  </label>
                )
              )}
            </div>

            {provider?.fields.some(f => f.help) ? (
              <p className="muted">{provider.fields.filter(f => f.help).map(f => f.help).join(' ')}</p>
            ) : null}

            <div className="toolbar">
              <label style={{ flex: 1, minWidth: '12rem' }}>
                From
                <input
                  disabled={locked}
                  value={common.from}
                  placeholder="atalaia@example.com"
                  onChange={e => setCommon({ ...common, from: e.target.value })}
                />
              </label>

              <label style={{ flex: 2, minWidth: '16rem' }}>
                Recipients
                <input
                  disabled={locked}
                  value={common.recipients}
                  placeholder="security@example.com, cto@example.com"
                  onChange={e => setCommon({ ...common, recipients: e.target.value })}
                />
              </label>

              <label style={{ minWidth: '10rem' }}>
                Template
                <select
                  disabled={locked}
                  value={common.template}
                  onChange={e => setCommon({ ...common, template: e.target.value })}
                >
                  <option value="professional">Professional</option>
                  <option value="minimal">Minimal</option>
                </select>
              </label>
            </div>

            <p className="muted">
              The digest lists what was detected in the last 7 days, with the running total of open
              vulnerabilities alongside it. It goes out on the schedule in{' '}
              <code className="mono">WEEKLY_REPORT_CRON</code> (Mondays at 09:00 by default).
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
