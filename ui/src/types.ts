export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
export type Status = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
export type FeedStatus = 'OK' | 'EMPTY' | 'ERROR' | 'DISABLED';

export interface Vulnerability {
  id: number;
  cve_id: string;
  title: string | null;
  description: string | null;
  severity: Severity;
  cvss_score: number | null;
  exploited: 0 | 1;
  source: string;
  source_url: string | null;
  affectedTechnologies: string[];
  status: Status;
  status_changed_by: string | null;
  status_changed_at: string | null;
  client_explanation: string | null;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
}

export interface VulnerabilityPage {
  count: number;
  total: number;
  limit: number;
  offset: number;
  /** How much of the database is about this fleet at all. */
  relevance: { total: number; affecting: number; infrastructure: number };
  vulnerabilities: Vulnerability[];
}

export interface TimelineEvent {
  at: string;
  event: string;
  detail: string | null;
}

export interface VulnerabilityDetail {
  vulnerability: Vulnerability;
  timeline: TimelineEvent[];
  affectedRepositories: Repository[];
  owners: Owner[];
}

export interface Stats {
  total: number;
  exploited: number;
  lastSeenAt: string | null;
  byStatus: Record<string, number>;
  bySeverity: Record<string, number>;
  bySource: Record<string, number>;
}

export interface FeedHealth {
  name: string;
  label: string;
  enabled: boolean;
  status: FeedStatus;
  detail: string | null;
  count: number;
  withCvss: number;
  severities: Record<string, number>;
  latencyMs: number;
}

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

export interface FeedSource {
  name: string;
  label: string;
  enabled: boolean;
  defaultEnabled: boolean;
  overridden: boolean;
  disabledReason: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  catalog: CatalogEntry | null;
}

export interface CatalogPayload {
  count: number;
  implemented: number;
  databases: CatalogEntry[];
}

export interface FeedHealthReport {
  checkedAt: string;
  cached: boolean;
  feeds: FeedHealth[];
}

export interface Repository {
  id: number;
  name: string;
  url: string;
  provider: string;
  org_key: string | null;
  default_branch: string;
  last_scanned_at: string | null;
  enabled: 0 | 1;
  deleted_at: string | null;
  primary_language: string | null;
  /** JSON object of language -> bytes, as stored. */
  languages: string | null;
  /** JSON array, as stored. */
  topics: string | null;
  description: string | null;
  archived: 0 | 1;
  risk?: RepositoryRisk;
}

/** How exposed a repository is, as returned alongside the list. */
export interface RepositoryRisk {
  total: number;
  bySeverity: Record<string, number>;
  exploited: boolean;
  worst: Severity | null;
}

export interface RepositoryVulnerability {
  cveId: string;
  title: string | null;
  severity: Severity;
  cvssScore: number | null;
  exploited: boolean;
  status: Status;
  source: string;
  firstSeenAt: string;
  matches: {
    dependency: string;
    ecosystem: string;
    version: string | null;
    manifestFile: string | null;
  }[];
}

export interface RepositoryRiskReport {
  repository: { id: number; name: string; url: string; enabled: boolean };
  count: number;
  exploited: number;
  bySeverity: Record<string, number>;
  worst: Severity | null;
  vulnerabilities: RepositoryVulnerability[];
}

export interface RepositoryPage {
  count: number;
  total: number;
  limit: number;
  offset: number;
  atRisk: number;
  facets: {
    organizations: { value: string; count: number }[];
    languages: { value: string; count: number }[];
  };
  repositories: Repository[];
}

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

export interface ImportResult {
  org: string;
  login: string;
  found: number;
  imported: number;
  skippedDeleted: string[];
  notFound: string[];
  archived: number;
}

/** A repository as it exists on the provider, before anything is imported. */
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

export interface RemoteRepositoryList {
  org: string;
  login: string;
  count: number;
  /** What the token can actually reach for this login. */
  access: {
    kind: 'organization' | 'self' | 'user';
    visibility: 'all' | 'public';
    authenticatedAs: string | null;
  };
  repositories: RemoteRepository[];
}

export interface TechnologyReport {
  repository: { id: number; name: string; url: string };
  primaryLanguage: string | null;
  languages: { name: string; bytes: number; share: number | null }[];
  topics: string[];
  ecosystems: { name: string; packages: number }[];
  dependencyCount: number;
  lastScannedAt: string | null;
}

export interface Dependency {
  id: number;
  ecosystem: string;
  name: string;
  version: string | null;
  opencve_vendor: string | null;
  opencve_product: string | null;
  manifest_file: string | null;
  latest_version: string | null;
  latest_checked_at: string | null;
  latest_error: string | null;
  /** Computed: the declared version is not the latest published one. */
  outdated: boolean;
  versionState: 'current' | 'behind' | 'unknown';
  versionGap: 'major' | 'minor' | 'patch' | null;
  versionNote: string | null;
}

