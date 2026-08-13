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
  export function restoreRepo(idOrUrl: number | string): any;
  export function setRepoEnabled(id: number, enabled: boolean): any;
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
    listLanguages(repoUrl: string): Promise<Record<string, number>>;
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

declare module '#app/application/manageOrganization.js' {
  export interface Organization {
    id: number;
    key: string;
    login: string;
    name: string | null;
    provider: string;
    enabled: boolean;
    hasToken: boolean;
    tokenHint: string | null;
    lastImportAt: string | null;
    repositories?: { total: number; enabled: number };
  }
  export function addOrg(data: {
    login: string;
    key?: string;
    name?: string;
    token?: string;
  }): Organization;
  export function listOrgs(options?: { includeDeleted?: boolean }): Organization[];
  export function getOrg(key: string): Organization | null;
  export function updateOrg(
    key: string,
    updates: { login?: string; name?: string; enabled?: boolean; token?: string | null }
  ): Organization;
  export function removeOrg(key: string): { key: string; repositories: number } | null;
  export function providerForOrg(orgKey: string | null): any;
}

declare module '#app/application/importRepositories.js' {
  export interface ImportResult {
    org: string;
    login: string;
    found: number;
    imported: number;
    skippedDeleted: string[];
    notFound: string[];
    archived: number;
  }
  export interface RemoteRepository {
    name: string;
    url: string;
    defaultBranch: string;
    primaryLanguage: string | null;
    topics: string[];
    description: string | null;
    archived: boolean;
    state: 'new' | 'tracked' | 'removed';
    enabled: boolean | null;
  }
  export function previewOrgRepositories(
    key: string
  ): Promise<{ org: string; login: string; count: number; repositories: RemoteRepository[] }>;
  export function importOrgRepositories(
    key: string,
    options?: { withLanguages?: boolean; only?: string[] }
  ): Promise<ImportResult>;
  export function importAllOrganizations(
    options?: { withLanguages?: boolean }
  ): Promise<{
    organizations: number;
    imported: number;
    results: ImportResult[];
    errors: { org: string; error: string }[];
  }>;
}

declare module '#app/application/repositoryTechnologies.js' {
  export interface TechnologyReport {
    repository: { id: number; name: string; url: string };
    primaryLanguage: string | null;
    languages: { name: string; bytes: number; share: number | null }[];
    topics: string[];
    ecosystems: { name: string; packages: number }[];
    dependencyCount: number;
    lastScannedAt: string | null;
  }
  export function getRepositoryTechnologies(repositoryId: number): TechnologyReport | null;
  export function refreshRepositoryLanguages(repositoryId: number): Promise<TechnologyReport>;
}

declare module '#app/infrastructure/feeds/feedRegistry.js' {
  export interface FeedEntry {
    name: string;
    label: string;
    enabled: boolean;
    defaultEnabled: boolean;
    overridden: boolean;
    disabledReason?: string;
    updatedAt: string | null;
    updatedBy: string | null;
    catalog: { maintainer: string; region: string; url: string } | null;
  }
  export function listFeeds(): FeedEntry[];
  export function enabledFeeds(): FeedEntry[];
  export function getFeed(name: string): FeedEntry | undefined;
  export function setFeedEnabled(name: string, enabled: boolean, changedBy?: string): FeedEntry;
  export function resetFeed(name: string): FeedEntry;
}

declare module '#app/infrastructure/feeds/databaseCatalog.js' {
  export interface CatalogEntry {
    name: string;
    abbreviation: string;
    url: string;
    apiUrl: string | null;
    maintainer: string;
    region: string;
    category: string;
    free: boolean;
    hasApi: boolean;
    description: string;
    feed: string | null;
    noAdapterReason: string | null;
  }
  export function listCatalog(): CatalogEntry[];
  export function catalogEntryForFeed(feedName: string): CatalogEntry | null;
}
