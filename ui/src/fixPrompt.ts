import type { RepositoryRiskReport, RepositoryVulnerability } from './types';

const RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

interface Finding {
  verdict: string;
  patchedIn: string | null;
  reason: string | null;
  cveId: string;
  title: string | null;
  severity: string;
  cvss: number | null;
  exploited: boolean;
}

interface Target {
  dependency: string;
  ecosystem: string;
  version: string | null;
  manifestFile: string | null;
  findings: Finding[];
}

/** One row per package and manifest, with every CVE that reaches it. */
function groupByPackage(vulnerabilities: RepositoryVulnerability[]): Target[] {
  const targets = new Map<string, Target>();

  for (const vuln of vulnerabilities) {
    for (const match of vuln.matches) {
      const key = [match.ecosystem, match.dependency, match.version, match.manifestFile].join('|');
      const target = targets.get(key) ?? { ...match, findings: [] };

      target.findings.push({
        verdict: match.verdict,
        patchedIn: match.patchedIn,
        reason: match.reason,
        cveId: vuln.cveId,
        title: vuln.title,
        severity: vuln.severity,
        cvss: vuln.cvssScore,
        exploited: vuln.exploited,
      });
      targets.set(key, target);
    }
  }

  const worst = (target: Target) => Math.min(...target.findings.map(f => RANK[f.severity] ?? 4));

  return [...targets.values()].sort(
    (a, b) => worst(a) - worst(b) || b.findings.length - a.findings.length || a.dependency.localeCompare(b.dependency)
  );
}

/**
 * A brief for a coding agent: which dependencies are exposed, where they are
 * declared, and how to fix them without breaking the repository.
 *
 * Where the advisory states a patched version the prompt names it as the floor.
 * Where it does not, the agent is told to look it up: naming one that could be
 * wrong is worse than saying so. Findings Atalaia could not check against a
 * version range are marked, so the agent verifies them instead of assuming.
 */
export function buildFixPrompt(report: RepositoryRiskReport): string {
  const targets = groupByPackage(report.vulnerabilities);

  const lines: string[] = [
    `Fix the vulnerable dependencies in ${report.repository.name} (${report.repository.url}).`,
    '',
    `Atalaia found ${report.count} open vulnerabilities reaching ${targets.length} package${targets.length === 1 ? '' : 's'}. Update each one to a version that is patched and current, and leave the repository building and passing its tests.`,
    '',
    '## Affected packages',
    '',
  ];

  for (const target of targets) {
    const version = target.version ? `@${target.version}` : '';
    lines.push(`- ${target.dependency}${version} (${target.ecosystem}) — ${target.manifestFile ?? 'manifest unknown'}`);

    for (const finding of target.findings) {
      const score = finding.cvss !== null ? ` ${finding.cvss}` : '';
      const exploited = finding.exploited ? ', known exploited' : '';
      const fixed = finding.patchedIn ? ` — fixed in ${finding.patchedIn}` : '';
      const unverified =
        finding.verdict === 'unverified' ? ` — UNVERIFIED${finding.reason ? `: ${finding.reason}` : ''}` : '';
      lines.push(`    - ${finding.cveId} [${finding.severity}${score}${exploited}]${finding.title ? ` ${finding.title}` : ''}${fixed}${unverified}`);
    }
  }

  lines.push(
    '',
    '## How to do it',
    '',
    '1. Start with known-exploited and CRITICAL findings, then work down.',
    '2. For each package, find the lowest version that fixes every CVE listed for it: where a fix version is stated above use it as the floor, otherwise read the advisory. Then check whether a newer stable release exists. Prefer the newest stable release that is compatible with the rest of the project; say why when you stop short of it.',
    '3. Findings marked UNVERIFIED could not be checked against a version range. Check the version actually installed (the lockfile, not the manifest) against the advisory first: if it is already patched, say so and change nothing for it.',
    '4. Use the ecosystem\'s own package manager so the lockfile stays consistent (npm/pnpm/yarn, pip/poetry/uv, cargo, go, bundler, composer, and so on). Never edit a lockfile by hand.',
    '5. A transitive dependency: update the direct dependency that pulls it in. When no release of that parent fixes it, pin the transitive version with an override/resolution and leave a comment saying which CVE it is for and when it can be removed.',
    '6. Check the changelog for breaking changes on every major bump, and adapt the code that is affected.',
    '7. Run the build, type checks and tests. Fix what the update broke; do not skip or delete tests to get green.',
    '8. Make one commit per package (or per tightly coupled group), with the CVE ids in the message.',
    '',
    '## Rules',
    '',
    '- Change only what is needed for these updates. No unrelated refactors or upgrades.',
    '- Do not downgrade anything.',
    '- Anything you cannot fix (no patched release, or an incompatible major version) goes in a list at the end with the reason and the safest mitigation.',
    '- Finish with a table: package, old version, new version, CVEs closed.'
  );

  return lines.join('\n');
}
