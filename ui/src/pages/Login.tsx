import { useState, type FormEvent } from 'react';
import { auth } from '../api/client';
import { Window, Body, Notice } from '../components/ui';

export function Login({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const result = await auth.login(password);
    setBusy(false);

    if (result.ok) {
      setPassword('');
      onAuthenticated();
    } else {
      setError(result.error ?? 'Login failed');
    }
  }

  return (
    <div className="login-screen">
      <Window title="ATALAIA_CONSOLE.EXE" accent="var(--accent-primary)">
        <Body>
          <div style={{ marginBottom: '0.7rem' }}>
            <span className="eyebrow">Vulnerability intelligence</span>
            <h1>Atalaia Console</h1>
          </div>

          <form className="login-form" onSubmit={submit}>
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                autoFocus
                autoComplete="current-password"
                required
              />
            </label>

            {error ? <Notice kind="error">{error}</Notice> : null}

            <button className="primary" type="submit" disabled={busy || password.length === 0}>
              {busy ? 'Checking…' : 'Sign in'}
            </button>
          </form>

          <p className="muted" style={{ marginTop: '0.7rem' }}>
            The console holds the Atalaia API key server-side; it is never sent to this browser.
          </p>
        </Body>
      </Window>
    </div>
  );
}
