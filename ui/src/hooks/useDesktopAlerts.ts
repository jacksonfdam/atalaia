import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { api } from '../api/client';
import type { VulnerabilityPage } from '../types';

/**
 * Desktop notifications for new vulnerabilities.
 *
 * The fallback for when Slack is not delivering: the console polls for what
 * appeared since it last looked and raises a native notification per finding.
 *
 * The state lives in a module-level store rather than in each component,
 * because two components use this hook — the settings panel, which turns it on,
 * and the shell, which does the polling. With per-component state the shell
 * would keep its stale copy and only start polling after a reload, which reads
 * as "notifications do not work".
 *
 * Two limits worth knowing, both from the browser: the console has to be open
 * in a tab (a closed tab runs no code), and permission can only be requested
 * from a real click.
 */

const ENABLED_KEY = 'atalaia.desktopAlerts.enabled';
const SEEN_KEY = 'atalaia.desktopAlerts.lastSeen';
const POLL_MS = 60_000;
const MAX_PER_ROUND = 3;

export type AlertPermission = 'unsupported' | 'default' | 'granted' | 'denied';

function currentPermission(): AlertPermission {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
    return Notification.permission as AlertPermission;
}

function read(key: string): string | null {
    try {
        return window.localStorage.getItem(key);
    } catch {
        // Private browsing can refuse storage; the feature degrades to
        // per-session rather than breaking the console.
        return null;
    }
}

function write(key: string, value: string) {
    try {
        window.localStorage.setItem(key, value);
    } catch {
        /* see read() */
    }
}

interface AlertState {
    permission: AlertPermission;
    enabled: boolean;
    lastCheckedAt: string | null;
    lastError: string | null;
}

let state: AlertState = {
    permission: currentPermission(),
    enabled: read(ENABLED_KEY) === 'true',
    lastCheckedAt: null,
    lastError: null,
};

const listeners = new Set<() => void>();

/**
 * Permission can change without this page asking: the browser's own site
 * settings, or another tab. Read once at module load it goes stale, and the
 * panel then shows "Blocked" with no way forward long after the operator
 * allowed notifications — which reads as the feature being broken.
 */
function watchPermission() {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return;

    navigator.permissions
        .query({ name: 'notifications' as PermissionName })
        .then(status => {
            status.onchange = () => setState({ permission: currentPermission() });
        })
        .catch(() => {
            // Safari refuses this query; the visibility listener below covers it.
        });
}

