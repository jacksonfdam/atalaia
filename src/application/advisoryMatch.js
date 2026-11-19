import semver from 'semver';
import { constraintToRange } from './versionComparison.js';

/**
 * Does an advisory's affected range reach the version a repository declares?
 *
 * Pure: no database, no network. The rule it enforces is the one in CLAUDE.md —
 * nothing unverified is claimed. A finding goes away only on a *proof* that no
 * version the dependency can have is affected; every other doubt stays visible as
 * `unverified`, with the reason, rather than quietly reading as clean.
 *
 * Named `evaluateMatch`, not `compareVersions`: that name already means two
 * unrelated things in this codebase (how far behind, and which of two to keep).
 */

/** Ecosystems whose versions semver can order faithfully. The rest are `unverified`, never guessed. */
const COMPARABLE = new Set(['NPM', 'PIP', 'CARGO', 'GO', 'RUBYGEMS', 'COMPOSER', 'NUGET', 'PUB', 'HEX', 'SWIFT']);

const OPTIONS = { includePrerelease: true };
const CLAUSE = /^(>=|<=|>|<|=)\s*(.+)$/;

/**
 * A plain version as a semver version, or null.
 *
 * Deliberately strict: `1.0rc1`, `2.1.0.post3` and four-segment versions are
 * real in Python, Ruby and NuGet, and semver would coerce them into something
 * that orders wrongly. Padding `13.0` to `13.0.0` is the one liberty taken.
 */
function exactVersion(value) {
    const text = String(value ?? '').trim().replace(/^v/i, '');

    if (/^\d+$/.test(text)) return semver.valid(`${text}.0.0`);
    if (/^\d+\.\d+$/.test(text)) return semver.valid(`${text}.0`);

    return semver.valid(text);
}

/**
 * An advisory's range as a semver range: GitHub writes `>= 1.0, < 1.2.3`.
 * @returns {string|null} null for a range this cannot read
 */
export function parseAdvisoryRange(text) {
    const clauses = String(text ?? '')
        .split(',')
        .map(clause => clause.trim())
        .filter(Boolean);

    if (clauses.length === 0) return null;

    const parts = [];
    for (const clause of clauses) {
        const match = clause.match(CLAUSE);
        if (!match) return null;

        const version = exactVersion(match[2]);
        if (!version) return null;

        parts.push(match[1] === '=' ? version : `${match[1]}${version}`);
    }

    const range = parts.join(' ');
    return semver.validRange(range) ? range : null;
}

/** How one stored version relates to a set of affected ranges. */
function judge(ecosystem, declared, affected) {
    const raw = String(declared ?? '').trim();

    // `==11.1.0` is an exact pin; a bare lockfile version is exact too.
    const pinned = exactVersion(ecosystem === 'PIP' ? raw.replace(/^==/, '') : raw);

    if (pinned) {
        return affected.some(range => semver.satisfies(pinned, range, OPTIONS))
            ? { verdict: 'affected' }
            : { verdict: 'unaffected' };
    }

    // Otherwise a constraint: ask which versions it allows. Python joins its
    // clauses with commas (`>=1.0,<2.0`), and `!=` punches a hole no range here
    // can express.
    const cannotRead = { verdict: 'unverified', reason: `"${raw}" is a constraint this cannot read` };
    if (raw.includes('!=')) return cannotRead;

    const allowed = constraintToRange(ecosystem, raw.replace(/\s*,\s*/g, ' '));
    if (!allowed || !semver.validRange(allowed)) return cannotRead;

    // The translator falls back to coercing whatever it cannot parse into a bare
    // version. Reading `>=1.0 <2.0` as the pin 1.0.0 would be a wrong "unaffected".
    if (semver.valid(allowed)) return cannotRead;

    if (!affected.some(range => semver.intersects(allowed, range, OPTIONS))) return { verdict: 'unaffected' };
    if (affected.some(range => semver.subset(allowed, range, OPTIONS))) return { verdict: 'affected' };

    return {
        verdict: 'unverified',
        reason: `"${raw}" allows both affected and patched versions; the lockfile decides`,
    };
}

/**
 * @typedef {object} AdvisoryRow
 * @property {string} ecosystem
 * @property {string} name              Lowercased
 * @property {string} vulnerableRange
 * @property {string|null} [firstPatched]
 *
 * @typedef {object} Verdict
 * @property {'affected'|'unaffected'|'unverified'} verdict
 * @property {string|null} reason       Why it could not be verified, or why it is unaffected
 * @property {string|null} patchedIn    First patched version(s), when the advisory says
 */

/**
 * @param {{ ecosystem: string, name: string, version: string|null, versions?: string[]|null, matchKind?: 'name'|'vendor_product' }} dependency
 * @param {AdvisoryRow[]} advisory  Every package row stored for this CVE, not only this dependency's
 * @returns {Verdict}
 */
export function evaluateMatch(dependency, advisory) {
    const unverified = reason => ({ verdict: 'unverified', reason, patchedIn: null });

    // The advisory's ranges describe its own packages. A vendor's product name
    // that happens to map to this dependency is a different thing, with its own
    // version numbers.
    if (dependency.matchKind === 'vendor_product') {
        return unverified('Matched through an OpenCVE product name, not the package; its versions cannot be compared');
    }

    if (!advisory || advisory.length === 0) return unverified('No affected version range is known for this vulnerability');

    const sameEcosystem = advisory.filter(row => row.ecosystem === dependency.ecosystem);
    const name = dependency.name.toLowerCase();
    const rows = sameEcosystem.filter(row => row.name === name);

    if (rows.length === 0) {
        // The advisory lists the packages it affects in this ecosystem, and this
        // one is not among them: the match came from a shared word, such as the
        // ecosystem's own name ("pip") being listed as a technology.
        if (sameEcosystem.length > 0) {
            return { verdict: 'unaffected', reason: 'The advisory names other packages', patchedIn: null };
        }
        return unverified(`The advisory has no ranges for ${dependency.ecosystem} packages`);
    }

    const patchedIn = [...new Set(rows.map(row => row.firstPatched).filter(Boolean))].join(', ') || null;

    if (!COMPARABLE.has(dependency.ecosystem)) {
        return { ...unverified(`Versions of ${dependency.ecosystem} packages cannot be compared yet`), patchedIn };
    }

    const affected = [];
    for (const row of rows) {
        const range = parseAdvisoryRange(row.vulnerableRange);
        if (!range) return { ...unverified(`The advisory range "${row.vulnerableRange}" cannot be read`), patchedIn };
        affected.push(range);
    }

    // Every version the manifest holds counts: a lockfile can carry a patched
    // copy of a package beside a vulnerable one.
    const declared = [...new Set([dependency.version, ...(dependency.versions ?? [])].filter(Boolean))];
    if (declared.length === 0) return { ...unverified('No version is recorded for this dependency'), patchedIn };

    const results = declared.map(version => judge(dependency.ecosystem, version, affected));

    const hit = results.find(result => result.verdict === 'affected');
    if (hit) return { verdict: 'affected', reason: null, patchedIn };

    const doubt = results.find(result => result.verdict === 'unverified');
    if (doubt) return { verdict: 'unverified', reason: doubt.reason, patchedIn };

    return { verdict: 'unaffected', reason: null, patchedIn };
}
