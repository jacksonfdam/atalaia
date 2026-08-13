// This repo is pnpm-managed. Installing with npm or yarn silently drops
// `pnpm.overrides` in package.json — the pins that keep the transitive
// dependency tree free of known advisories — and npm's arborist crashes
// outright on an existing pnpm node_modules (`Link.matches` of null).
const agent = process.env.npm_config_user_agent || '';

if (!agent.startsWith('pnpm')) {
    const manager = agent.split('/')[0] || 'this package manager';
    console.error(
        `\nRefusing to install with ${manager}. This repo uses pnpm.\n\n` +
        `  corepack enable && pnpm install\n\n` +
        `Reason: pnpm-lock.yaml and pnpm.overrides carry the security pins,\n` +
        `and npm cannot reify over a pnpm node_modules.\n`
    );
    process.exit(1);
}
