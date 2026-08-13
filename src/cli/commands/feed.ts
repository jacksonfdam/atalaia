interface ListOpts {
  json?: boolean;
}

interface CatalogOpts {
  all?: boolean;
  json?: boolean;
}

function fail(err: unknown): void {
  process.stderr.write(`Error: ${(err as Error).message}\n`);
  process.exitCode = 1;
}

export async function runFeedList(opts: ListOpts): Promise<void> {
  const { listFeeds } = await import('#app/infrastructure/feeds/feedRegistry.js');
  try {
    const feeds = listFeeds().map(feed => ({
      name: feed.name,
      label: feed.label,
      enabled: feed.enabled,
      defaultEnabled: feed.defaultEnabled,
      overridden: feed.overridden,
      disabledReason: feed.disabledReason ?? null,
      maintainer: feed.catalog?.maintainer ?? null,
    }));

    if (opts.json) {
      process.stdout.write(JSON.stringify(feeds, null, 2) + '\n');
      return;
    }

    process.stdout.write(`${'Source'.padEnd(14)} ${'State'.padEnd(10)} ${'Default'.padEnd(10)} ${'Maintainer'.padEnd(18)} Note\n`);
    process.stdout.write('-'.repeat(100) + '\n');

    for (const feed of feeds) {
      const state = `${feed.enabled ? 'on' : 'off'}${feed.overridden ? '*' : ''}`;
      process.stdout.write(
        `${feed.name.padEnd(14)} ${state.padEnd(10)} ${(feed.defaultEnabled ? 'on' : 'off').padEnd(10)} ${(feed.maintainer ?? '—').padEnd(18)} ${(feed.disabledReason ?? '').slice(0, 40)}\n`
      );
    }

    process.stdout.write(`\n${feeds.filter(f => f.enabled).length} of ${feeds.length} enabled. * = set manually.\n`);
  } catch (err) {
    fail(err);
  }
}

export async function runFeedToggle(name: string, enabled: boolean): Promise<void> {
  const { setFeedEnabled } = await import('#app/infrastructure/feeds/feedRegistry.js');
  try {
    const feed = setFeedEnabled(name, enabled, 'cli');
    process.stdout.write(`${feed.name} is now ${feed.enabled ? 'enabled' : 'disabled'}\n`);
  } catch (err) {
    fail(err);
  }
}

export async function runFeedReset(name: string): Promise<void> {
  const { resetFeed } = await import('#app/infrastructure/feeds/feedRegistry.js');
  try {
    const feed = resetFeed(name);
    process.stdout.write(`${feed.name} follows its default again: ${feed.enabled ? 'enabled' : 'disabled'}\n`);
  } catch (err) {
    fail(err);
  }
}

export async function runFeedCatalog(opts: CatalogOpts): Promise<void> {
  const { listCatalog } = await import('#app/infrastructure/feeds/databaseCatalog.js');
  try {
    const databases = listCatalog();
    const shown = opts.all ? databases : databases.filter(entry => entry.free);

    if (opts.json) {
      process.stdout.write(JSON.stringify(shown, null, 2) + '\n');
      return;
    }

    process.stdout.write(`${'Database'.padEnd(16)} ${'Maintainer'.padEnd(20)} ${'Region'.padEnd(10)} ${'Access'.padEnd(8)} Collected as\n`);
    process.stdout.write('-'.repeat(100) + '\n');

    for (const entry of shown) {
      process.stdout.write(
        `${entry.abbreviation.padEnd(16)} ${entry.maintainer.slice(0, 18).padEnd(20)} ${entry.region.padEnd(10)} ${(entry.free ? 'free' : 'paid').padEnd(8)} ${entry.feed ?? '—'}\n`
      );
    }

    const implemented = databases.filter(entry => entry.feed).length;
    process.stdout.write(
      `\n${shown.length} shown${opts.all ? '' : ' (free only, --all for every entry)'}, ${implemented} of ${databases.length} collected.\n`
    );
  } catch (err) {
    fail(err);
  }
}
