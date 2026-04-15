// Ambient module declarations for plain-JS Atalaia modules consumed by the CLI.
// Keep minimal — declare only what the CLI actually calls.

declare module '#app/application/acknowledgeVuln.js' {
  export interface VulnCache {
    get(cveId: string): any;
    update(cveId: string, updates: Record<string, unknown>): void;
  }
  export function acknowledgeVuln(
    cveId: string,
    changedBy: string,
    cache: VulnCache
  ): Promise<any>;
}

declare module '#app/application/resolveVuln.js' {
  export interface VulnCache {
    get(cveId: string): any;
    update(cveId: string, updates: Record<string, unknown>): void;
  }
  export function resolveVuln(
    cveId: string,
    changedBy: string,
    cache: VulnCache
  ): Promise<any>;
}

declare module '#app/application/monitorVulns.js' {
  const monitorVulns: () => Promise<void>;
  export default monitorVulns;
}

declare module '#app/domain/enums/Status.js' {
  export const Status: Readonly<{
    OPEN: 'OPEN';
    ACKNOWLEDGED: 'ACKNOWLEDGED';
    RESOLVED: 'RESOLVED';
  }>;
  export function isValidStatus(status: string): boolean;
  export function isValidTransition(from: string, to: string): boolean;
}

declare module '#app/domain/enums/Severity.js' {
  export const Severity: Readonly<{
    CRITICAL: 'CRITICAL';
    HIGH: 'HIGH';
    MEDIUM: 'MEDIUM';
    LOW: 'LOW';
    UNKNOWN: 'UNKNOWN';
  }>;
}

declare module '#app/infrastructure/config.js' {
  const config: {
    cronSchedule?: string;
    slack?: { webhookUrl?: string };
    feeds?: Record<string, string>;
    filterSettings?: { enabled?: boolean; technologies?: string[] };
    [key: string]: unknown;
  };
  export default config;
}
