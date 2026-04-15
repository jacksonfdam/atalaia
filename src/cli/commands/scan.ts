interface Opts {
  dryRun?: boolean;
}

export async function runScan(opts: Opts): Promise<void> {
  if (opts.dryRun) {
    // Disarm Slack by blanking the webhook URL before monitorVulns imports it.
    // The LLM adapter will also fail softly (empty prompt paths) but the scan still runs.
    process.env.SLACK_WEBHOOK_URL = '';
    process.stdout.write(
      'dry-run: Slack webhook disabled, scan will fetch + dedupe but notifications are suppressed\n'
    );
  } else {
    process.stdout.write(
      'warning: this triggers the same Slack notifications as a cron-driven scan\n'
    );
  }

  // Dynamic import so environment blanking above happens before module load.
  const { default: monitorVulns } = await import('#app/application/monitorVulns.js');
  const started = Date.now();
  await monitorVulns();
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  process.stdout.write(`Scan complete in ${elapsed}s. See logs for details.\n`);
}