export interface VersionCheckState {
  running: boolean;
  startedAt: string | null;
  progress: {
    total: number;
    done: number;
    outdated: number;
    failed: number;
    current: string | null;
  } | null;
  lastRun: {
    startedAt: string;
    finishedAt: string;
    ok: boolean;
    checked: number;
    failed: number;
    error?: string;
  } | null;
}

export interface DependencyGroup {
  ecosystem: string;
  count: number;
  outdated: number;
  unchecked: number;
}

export interface DependencyPage {
  count: number;
  outdated: number;
  unchecked: number;
  groups: DependencyGroup[];
  repository: Repository;
  dependencies: Dependency[];
  versionCheck: VersionCheckState;
}

export interface Owner {
  id: number;
  name: string;
  email: string;
  slack_user_id: string | null;
}

export interface Assignment {
  id: number;
  owner_id: number;
  target_type: string;
  target_value: string;
}

export interface Setting {
  key: string;
  label: string;
  help: string | null;
  type: 'boolean' | 'string' | 'number';
  value: boolean | string | number;
  source: 'env' | 'database' | 'config';
  editable: boolean;
  envVar: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface Credential {
  key: string;
  label: string;
  envVar: string;
  configured: boolean;
}

export interface SettingsPayload {
  settings: Setting[];
  credentials: Credential[];
}

export interface EmailProviderField {
  name: string;
  label: string;
  secret: boolean;
  required: boolean;
  placeholder: string | null;
  help: string | null;
}

export interface EmailProvider {
  id: string;
  label: string;
  docsUrl: string;
  defaults: { host?: string; port?: number; username?: string };
  note: string | null;
  fields: EmailProviderField[];
}

export interface EmailConfig {
  provider: string;
  host: string | null;
  port: number | null;
  username: string | null;
  hasSecret: boolean;
  secretHint: string | null;
  from: string | null;
  recipients: string | null;
  template: 'professional' | 'minimal';
  enabled: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface EmailPayload {
  providers: EmailProvider[];
  config: EmailConfig;
  envLocked: boolean;
  envVars: string[];
  status: {
    ready: boolean;
    reason: string | null;
    source: 'env' | 'database' | 'none';
    recipients: number;
  };
}

export interface FleetScanState {
  running: boolean;
  startedAt: string | null;
  progress: {
    organizations: { total: number; done: number; current: string | null };
    repositories: { total: number; done: number; current: string | null };
    dependencies: number;
    errors: string[];
  } | null;
  lastRun: {
    startedAt: string;
    finishedAt: string;
    ok: boolean;
    repositories: number;
    dependencies: number;
    errors: string[];
  } | null;
}

export interface LlmProvider {
  id: string;
  label: string;
  kind: 'local' | 'hosted';
  api: 'openai' | 'anthropic' | 'ollama';
  baseUrl: string;
  defaultModel: string;
  requiresKey: boolean;
  docsUrl: string;
  note: string | null;
}

export interface LlmPayload {
  providers: LlmProvider[];
  config: {
    provider: string;
    model: string | null;
    baseUrl: string | null;
    hasApiKey: boolean;
    apiKeyHint: string | null;
    enabled: boolean;
    updatedAt: string | null;
    updatedBy: string | null;
  };
  envLocked: boolean;
  envVars: string[];
  status: {
    ready: boolean;
    reason: string | null;
    source: 'env' | 'database' | 'config' | 'none';
    provider: string | null;
    model: string | null;
    kind: 'local' | 'hosted' | null;
  };
}

export interface TeamsPayload {
  config: {
    hasWebhook: boolean;
    webhookHint: string | null;
    enabled: boolean;
    updatedAt: string | null;
    updatedBy: string | null;
  };
  envLocked: boolean;
  envVars: string[];
  status: { ready: boolean; reason: string | null; source: 'env' | 'database' | 'none' };
}

export interface ScanState {
  running: boolean;
  startedAt: string | null;
  lastRun: { startedAt: string; finishedAt: string; ok: boolean; error: string | null } | null;
}

export interface SlackPayload {
  modes: string[];
  config: {
    mode: 'webhook' | 'bot';
    hasWebhook: boolean;
    webhookHint: string | null;
    hasBotToken: boolean;
    botHint: string | null;
    hasSigningSecret: boolean;
    signingHint: string | null;
    hasAppToken: boolean;
    appTokenHint: string | null;
    appId: string | null;
    destination: string | null;
    destinationKind: 'none' | 'channel' | 'user';
    notifyOwners: boolean;
    enabled: boolean;
    updatedAt: string | null;
    updatedBy: string | null;
  };
  envLocked: boolean;
  envVars: string[];
  env: {
    webhookUrl: boolean;
    signingSecret: boolean;
    appToken: boolean;
    appId: boolean;
    enabled: boolean | null;
  };
  interactivity: { configured: boolean; source: 'env' | 'database' | 'none'; envVar: string };
  status: {
    ready: boolean;
    reason: string | null;
    source: 'env' | 'database' | 'config' | 'none';
    mode: string;
  };
}
