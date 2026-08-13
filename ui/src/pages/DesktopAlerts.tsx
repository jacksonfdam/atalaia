import { useState } from 'react';
import { Window, Body, Notice } from '../components/ui';
import { useApi } from '../hooks/useApi';
import { useDesktopAlerts } from '../hooks/useDesktopAlerts';
import type { SlackPayload } from '../types';

const PERMISSION_LABEL: Record<string, string> = {
    unsupported: 'This browser has no notification support',
    default: 'Permission not asked yet',
    granted: 'Allowed',
    denied: 'Blocked in the browser',
};

/**
 * Desktop notifications — the fallback when Slack is not delivering.
 *
 * Slack's state only changes the wording here: an operator may well want both,
 * and switching this off because Slack came back would be worse than a
 * duplicate notification.
 *
 * The polling itself lives in the shell, so alerts keep arriving on every page;
 * this instance only renders the controls.
 */
export function DesktopAlerts({ onAuthLost }: { onAuthLost: () => void }) {
    const slack = useApi<SlackPayload>('/settings/slack', onAuthLost);
    const slackReady = slack.data?.status.ready ?? true;
    const alerts = useDesktopAlerts({ active: false });
    const [message, setMessage] = useState<string | null>(null);

    async function enable() {
        const result = await alerts.request();

        if (result === 'granted') {
            // Immediate proof it works — including that the operating system is
            // letting the browser through, which the browser cannot report.
            alerts.sendSample();
            setMessage('Allowed. A sample notification was just sent — if nothing appeared, the notification is being blocked by the operating system, not by Atalaia.');
            return;
        }

        setMessage(
            result === 'denied'
                ? 'The browser blocked notifications for this site. Allow them in the site settings and try again.'
                : 'The permission prompt was dismissed.'
        );
    }

    return (
        <Window
            title="DESKTOP.CFG"
            note={alerts.enabled && alerts.permission === 'granted' ? 'on' : 'off'}
            accent="var(--violet)"
            actions={
                alerts.permission === 'granted' ? (
                    <>
                        <button onClick={() => alerts.sendSample()}>Send test</button>
                        <button onClick={() => alerts.toggle(!alerts.enabled)}>
                            {alerts.enabled ? 'Turn off' : 'Turn on'}
                        </button>
                    </>
                ) : (
                    <button className="primary" disabled={!alerts.supported} onClick={enable}>
                        Allow notifications
                    </button>
                )
            }
        >
            <Body>
                {message ? <Notice>{message}</Notice> : null}

                {!slackReady ? (
                    <Notice>
                        Slack is not delivering right now, so this is the only channel that will tell
                        you about a new vulnerability while you are at your desk.
                    </Notice>
                ) : null}

                {!alerts.secureContext ? (
                    <Notice kind="error">
                        This page is not a secure context, so the browser refuses to grant
                        notification permission at all. Open the console over{' '}
                        <code className="mono">https</code> or on{' '}
                        <code className="mono">localhost</code>.
                    </Notice>
                ) : null}

                <p className="muted">
                    Status: {PERMISSION_LABEL[alerts.permission]}
                    {alerts.permission === 'granted' && !alerts.enabled ? ' · switched off here' : ''}
                    {alerts.lastCheckedAt ? ` · last checked ${new Date(alerts.lastCheckedAt).toLocaleTimeString()}` : ''}
                </p>

                {alerts.permission === 'granted' && alerts.enabled && !alerts.lastCheckedAt ? (
                    <p className="muted">Waiting for the first check…</p>
                ) : null}

                {alerts.lastError ? <Notice kind="error">Last check failed: {alerts.lastError}</Notice> : null}

                {alerts.permission === 'denied' ? (
                    <p className="muted">
                        Chrome: click the icon at the left of the address bar → Notifications → Allow.
                        On macOS the system also has to allow the browser itself, under System
                        Settings → Notifications.
                    </p>
                ) : null}

                <p className="muted">
                    The console checks for new findings every {alerts.pollSeconds} seconds and pops up
                    one notification per CVE, collapsing a burst into a single summary. Clicking one
                    opens that CVE.
                </p>

                <p className="muted">
                    This needs the console open in a tab — a closed tab runs no code. For alerts that
                    arrive with the browser shut, use Slack or the weekly email.
                </p>
            </Body>
        </Window>
    );
}
