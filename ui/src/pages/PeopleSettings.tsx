import { useCallback, useEffect, useState } from 'react';
import { Window, Body, Loading, Notice, formatDate } from '../components/ui';
import {
  invite,
  inviteLink,
  listInvitations,
  listPeople,
  resetPerson,
  revokeInvitation,
  type Invitation,
  type PersonRow,
} from '../api/passkeys';

/**
 * Who can sign in.
 *
 * Registration is not open — a passkey proves possession of an authenticator
 * and nothing about who is allowed in — so an account exists because somebody
 * here invited it. The invitation is a single-use link that expires.
 */
export function PeopleSettings() {
  const [people, setPeople] = useState<PersonRow[] | null>(null);
  const [invitations, setInvitations] = useState<Invitation[] | null>(null);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [codes, setCodes] = useState<{ username: string; codes: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    const [users, invites] = await Promise.all([listPeople(), listInvitations()]);
    setPeople(users.users);
    setInvitations(invites.invites);
  }, []);

  useEffect(() => {
    load().catch(err => setMessage({ kind: 'error', text: (err as Error).message }));
  }, [load]);

  async function run(action: () => Promise<string | null>) {
    setBusy(true);
    setMessage(null);

    try {
      const text = await action();
      await load();
      if (text) setMessage({ kind: 'ok', text });
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Window title="PEOPLE.SYS" accent="var(--accent-secondary)">
        <Body>
          {people === null ? <Loading what="accounts" /> : null}
          {message ? <Notice kind={message.kind}>{message.text}</Notice> : null}

          {codes ? (
            <>
              <Notice kind="error">
                New recovery codes for {codes.username}. Shown once — pass them on now.
              </Notice>
              <pre className="recovery-codes">{codes.codes.join('\n')}</pre>
            </>
          ) : null}

          {people?.length ? (
            <table className="grid">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Role</th>
                  <th>Passkeys</th>
                  <th>Since</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {people.map(person => (
                  <tr key={person.id}>
                    <td>
                      <strong>{person.username}</strong>
                      <div className="muted">{person.display_name}</div>
                    </td>
                    <td>{person.is_admin ? 'administrator' : 'operator'}</td>
                    {/* Zero means an invitation that was never finished: the
                        row exists, but nothing can sign in as it. */}
                    <td>{person.credential_count || 'none yet'}</td>
                    <td>{formatDate(person.created_at)}</td>
                    <td>
                      <button
                        disabled={busy || person.credential_count === 0}
                        onClick={() =>
                          run(async () => {
                            const result = await resetPerson(person.id);
                            setCodes({ username: person.username, codes: result.codes });
                            return `Removed ${result.removed} passkey${result.removed === 1 ? '' : 's'}`;
                          })
                        }
                      >
                        Reset passkeys
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </Body>
      </Window>

      <Window title="INVITE.EXE" accent="var(--accent-tertiary)">
        <Body>
          {link ? (
            <>
              <Notice kind="ok">
                Single-use, and it expires in three days. This is the only time the link is shown.
              </Notice>
              <pre className="recovery-codes">{link}</pre>
            </>
          ) : null}

          <div className="toolbar">
            <label>
              Username
              <input value={username} onChange={event => setUsername(event.target.value)} />
            </label>

            <label>
              Display name
              <input
                value={displayName}
                placeholder="Optional"
                onChange={event => setDisplayName(event.target.value)}
              />
            </label>

            <label className="row" style={{ gap: '0.3rem', alignSelf: 'flex-end' }}>
              <input
                type="checkbox"
                checked={isAdmin}
                onChange={event => setIsAdmin(event.target.checked)}
              />
              Administrator
            </label>

            <button
              className="primary"
              disabled={busy || username.trim().length === 0}
              style={{ alignSelf: 'flex-end' }}
              onClick={() =>
                run(async () => {
                  const result = await invite({
                    username: username.trim(),
                    displayName: displayName.trim() || undefined,
                    isAdmin,
                  });

                  setLink(inviteLink(result.token));
                  setUsername('');
                  setDisplayName('');
                  setIsAdmin(false);
                  return null;
                })
              }
            >
              Invite
            </button>
          </div>

          {invitations?.length ? (
            <table className="grid">
              <thead>
                <tr>
                  <th>Invited</th>
                  <th>Role</th>
                  <th>Expires</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {invitations.map(invitation => (
                  <tr key={invitation.id}>
                    <td>{invitation.username}</td>
                    <td>{invitation.is_admin ? 'administrator' : 'operator'}</td>
                    <td>{formatDate(invitation.expires_at)}</td>
                    <td>
                      <button
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            await revokeInvitation(invitation.id);
                            return 'Invitation revoked';
                          })
                        }
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">No invitations outstanding.</p>
          )}
        </Body>
      </Window>
    </>
  );
}
