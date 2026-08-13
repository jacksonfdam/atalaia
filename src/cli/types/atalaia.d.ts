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
  export interface ProviderConfig {
    key: string;
    type?: string;
    org?: string;
    token?: string;
    [key: string]: unknown;
  }
  const config: {
    cronSchedule?: string;
    slack?: { webhookUrl?: string };
    feeds?: Record<string, string>;
    filterSettings?: { enabled?: boolean; technologies?: string[] };
    providers?: ProviderConfig[];
    repositories?: { autoScan?: boolean; scanCron?: string };
    [key: string]: unknown;
  };
  export default config;
}

declare module '#app/application/manageRepository.js' {
  export function addRepo(
    url: string,
    options?: { name?: string; provider?: string; orgKey?: string; defaultBranch?: string }
  ): any;
  export function removeRepo(idOrUrl: number | string): boolean;
  export function listRepos(options?: { includeDeleted?: boolean }): any[];
  export function getRepo(id: number): any;
  export function getRepoByUrl(url: string): any;
  export function restoreRepo(id: number): boolean;
}

declare module '#app/application/scanRepository.js' {
  export function scanRepository(
    repositoryId: number,
    provider: any,
    options?: { skipVendorLookup?: boolean }
  ): Promise<{
    repoName: string;
    dependencyCount: number;
    ecosystems: string[];
    unmappedCount: number;
  }>;
}

declare module '#app/application/scanAllRepositories.js' {
  export function scanAllRepositories(
    options?: { skipVendorLookup?: boolean }
  ): Promise<{ totalRepos: number; totalDeps: number; errors: string[] }>;
}

declare module '#app/application/manageOwner.js' {
  export function addOwner(data: {
    name: string;
    email: string;
    slackUserId?: string | null;
  }): any;
  export function removeOwner(id: number): boolean;
  export function listOwners(options?: { includeDeleted?: boolean }): any[];
  export function getOwnerWithAssignments(
    id: number
  ): { owner: any; assignments: any[] } | null;
  export function updateOwner(id: number, updates: Record<string, unknown>): any;
  export function assignOwner(ownerId: number, targetType: string, targetValue: string): any;
  export function unassignOwner(assignmentId: number): boolean;
}

declare module '#app/infrastructure/providers/githubProvider.js' {
  export class GitHubProvider {
    constructor(token: string, orgKey: string);
    listRepositories(...args: any[]): Promise<any[]>;
    getFileContent(...args: any[]): Promise<string | null>;
    listFiles(...args: any[]): Promise<any[]>;
  }
  export function parseGitHubUrl(url: string): { owner: string; repo: string } | null;
}

declare module '#app/infrastructure/cache/repositoryStore.js' {
  export function getDependenciesByRepo(
    repoId: number,
    options?: { includeDeleted?: boolean }
  ): any[];
  export function findAffectedRepositories(vendor: string, product: string): any[];
  export function findAffectedRepositoriesByDepName(depName: string): any[];
  export function listRepositories(options?: { includeDeleted?: boolean }): any[];
  export function listOwners(options?: { includeDeleted?: boolean }): any[];
  export function getAllUniqueDependencies(): any[];
}
