import { openWritable, openReadonly } from '../lib/db.js';

interface AddOpts {
  name?: string;
  provider?: string;
  branch?: string;
  orgKey?: string;
  json?: boolean;
}

interface RemoveOpts {
  json?: boolean;
}

interface ListOpts {
  deleted?: boolean;
  json?: boolean;
}

interface ScanOpts {
  all?: boolean;
  skipVendorLookup?: boolean;
  json?: boolean;
}

interface DepsOpts {
  ecosystem?: string;
  json?: boolean;
}

export async function runRepoAdd(url: string, opts: AddOpts): Promise<void> {
  // Dynamic imports to ensure DB_PATH env is set first
  const { addRepo } = await import('#app/application/manageRepository.js');
  try {
    const repo = addRepo(url, {
      name: opts.name,
      provider: opts.provider,
      orgKey: opts.orgKey,
      defaultBranch: opts.branch || 'main',
    });
    if (opts.json) {
      process.stdout.write(JSON.stringify(repo, null, 2) + '\n');
    } else {
      process.stdout.write(`Added repository: ${repo.name} (${repo.url})\n`);
      process.stdout.write(`  Provider: ${repo.provider}\n`);
      process.stdout.write(`  Branch: ${repo.default_branch}\n`);
      process.stdout.write(`  ID: ${repo.id}\n`);
    }
  } catch (err) {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
    process.exitCode = 1;
  }
}

export async function runRepoRemove(idOrUrl: string, opts: RemoveOpts): Promise<void> {
  const { removeRepo, getRepoByUrl } = await import('#app/application/manageRepository.js');
  try {
    const isNumeric = /^\d+$/.test(idOrUrl);
    const success = isNumeric ? removeRepo(parseInt(idOrUrl, 10)) : removeRepo(idOrUrl);
    if (success) {
      process.stdout.write(`Repository soft-deleted: ${idOrUrl}\n`);
    } else {
      process.stderr.write(`Repository not found: ${idOrUrl}\n`);
      process.exitCode = 1;
    }
  } catch (err) {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
    process.exitCode = 1;
  }
}

export async function runRepoList(opts: ListOpts): Promise<void> {
  const { listRepos } = await import('#app/application/manageRepository.js');
  try {
    const repos = listRepos({ includeDeleted: opts.deleted });
    if (opts.json) {
      process.stdout.write(JSON.stringify(repos, null, 2) + '\n');
      return;
    }
    if (repos.length === 0) {
      process.stdout.write('No repositories found.\n');
      return;
    }
    process.stdout.write(`${'ID'.padEnd(5)} ${'Name'.padEnd(40)} ${'Provider'.padEnd(10)} ${'Last Scanned'.padEnd(22)} ${'Status'.padEnd(10)}\n`);
    process.stdout.write('-'.repeat(90) + '\n');
    for (const r of repos) {
      const status = r.deleted_at ? 'DELETED' : r.enabled ? 'ACTIVE' : 'DISABLED';
      const scanned = r.last_scanned_at ? r.last_scanned_at.slice(0, 19) : 'never';
      process.stdout.write(
        `${String(r.id).padEnd(5)} ${(r.name || '').slice(0, 38).padEnd(40)} ${(r.provider || '').padEnd(10)} ${scanned.padEnd(22)} ${status.padEnd(10)}\n`
      );
    }
    process.stdout.write(`\nTotal: ${repos.length} repositories\n`);
  } catch (err) {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
    process.exitCode = 1;
  }
}

