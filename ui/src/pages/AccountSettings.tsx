import { useCallback, useEffect, useState } from 'react';
import { Window, Body, Loading, Notice, formatDate } from '../components/ui';
import { auth, type SessionInfo } from '../api/client';
import {
  deletePasskey,
  describeCeremonyError,
  enrollPasskey,
  listPasskeys,
  renamePasskey,
  reissueRecoveryCodes,
  supportsPasskeys,
  type Credential,
} from '../api/passkeys';

/**
 * The account: its passkeys, and the way back in if they are lost.
 *
 * One passkey is a single point of failure that looks fine until the day it
 * is not, so an account holding one is told so here and in the sidebar until
 * it holds two.
 */
export function AccountSettings() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [credentials, setCredentials] = useState<Credential[] | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    const [info, list] = await Promise.all([auth.session(), listPasskeys()]);
    setSession(info);
    setCredentials(list.credentials);
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
      setMessage({ kind: 'error', text: describeCeremonyError(err) });
    } finally {
      setBusy(false);
    }
  }

  const only = (credentials?.length ?? 0) <= 1;

  return (
    <>
      <Window
        title="PASSKEYS.SYS"
        note={session?.user?.username}
        accent="var(--accent-primary)"
        actions={
          <button
            className="primary"
            disabled={busy || !supportsPasskeys()}
            onClick={() =>
              run(async () => {
                await enrollPasskey();
                return 'Passkey enrolled';
              })
            }
          >
            Add a passkey
          </button>
        }
      >
        <Body>
          {credentials === null ? <Loading what="passkeys" /> : null}
          {message ? <Notice kind={message.kind}>{message.text}</Notice> : null}

          {credentials && only ? (
            <Notice kind="error">
              This account has one passkey. Lose the device holding it and the only way back is a
              recovery code. Add a second one — a phone, a security key, another laptop.
            </Notice>
          ) : null}

          {credentials?.length ? (
            <table className="grid">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Added</th>
                  <th>Last used</th>
                  <th>Synced</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {credentials.map(credential => (
                  <tr key={credential.id}>
                    <td>
                      <input
                        defaultValue={credential.nickname ?? ''}
                        placeholder="Unnamed"
                        onBlur={event => {
                          const nickname = event.target.value.trim();
                          if (nickname === (credential.nickname ?? '')) return;
                          void run(async () => {
                            await renamePasskey(credential.id, nickname);
                            return null;
                          });
                        }}
                      />
                    </td>
                    <td>{formatDate(credential.createdAt)}</td>
                    <td>{credential.lastUsedAt ? formatDate(credential.lastUsedAt) : 'never'}</td>
                    {/* A backed-up credential survives the device it was made
                        on; one that does not is gone with the hardware. */}
                    <td>{credential.backedUp ? 'yes' : 'this device only'}</td>
                    <td>
                      <button
                        disabled={busy || only}
                        title={only ? 'The only passkey on the account' : undefined}
                        onClick={() =>
                          run(async () => {
                            await deletePasskey(credential.id);
                            return 'Passkey removed';
                          })
                        }
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </Body>
      </Window>

      <Window title="RECOVERY.TXT" accent="var(--severity-high)">
        <Body>
          <p className="muted">
            {session?.recoveryCodesRemaining ?? 0} unused code
            {session?.recoveryCodesRemaining === 1 ? '' : 's'} left. Issuing a new set invalidates
            every code outstanding, and the new ones are shown once.
          </p>

          {codes ? <pre className="recovery-codes">{codes.join('\n')}</pre> : null}

          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                const result = await reissueRecoveryCodes();
                setCodes(result.codes);
                return 'Ten new codes. The old ones no longer work.';
              })
            }
          >
            Issue new recovery codes
          </button>
        </Body>
      </Window>
    </>
  );
}
