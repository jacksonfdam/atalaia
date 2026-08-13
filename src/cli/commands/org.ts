interface AddOpts {
  key?: string;
  name?: string;
  token?: string;
  json?: boolean;
}

interface ListOpts {
  json?: boolean;
}

interface ImportOpts {
  all?: boolean;
  languages?: boolean;
  only?: string;
  json?: boolean;
}

function fail(err: unknown): void {
  process.stderr.write(`Error: ${(err as Error).message}\n`);
  process.exitCode = 1;
}

export async function runOrgAdd(login: string, opts: AddOpts): Promise<void> {
  const { addOrg } = await import('#app/application/manageOrganization.js');
  try {
    const org = addOrg({ login, key: opts.key, name: opts.name, token: opts.token });

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
  const { listOrgs } = await import('#app/application/manageOrganization.js');
  try {
    const orgs = listOrgs();

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

export async function runOrgRemove(key: string): Promise<void> {
  const { removeOrg } = await import('#app/application/manageOrganization.js');
  try {
    const removed = removeOrg(key);
    if (!removed) {
      process.stderr.write(`Organization not found: ${key}\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`Removed ${key} and ${removed.repositories} repositories\n`);
  } catch (err) {
    fail(err);
  }
}

/** Enable, disable, or replace the token of an organization. */
export async function runOrgUpdate(
  key: string,
  updates: { enabled?: boolean; token?: string | null; name?: string }
): Promise<void> {
  const { updateOrg } = await import('#app/application/manageOrganization.js');
  try {
    const org = updateOrg(key, updates);
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

    if (opts.all || !key) {
      const { importAllOrganizations } = await import('#app/application/importRepositories.js');
      const result = await importAllOrganizations({ withLanguages });

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

    const { importOrgRepositories } = await import('#app/application/importRepositories.js');
    // --only takes full names or URLs, comma-separated.
    const only = opts.only
      ? opts.only.split(',').map(entry => entry.trim()).filter(Boolean)
      : undefined;
    const result = await importOrgRepositories(key, { withLanguages, only });

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
  const { previewOrgRepositories } = await import('#app/application/importRepositories.js');
  try {
    const preview = await previewOrgRepositories(key);

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
