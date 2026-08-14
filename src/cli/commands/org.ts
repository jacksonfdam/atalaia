import { createClient } from '../lib/api.js';

/**
 * Organization commands, over the API — the same endpoints the console's
 * Settings → Organizations page uses. Tokens are sent, never read back: the API
 * returns a four-character hint and nothing more.
 */

interface BaseOpts {
  json?: boolean;
  api?: string;
}

interface AddOpts extends BaseOpts {
  key?: string;
  name?: string;
  token?: string;
}

type ListOpts = BaseOpts;

interface ImportOpts extends BaseOpts {
  all?: boolean;
  languages?: boolean;
  only?: string;
}

interface Org {
  key: string;
  login: string;
  enabled: boolean;
  hasToken: boolean;
  tokenHint: string | null;
  lastImportAt: string | null;
  repositories?: { enabled: number; total: number };
}

function fail(err: unknown): void {
  process.stderr.write(`Error: ${(err as Error).message}\n`);
  process.exitCode = 1;
}

export async function runOrgAdd(login: string, opts: AddOpts): Promise<void> {
  try {
    const api = createClient({ baseUrl: opts.api });
    const org = await api.post<Org>('/organizations', {
      login,
      key: opts.key,
      name: opts.name,
      token: opts.token,
    });

    if (opts.json) {
      process.stdout.write(JSON.stringify(org, null, 2) + '\n');
      return;
    }

    process.stdout.write(`Added organization: ${org.key} (${org.login})\n`);
    process.stdout.write(`  Token: ${org.hasToken ? org.tokenHint : 'none — reads will be unauthenticated'}\n`);
  } catch (err) {
    fail(err);
  }
}

export async function runOrgList(opts: ListOpts): Promise<void> {
  try {
    const api = createClient({ baseUrl: opts.api });
    const { organizations: orgs } = await api.get<{ organizations: Org[] }>('/organizations');

    if (opts.json) {
      process.stdout.write(JSON.stringify(orgs, null, 2) + '\n');
      return;
    }
    if (orgs.length === 0) {
      process.stdout.write("No organizations registered. Add one with 'atalaia org add <login>'.\n");
      return;
    }

    process.stdout.write(
      `${'Key'.padEnd(24)} ${'Login'.padEnd(24)} ${'Token'.padEnd(10)} ${'Repos'.padEnd(10)} ${'Last import'.padEnd(22)} Status\n`
    );
    process.stdout.write('-'.repeat(100) + '\n');

    for (const org of orgs) {
      const repos = org.repositories ? `${org.repositories.enabled}/${org.repositories.total}` : '0/0';
      const imported = org.lastImportAt ? org.lastImportAt.slice(0, 19) : 'never';
      process.stdout.write(
        `${org.key.padEnd(24)} ${org.login.padEnd(24)} ${(org.hasToken ? org.tokenHint! : '—').padEnd(10)} ${repos.padEnd(10)} ${imported.padEnd(22)} ${org.enabled ? 'ENABLED' : 'DISABLED'}\n`
      );
    }
    process.stdout.write(`\nTotal: ${orgs.length} organizations\n`);
  } catch (err) {
    fail(err);
  }
}

export async function runOrgRemove(key: string, opts: BaseOpts = {}): Promise<void> {
  try {
    const api = createClient({ baseUrl: opts.api });
    const removed = await api.del<{ repositories: number }>(`/organizations/${encodeURIComponent(key)}`);
    process.stdout.write(`Removed ${key} and ${removed.repositories} repositories\n`);
  } catch (err) {
    fail(err);
  }
}

/** Enable, disable, or replace the token of an organization. */
export async function runOrgUpdate(
  key: string,
  updates: { enabled?: boolean; token?: string | null; name?: string },
  opts: BaseOpts = {}
): Promise<void> {
  try {
    const api = createClient({ baseUrl: opts.api });
    const org = await api.patch<Org>(`/organizations/${encodeURIComponent(key)}`, updates);
    process.stdout.write(
      `${org.key}: ${org.enabled ? 'enabled' : 'disabled'}, token ${org.hasToken ? org.tokenHint : 'none'}\n`
    );
  } catch (err) {
    fail(err);
  }
}

export async function runOrgImport(key: string | undefined, opts: ImportOpts): Promise<void> {
  try {
    const withLanguages = opts.languages !== false;

    const api = createClient({ baseUrl: opts.api });

    if (opts.all || !key) {
      const result = await api.post<{ organizations: number; imported: number; errors: { org: string; error: string }[] }>(
        '/organizations/import',
        { withLanguages }
      );

      if (opts.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        return;
      }

      process.stdout.write(`Imported ${result.imported} repositories from ${result.organizations} organizations\n`);
      for (const error of result.errors) {
        process.stderr.write(`  ${error.org}: ${error.error}\n`);
      }
      return;
    }

    // --only takes full names or URLs, comma-separated.
    const only = opts.only
      ? opts.only.split(',').map(entry => entry.trim()).filter(Boolean)
      : undefined;

    const result = await api.post<{
      login: string;
      imported: number;
      found: number;
      archived: number;
      skippedDeleted: string[];
      notFound: string[];
    }>(`/organizations/${encodeURIComponent(key)}/import`, {
      withLanguages,
      repositories: only,
    });

    if (opts.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      return;
    }

    process.stdout.write(`${result.login}: ${result.imported} of ${result.found} repositories imported\n`);
    if (result.archived > 0) {
      process.stdout.write(`  ${result.archived} archived (imported disabled)\n`);
    }
    if (result.skippedDeleted.length > 0) {
      process.stdout.write(`  ${result.skippedDeleted.length} left out — removed here earlier\n`);
    }
    if (result.notFound.length > 0) {
      process.stderr.write(`  not found on GitHub: ${result.notFound.join(', ')}\n`);
    }
  } catch (err) {
    fail(err);
  }
}

/** List what the token can see, so a selection can be made before importing. */
export async function runOrgRepos(key: string, opts: ListOpts): Promise<void> {
  try {
    const api = createClient({ baseUrl: opts.api });
    const preview = await api.get<{
      login: string;
      count: number;
      repositories: {
        name: string;
        primaryLanguage: string | null;
        defaultBranch: string;
        state: string;
        archived: boolean;
      }[];
    }>(`/organizations/${encodeURIComponent(key)}/repositories`);

    if (opts.json) {
      process.stdout.write(JSON.stringify(preview, null, 2) + '\n');
      return;
    }

    if (preview.count === 0) {
      process.stdout.write(`This token cannot see any repository in ${preview.login}.\n`);
      return;
    }

    process.stdout.write(`${'Repository'.padEnd(44)} ${'Language'.padEnd(14)} ${'Branch'.padEnd(14)} State\n`);
    process.stdout.write('-'.repeat(92) + '\n');

    for (const repo of preview.repositories) {
      const state = repo.state + (repo.archived ? ', archived' : '');
      process.stdout.write(
        `${repo.name.slice(0, 42).padEnd(44)} ${(repo.primaryLanguage ?? '—').padEnd(14)} ${repo.defaultBranch.padEnd(14)} ${state}\n`
      );
    }

    const tracked = preview.repositories.filter(r => r.state === 'tracked').length;
    process.stdout.write(
      `\n${preview.count} in ${preview.login}, ${tracked} already tracked.\n` +
        `Import a subset with: atalaia org import ${key} --only <name,name>\n`
    );
  } catch (err) {
    fail(err);
  }
}