export async function runRepoScan(idOrUrl: string | undefined, opts: ScanOpts): Promise<void> {
  try {
    const started = Date.now();

    if (opts.all || !idOrUrl) {
      // Scan all repos from all providers
      const { scanAllRepositories } = await import('#app/application/scanAllRepositories.js');
      const result = await scanAllRepositories({ skipVendorLookup: opts.skipVendorLookup });
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);

      if (opts.json) {
        process.stdout.write(JSON.stringify({ ...result, elapsedSeconds: parseFloat(elapsed) }, null, 2) + '\n');
      } else {
        process.stdout.write(`Scan complete in ${elapsed}s\n`);
        process.stdout.write(`  Repositories: ${result.totalRepos}\n`);
        process.stdout.write(`  Dependencies found: ${result.totalDeps}\n`);
        if (result.errors.length > 0) {
          process.stdout.write(`  Errors: ${result.errors.length}\n`);
          for (const e of result.errors) {
            process.stderr.write(`    - ${e}\n`);
          }
        }
      }
    } else {
      // Scan a single repo
      const { getRepoByUrl, getRepo } = await import('#app/application/manageRepository.js');
      const { scanRepository } = await import('#app/application/scanRepository.js');
      const { GitHubProvider } = await import('#app/infrastructure/providers/githubProvider.js');
      const config = (await import('#app/infrastructure/config.js')).default;

      const isNumeric = /^\d+$/.test(idOrUrl);
      const repo = isNumeric ? getRepo(parseInt(idOrUrl, 10)) : getRepoByUrl(idOrUrl);
      if (!repo) {
        process.stderr.write(`Repository not found: ${idOrUrl}\n`);
        process.exitCode = 1;
        return;
      }

      // Find the provider config for this repo's org_key
      const providerConfig = (config.providers || []).find((p: any) => p.key === repo.org_key);
      const token = providerConfig?.token || process.env.GITHUB_TOKEN || '';
      const provider = new GitHubProvider(token, repo.org_key || 'default');

      const result = await scanRepository(repo.id, provider, { skipVendorLookup: opts.skipVendorLookup });
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);

      if (opts.json) {
        process.stdout.write(JSON.stringify({ ...result, elapsedSeconds: parseFloat(elapsed) }, null, 2) + '\n');
      } else {
        process.stdout.write(`Scan complete for ${result.repoName} in ${elapsed}s\n`);
        process.stdout.write(`  Dependencies: ${result.dependencyCount}\n`);
        process.stdout.write(`  Ecosystems: ${result.ecosystems.join(', ') || 'none'}\n`);
        process.stdout.write(`  Unmapped: ${result.unmappedCount}\n`);
      }
    }
  } catch (err) {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
    process.exitCode = 1;
  }
}

export async function runRepoDeps(idOrUrl: string, opts: DepsOpts): Promise<void> {
  const { getRepoByUrl, getRepo } = await import('#app/application/manageRepository.js');
  const { getDependenciesByRepo } = await import('#app/infrastructure/cache/repositoryStore.js');
  try {
    const isNumeric = /^\d+$/.test(idOrUrl);
    const repo = isNumeric ? getRepo(parseInt(idOrUrl, 10)) : getRepoByUrl(idOrUrl);
    if (!repo) {
      process.stderr.write(`Repository not found: ${idOrUrl}\n`);
      process.exitCode = 1;
      return;
    }

    let deps = getDependenciesByRepo(repo.id);
    if (opts.ecosystem) {
      deps = deps.filter((d: any) => d.ecosystem.toUpperCase() === opts.ecosystem!.toUpperCase());
    }

    if (opts.json) {
      process.stdout.write(JSON.stringify(deps, null, 2) + '\n');
      return;
    }

    if (deps.length === 0) {
      process.stdout.write(`No dependencies found for ${repo.name}. Run 'atalaia repo scan' first.\n`);
      return;
    }

    process.stdout.write(`Dependencies for ${repo.name} (${deps.length} total):\n\n`);
    process.stdout.write(`${'Ecosystem'.padEnd(12)} ${'Name'.padEnd(40)} ${'Version'.padEnd(20)} ${'Vendor/Product'.padEnd(30)}\n`);
    process.stdout.write('-'.repeat(105) + '\n');

    for (const d of deps) {
      const vp = d.opencve_vendor && d.opencve_product
        ? `${d.opencve_vendor}/${d.opencve_product}`
        : '—';
      process.stdout.write(
        `${(d.ecosystem || '').padEnd(12)} ${(d.name || '').slice(0, 38).padEnd(40)} ${(d.version || '—').slice(0, 18).padEnd(20)} ${vp.slice(0, 28).padEnd(30)}\n`
      );
    }
  } catch (err) {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
    process.exitCode = 1;
  }
}
