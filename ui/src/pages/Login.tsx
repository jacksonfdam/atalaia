import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Window, Body, Notice } from '../components/ui';
import {
  acceptInvite,
  authState,
  bootstrap,
  describeCeremonyError,
  enrollPasskey,
  recover,
  signIn,
  supportsAutofill,
  supportsPasskeys,
} from '../api/passkeys';

/**
 * The sign-in screen.
 *
 * Four things can be true when somebody arrives here, and the screen has to
 * work out which without asking: the installation has no accounts yet, they are
 * holding an invitation, they have a passkey, or they have lost it and are
 * holding a recovery code.
 */

type Mode = 'signin' | 'bootstrap' | 'invite' | 'recovery';

/** An invitation arrives as a link, so the token is in the address. */
function inviteFromUrl(): string | null {
  const value = new URLSearchParams(window.location.search).get('invite');
  return value && value.length > 0 ? value : null;
}

export function Login({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);

  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [setupPassword, setSetupPassword] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');

  const supported = supportsPasskeys();
  const conditional = useRef<AbortController | null>(null);
  const invite = useRef<string | null>(inviteFromUrl());

  useEffect(() => {
    authState()
      .then(state => {
        if (invite.current) return setMode('invite');
        setMode(state.bootstrapped ? 'signin' : 'bootstrap');
      })
      .catch(err => {
        setError(err.message);
        setMode('signin');
      });
  }, []);

  /**
   * Hand a request to the browser's autofill, so a passkey can be picked from
   * the address bar without pressing anything here first.
   *
   * A conditional request never resolves on its own. It has to be aborted when
   * this screen goes away or when the user signs in another way, or the next
   * request is refused while it is still pending.
   */
  useEffect(() => {
    if (mode !== 'signin' || !supported) return;

    let cancelled = false;

    (async () => {
      if (!(await supportsAutofill())) return;
      if (cancelled) return;

      const controller = new AbortController();
      conditional.current = controller;

      try {
        await signIn({ conditional: true, signal: controller.signal });
        if (!cancelled) onAuthenticated();
      } catch {
        // Abandoning the autofill prompt is the normal case, not a failure.
        // Anything real will be reported when the button is pressed.
      }
    })();

    return () => {
      cancelled = true;
      conditional.current?.abort();
      conditional.current = null;
    };
  }, [mode, supported, onAuthenticated]);

  function abortConditional() {
    conditional.current?.abort();
    conditional.current = null;
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    abortConditional();

    try {
      await action();
      onAuthenticated();
    } catch (err) {
      // Recovery codes are on screen and have to be read before the console
      // opens; the action says so by throwing rather than by returning.
      if (err instanceof Held) return setBusy(false);

      setError(describeCeremonyError(err));
      setBusy(false);
    }
  }

  const submitBootstrap = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const result = await bootstrap({
        username: username.trim(),
        displayName: displayName.trim() || username.trim(),
        setupPassword,
      });

      // Shown before the console opens, because they are shown exactly once.
      if (result.recoveryCodes) {
        setCodes(result.recoveryCodes);
        throw new Held();
      }
    });
  };

  const submitInvite = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const result = await acceptInvite(invite.current ?? '');
      if (result.recoveryCodes) {
        setCodes(result.recoveryCodes);
        throw new Held();
      }
    });
  };

  const submitRecovery = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await recover({ username: username.trim(), code: recoveryCode });
      // The recovery session exists to do exactly this and nothing else.
      await enrollPasskey('Enrolled during recovery');
    });
  };

  if (codes) {
    return (
      <div className="login-screen">
        <Window title="RECOVERY_CODES.TXT" accent="var(--severity-high)">
          <Body>
            <h1>Keep these somewhere safe</h1>
            <p className="muted">
              Ten single-use codes. They are the way back in if the passkey is ever gone, and this
              is the only time they are shown.
            </p>

            <pre className="recovery-codes">{codes.join('\n')}</pre>

            <button className="primary" onClick={onAuthenticated}>
              I have saved them
            </button>
          </Body>
        </Window>
      </div>
    );
  }

  if (mode === null) return <div className="loading">Starting console…</div>;

  return (
    <div className="login-screen">
      <Window title="ATALAIA_CONSOLE.EXE" accent="var(--accent-primary)">
        <Body>
          <div style={{ marginBottom: '0.7rem' }}>
            <span className="eyebrow">Vulnerability intelligence</span>
            <h1>Atalaia Console</h1>
          </div>

          {!supported ? (
            <Notice kind="error">
              This browser cannot do passkeys. Recent Chrome, Edge, Safari or Firefox can — the
              console has no password to fall back to.
            </Notice>
          ) : null}

          {mode === 'bootstrap' ? (
            <form className="login-form" onSubmit={submitBootstrap}>
              <p className="muted">
                No account exists yet. The setup password creates the first one, and stops working
                the moment it has.
              </p>

              <label>
                Username
                <input
                  value={username}
                  onChange={event => setUsername(event.target.value)}
                  autoComplete="username webauthn"
                  autoFocus
                  required
                />
              </label>

              <label>
                Display name
                <input
                  value={displayName}
                  onChange={event => setDisplayName(event.target.value)}
                  placeholder="Optional"
                />
              </label>

              <label>
                Setup password
                <input
                  type="password"
                  value={setupPassword}
                  onChange={event => setSetupPassword(event.target.value)}
                  autoComplete="one-time-code"
                  required
                />
              </label>

              {error ? <Notice kind="error">{error}</Notice> : null}

              <button className="primary" type="submit" disabled={busy || !supported}>
                {busy ? 'Waiting for the authenticator…' : 'Create the first account'}
              </button>
            </form>
          ) : null}

          {mode === 'invite' ? (
            <form className="login-form" onSubmit={submitInvite}>
              <p className="muted">
                You have been invited to this console. Registering a passkey completes the account.
              </p>

              {error ? <Notice kind="error">{error}</Notice> : null}

              <button className="primary" type="submit" disabled={busy || !supported}>
                {busy ? 'Waiting for the authenticator…' : 'Register a passkey'}
              </button>
            </form>
          ) : null}

          {mode === 'signin' ? (
            <form
              className="login-form"
              onSubmit={event => {
                event.preventDefault();
                void run(() => signIn());
              }}
            >
              {/* The autocomplete token is what offers passkeys in the address
                  bar. The field itself is not sent anywhere: a discoverable
                  credential already knows who it is. */}
              <label>
                Account
                <input
                  name="username"
                  autoComplete="username webauthn"
                  placeholder="Pick a passkey, or press the button"
                  value={username}
                  onChange={event => setUsername(event.target.value)}
                />
              </label>

              {error ? <Notice kind="error">{error}</Notice> : null}

              {/* Always rendered, never only autofill: conditional UI does not
                  exist on Windows 10 or on Firefox for Android, and without
                  this button those browsers have no way in at all. */}
              <button className="primary" type="submit" disabled={busy || !supported}>
                {busy ? 'Waiting for the authenticator…' : 'Sign in with a passkey'}
              </button>

              <button
                type="button"
                className="link"
                onClick={() => {
                  abortConditional();
                  setError(null);
                  setMode('recovery');
                }}
              >
                Lost your passkey?
              </button>
            </form>
          ) : null}

          {mode === 'recovery' ? (
            <form className="login-form" onSubmit={submitRecovery}>
              <p className="muted">
                A recovery code buys one thing: enrolling a new passkey. Have the authenticator
                ready — the prompt follows immediately.
              </p>

              <label>
                Username
                <input
                  value={username}
                  onChange={event => setUsername(event.target.value)}
                  autoComplete="username"
                  autoFocus
                  required
                />
              </label>

              <label>
                Recovery code
                <input
                  value={recoveryCode}
                  onChange={event => setRecoveryCode(event.target.value)}
                  placeholder="XXXXXX-XXXXXX-XXXXXX-XXXXXX"
                  autoComplete="one-time-code"
                  required
                />
              </label>

              {error ? <Notice kind="error">{error}</Notice> : null}

              <button className="primary" type="submit" disabled={busy || !supported}>
                {busy ? 'Working…' : 'Use the code and enroll a passkey'}
              </button>

              <button type="button" className="link" onClick={() => { setError(null); setMode('signin'); }}>
                Back to sign in
              </button>
            </form>
          ) : null}

          <p className="muted" style={{ marginTop: '0.7rem' }}>
            The console holds the Atalaia API key server-side; it is never sent to this browser.
          </p>
        </Body>
      </Window>
    </div>
  );
}

/**
 * Thrown to stop `run` from opening the console while recovery codes are still
 * on screen. Caught there, never surfaced.
 */
class Held extends Error {}
