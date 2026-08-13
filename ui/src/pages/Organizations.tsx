import { Fragment, useCallback, useState, type FormEvent } from 'react';
import { api } from '../api/client';
import { useApi } from '../hooks/useApi';
import { Window, Body, Loading, Notice, Empty, formatDate } from '../components/ui';
import { RepositoryPicker } from '../components/RepositoryPicker';
import type { ImportResult, Organization } from '../types';

/**
 * Source-code organizations.
 *
 * Each one carries its own token, because one token per GitHub org is the
 * normal case. A token can be sent from here but never comes back: the API
 * returns only whether one is stored and its last four characters.
 */
export function Organizations({ onAuthLost }: { onAuthLost: () => void }) {
  const list = useApi<{ count: number; organizations: Organization[] }>('/organizations', onAuthLost);
  const [login, setLogin] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [tokenEdit, setTokenEdit] = useState<Record<string, string>>({});
  const [picking, setPicking] = useState<string | null>(null);

  const reportError = useCallback((text: string) => setMessage({ kind: 'error', text }), []);

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ kind: 'ok', text: await action() });
      list.reload();
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const org = await api.post<Organization>('/organizations', {
        login,
        token: token || undefined,
      });
      setLogin('');
      setToken('');
      return `Added ${org.key}${org.hasToken ? ' with a token' : ' without a token'}`;
    });
  }

  function importResultText(result: ImportResult) {
    const skipped = result.skippedDeleted.length
      ? `, ${result.skippedDeleted.length} left out (removed here earlier)`
      : '';
    const missing = result.notFound?.length ? `, ${result.notFound.length} not found on GitHub` : '';
    return `${result.login}: ${result.imported} of ${result.found} repositories imported${skipped}${missing}`;
  }

  return (
    <Window
      title="ORGANIZATIONS.CFG"
      note={list.data ? `${list.data.count} registered` : undefined}
      accent="var(--lime)"
      actions={
        <button
          disabled={busy}
          onClick={() =>
            run(async () => {
              const res = await api.post<{ organizations: number; imported: number; errors: { org: string; error: string }[] }>(
                '/organizations/import'
              );
              return `Imported ${res.imported} repositories from ${res.organizations} organizations${
                res.errors.length ? `, ${res.errors.length} failed` : ''
              }`;
            })
          }
        >
          Import all
        </button>
      }
    >
      <Body>
        <p className="muted">
          Everything Atalaia does against GitHub is read-only: it lists repositories and reads
          manifests. It never writes anything back.
        </p>

        <form className="toolbar" onSubmit={add}>
          <label style={{ flex: 1, minWidth: '12rem' }}>
            Organization or user
            <input
              value={login}
              onChange={e => setLogin(e.target.value)}
              placeholder="my-company"
              required
            />
          </label>
          <label style={{ flex: 1, minWidth: '12rem' }}>
            Access token
            <input
              type="password"
              value={token}
              onChange={e => setToken(e.target.value)}
              placeholder="ghp_… (read-only scope)"
              autoComplete="off"
            />
          </label>
          <button className="primary" type="submit" disabled={busy || !login}>
            Add
          </button>
        </form>

        {message ? <Notice kind={message.kind}>{message.text}</Notice> : null}
        {list.error ? <Notice kind="error">{list.error}</Notice> : null}
        {list.loading ? <Loading what="organizations" /> : null}

        {list.data && list.data.organizations.length === 0 ? (
          <Empty>
            No organizations yet. Add one with a read-only token to import its repositories.
          </Empty>
        ) : null}

        {list.data && list.data.organizations.length > 0 ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Login</th>
                  <th>Token</th>
                  <th>Repositories</th>
                  <th>Last import</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.data.organizations.map(org => (
                  <Fragment key={org.key}>
                  <tr style={{ opacity: org.enabled ? 1 : 0.6 }}>
                    <td className="mono">{org.key}</td>
                    <td>
                      <a
                        href={`https://github.com/${org.login}`}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        {org.login}
                      </a>
                    </td>
                    <td className="tight mono">
                      {org.hasToken ? org.tokenHint : <span className="muted">none</span>}
                    </td>
                    <td className="tight mono">
                      {org.repositories ? `${org.repositories.enabled}/${org.repositories.total}` : '—'}
                    </td>
                    <td className="tight mono">{formatDate(org.lastImportAt)}</td>
                    <td className="tight">
                      <span className="cell-actions">
                        <button
                          onClick={() => setPicking(picking === org.key ? null : org.key)}
                        >
                          {picking === org.key ? 'Close' : 'Choose repos'}
                        </button>
                        <button
                          disabled={busy}
                          onClick={() =>
                            run(async () =>
                              importResultText(
                                await api.post<ImportResult>(`/organizations/${org.key}/import`)
                              )
                            )
                          }
                        >
                          Import all
                        </button>
                        <button
                          disabled={busy}
                          onClick={() =>
                            run(async () => {
                              await api.patch(`/organizations/${org.key}`, { enabled: !org.enabled });
                              return `${org.key} ${org.enabled ? 'disabled' : 'enabled'}`;
                            })
                          }
                        >
                          {org.enabled ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          className="danger"
                          disabled={busy}
                          onClick={() =>
                            run(async () => {
                              const res = await api.del<{ repositories: number }>(
                                `/organizations/${org.key}`
                              );
                              return `Removed ${org.key} and ${res.repositories} repositories`;
                            })
                          }
                        >
                          Remove
                        </button>
                      </span>

                      <span className="cell-actions" style={{ marginTop: '0.3rem' }}>
                        <input
                          type="password"
                          value={tokenEdit[org.key] ?? ''}
                          onChange={e => setTokenEdit(prev => ({ ...prev, [org.key]: e.target.value }))}
                          placeholder={org.hasToken ? 'replace token' : 'add token'}
                          autoComplete="off"
                          style={{ width: '10rem' }}
                        />
                        <button
                          disabled={busy || !tokenEdit[org.key]}
                          onClick={() =>
                            run(async () => {
                              await api.patch(`/organizations/${org.key}`, {
                                token: tokenEdit[org.key],
                              });
                              setTokenEdit(prev => ({ ...prev, [org.key]: '' }));
                              return `Token stored for ${org.key}`;
                            })
                          }
                        >
                          Save
                        </button>
                      </span>
                    </td>
                  </tr>

                  {picking === org.key ? (
                    <tr>
                      <td colSpan={6}>
                        <RepositoryPicker
                          orgKey={org.key}
                          onError={reportError}
                          onImported={result => {
                            setMessage({ kind: 'ok', text: importResultText(result) });
                            setPicking(null);
                            list.reload();
                          }}
                        />
                      </td>
                    </tr>
                  ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Body>
    </Window>
  );
}