function setState(patch: Partial<AlertState>) {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

watchPermission();

function severityMark(severity: string): string {
    if (severity === 'CRITICAL') return '🔴';
    if (severity === 'HIGH') return '🟠';
    if (severity === 'MEDIUM') return '🟡';
    if (severity === 'LOW') return '🔵';
    return '⚪';
}

/**
 * Raise one notification, reporting a refusal instead of swallowing it.
 *
 * No `icon`: the console ships no favicon, and the SPA catch-all answers
 * `/favicon.ico` with index.html, so the browser was handed an HTML document
 * where an image belonged. Chrome decodes the icon before handing the
 * notification to macOS, which is a way to lose the notification entirely for
 * decoration nobody asked for.
 *
 * @returns {string|null} Why it failed, or null when it was raised
 */
function show(title: string, body: string, cveId?: string): string | null {
    try {
        const notification = new Notification(title, cveId ? { body, tag: cveId } : { body });

        notification.onclick = () => {
            window.focus();
            if (cveId) window.location.href = `/vulnerabilities/${cveId}`;
        };

        return null;
    } catch (err) {
        // The constructor throws where notifications must come from a service
        // worker. Without this the click handler threw into nothing and the
        // panel looked like it had simply ignored the button.
        return (err as Error).message;
    }
}

export function useDesktopAlerts({ active = true }: { active?: boolean } = {}) {
    const snapshot = useSyncExternalStore(subscribe, () => state);

    // Held in a ref so a tick does not restart the polling effect.
    const lastSeen = useRef<string | null>(read(SEEN_KEY));

    const request = useCallback(async () => {
        if (!('Notification' in window)) return 'unsupported' as AlertPermission;

        const result = (await Notification.requestPermission()) as AlertPermission;

        if (result === 'granted') {
            write(ENABLED_KEY, 'true');
            setState({ permission: result, enabled: true });
        } else {
            setState({ permission: result });
        }

        return result;
    }, []);

    const toggle = useCallback((next: boolean) => {
        write(ENABLED_KEY, String(next));
        setState({ enabled: next });
    }, []);

    const sendSample = useCallback(() => {
        // Read the permission fresh: it can have been revoked in site settings
        // since this module loaded, and claiming to have sent something the
        // browser refused is worse than saying so.
        const permission = currentPermission();
        if (permission !== 'granted') {
            setState({ permission, lastError: `The browser will not show notifications (${permission})` });
            return false;
        }

        const failure = show(
            '🔴 Atalaia desktop alerts',
            'This is what a new vulnerability will look like.'
        );

        setState({ lastError: failure });
        return failure === null;
    }, []);

    // Re-read the permission whenever the operator comes back to the tab. This
    // is the fallback for browsers that will not report a permission change,
    // and it costs one synchronous property read.
    useEffect(() => {
        const sync = () => setState({ permission: currentPermission() });

        document.addEventListener('visibilitychange', sync);
        window.addEventListener('focus', sync);

        return () => {
            document.removeEventListener('visibilitychange', sync);
            window.removeEventListener('focus', sync);
        };
    }, []);

    useEffect(() => {
        if (!active || !snapshot.enabled || snapshot.permission !== 'granted') return;

        let cancelled = false;

        async function poll() {
            try {
                const page = await api.get<VulnerabilityPage>(
                    '/vulnerabilities?limit=10&sort=first_seen_at&order=desc'
                );
                if (cancelled) return;

                setState({ lastCheckedAt: new Date().toISOString(), lastError: null });

                const newest = page.vulnerabilities[0]?.first_seen_at ?? null;

                // First run only records where we are: without it, enabling the
                // feature would fire a notification for every row already there.
                if (!lastSeen.current) {
                    if (newest) {
                        lastSeen.current = newest;
                        write(SEEN_KEY, newest);
                    }
                    return;
                }

                const fresh = page.vulnerabilities.filter(v => v.first_seen_at > lastSeen.current!);
                if (fresh.length === 0) return;

                for (const vuln of fresh.slice(0, MAX_PER_ROUND)) {
                    const failure = show(
                        `${severityMark(vuln.severity)} ${vuln.severity} · ${vuln.cve_id}`,
                        vuln.title ?? 'New vulnerability',
                        vuln.cve_id
                    );

                    // A browser refusing to raise notifications is worth saying
                    // once, not silently every minute.
                    if (failure) setState({ lastError: failure });
                }

                // One summary instead of twenty notifications after a big cycle.
                if (fresh.length > MAX_PER_ROUND) {
                    show(
                        `Atalaia: ${fresh.length} new vulnerabilities`,
                        `${fresh.length - MAX_PER_ROUND} more since the last check.`
                    );
                }

                lastSeen.current = newest;
                if (newest) write(SEEN_KEY, newest);
            } catch (err) {
                if (!cancelled) setState({ lastError: (err as Error).message });
            }
        }

        poll();
        const timer = window.setInterval(poll, POLL_MS);

        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [active, snapshot.enabled, snapshot.permission]);

    return {
        ...snapshot,
        supported: snapshot.permission !== 'unsupported',
        // requestPermission() is refused outside a secure context, and http on
        // anything but localhost is not one — worth saying out loud rather than
        // leaving a button that silently does nothing.
        secureContext: typeof window !== 'undefined' ? window.isSecureContext : false,
        request,
        toggle,
        sendSample,
        pollSeconds: POLL_MS / 1000,
    };
}
