import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { VulnerabilityPage } from '../types';

/**
 * Desktop notifications for new vulnerabilities.
 *
 * The fallback for when Slack is not delivering: the console polls for what
 * appeared since it last looked and raises a native notification per finding.
 *
 * Two limits worth knowing, both from the browser rather than from Atalaia: the
 * console has to be open in a tab (a closed tab runs no code), and the user has
 * to grant permission, which only a real click can ask for.
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

function severityMark(severity: string): string {
    if (severity === 'CRITICAL') return '🔴';
    if (severity === 'HIGH') return '🟠';
    if (severity === 'MEDIUM') return '🟡';
    if (severity === 'LOW') return '🔵';
    return '⚪';
}

export function useDesktopAlerts({ active = true }: { active?: boolean } = {}) {
    const [permission, setPermission] = useState<AlertPermission>(currentPermission);
    const [enabled, setEnabled] = useState(() => read(ENABLED_KEY) === 'true');
    const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);

    // Held in a ref so the polling effect does not restart on every tick.
    const lastSeen = useRef<string | null>(read(SEEN_KEY));

    const request = useCallback(async () => {
        if (!('Notification' in window)) return 'unsupported' as AlertPermission;

        const result = (await Notification.requestPermission()) as AlertPermission;
        setPermission(result);
        if (result === 'granted') {
            setEnabled(true);
            write(ENABLED_KEY, 'true');
        }
        return result;
    }, []);

    const toggle = useCallback(
        (next: boolean) => {
            setEnabled(next);
            write(ENABLED_KEY, String(next));
        },
        []
    );

    const notify = useCallback((title: string, body: string, cveId?: string) => {
        const notification = new Notification(title, { body, tag: cveId, icon: '/favicon.ico' });

        notification.onclick = () => {
            window.focus();
            if (cveId) window.location.href = `/vulnerabilities/${cveId}`;
        };
    }, []);

    const sendSample = useCallback(() => {
        if (permission !== 'granted') return false;
        notify('🔴 Atalaia desktop alerts', 'This is what a new vulnerability will look like.');
        return true;
    }, [notify, permission]);

    useEffect(() => {
        if (!active || !enabled || permission !== 'granted') return;

        let cancelled = false;

        async function poll() {
            try {
                const page = await api.get<VulnerabilityPage>(
                    '/vulnerabilities?limit=10&sort=first_seen_at&order=desc'
                );
                if (cancelled) return;

                setLastCheckedAt(new Date().toISOString());

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
                    notify(
                        `${severityMark(vuln.severity)} ${vuln.severity} · ${vuln.cve_id}`,
                        vuln.title ?? 'New vulnerability',
                        vuln.cve_id
                    );
                }

                // One summary instead of twenty notifications after a big cycle.
                if (fresh.length > MAX_PER_ROUND) {
                    notify(
                        `Atalaia: ${fresh.length} new vulnerabilities`,
                        `${fresh.length - MAX_PER_ROUND} more since the last check.`
                    );
                }

                lastSeen.current = newest;
                if (newest) write(SEEN_KEY, newest);
            } catch {
                // A failed poll is not worth surfacing: the next one is a minute
                // away, and the pages themselves already report API errors.
            }
        }

        poll();
        const timer = window.setInterval(poll, POLL_MS);

        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [active, enabled, permission, notify]);

    return {
        permission,
        enabled,
        lastCheckedAt,
        supported: permission !== 'unsupported',
        request,
        toggle,
        sendSample,
        pollSeconds: POLL_MS / 1000,
    };
}
