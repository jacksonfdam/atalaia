import semver from 'semver';

/**
 * Is the declared version behind the latest published one?
 *
 * Manifests do not declare versions, they declare *constraints*: `^4.17.0`,
 * `~> 6.1`, `[1.0,2.0)`, `v3`, a commit SHA. Each ecosystem spells them its own
 * way, so each is translated into a semver range and asked one question — does
 * this constraint already allow the newest release?
 *
 * A constraint that allows it is current, even when the lockfile is older: what
 * is being reported here is the manifest, and a manifest that says `^7` with 7.1
 * out is not asking anyone to do anything.
 *
 * Anything that cannot be translated honestly answers `unknown` rather than
 * guessing — a false "up to date" is worse than an admitted gap.
 *
 * @typedef {'current'|'behind'|'unknown'} VersionState
 */

const DIGEST = /^(sha256:|[0-9a-f]{7,40}$)/i;
const RUBY_PESSIMISTIC = /^~>\s*(.+)$/;
const PYTHON_COMPATIBLE = /^~=\s*(.+)$/;
const BRACKET_RANGE = /^[[(]/;

/** Trim what registries and tags add around a plain version. */
function clean(value) {
    return String(value ?? '').trim().replace(/^v/i, '');
}

/**
 * `~> 6.1` allows 6.x but not 7; `~> 6.1.2` allows 6.1.x but not 6.2.
 * Same idea as npm's `~`, one segment further out.
 */
function fromPessimistic(constraint) {
    const parts = clean(constraint).split('.');
    if (parts.length <= 1) return `>=${parts[0]} <${Number(parts[0]) + 1}`;

    const upperIndex = parts.length - 2;
    const upper = parts.slice(0, upperIndex + 1);
    upper[upperIndex] = String(Number(upper[upperIndex]) + 1);

    return `>=${parts.join('.')} <${upper.join('.')}`;
}

/**
 * Translate one ecosystem's constraint into a semver range.
 * @returns {string|null} null when it cannot be translated
 */
function toRange(ecosystem, declared) {
    const raw = String(declared ?? '').trim();
    if (!raw) return null;

    // A digest or commit pin names one artifact and nothing else. Whether a
    // newer one exists is a real question, but not one semver can answer.
    if (DIGEST.test(raw) && !semver.valid(clean(raw))) return null;

    // Maven and NuGet interval notation: [1.0,2.0) and friends.
    if (BRACKET_RANGE.test(raw)) return null;

    switch (ecosystem) {
        case 'RUBYGEMS': {
            const pessimistic = raw.match(RUBY_PESSIMISTIC);
            return pessimistic ? fromPessimistic(pessimistic[1]) : normalizeSimple(raw);
        }

        case 'PIP': {
            const compatible = raw.match(PYTHON_COMPATIBLE);
            if (compatible) return fromPessimistic(compatible[1]);
            // ==1.2.3 is an exact pin; the rest is already semver-shaped enough.
            return normalizeSimple(raw.replace(/^==/, ''));
        }

        case 'GITHUB_ACTIONS':
            // `v3` means "the v3 line", which is a major-version range.
            return /^v?\d+$/i.test(raw) ? `^${clean(raw)}.0.0` : normalizeSimple(raw);

        default:
            return normalizeSimple(raw);
    }
}

/** npm-style ranges pass through; bare versions become exact pins. */
function normalizeSimple(raw) {
    const value = clean(raw);

    if (semver.validRange(value)) return value;

    // Two-segment versions (`1.4`) are valid ranges to semver but not versions;
    // three-segment coercion keeps the comparison honest.
    const coerced = semver.coerce(value);
    return coerced ? coerced.version : null;
}

/**
 * @param {string} ecosystem
 * @param {string|null} declared Version or range from the manifest
 * @param {string|null} latest   Version from the registry
 * @returns {{ state: VersionState, gap: 'major'|'minor'|'patch'|null, reason: string|null }}
 */
export function compareVersions(ecosystem, declared, latest) {
    const target = semver.coerce(clean(latest));

    if (!latest) return { state: 'unknown', gap: null, reason: 'No published version known' };
    if (!target) return { state: 'unknown', gap: null, reason: `"${latest}" is not a version this can compare` };
    if (!declared) return { state: 'unknown', gap: null, reason: 'The manifest declares no version' };

    const range = toRange(ecosystem, declared);
    if (!range) {
        return {
            state: 'unknown',
            gap: null,
            reason: `"${declared}" is a pin this cannot compare — a digest, a commit, or an interval`,
        };
    }

    // A range that already admits the newest release is current by definition.
    if (semver.validRange(range) && semver.satisfies(target, range, { includePrerelease: false })) {
        return { state: 'current', gap: null, reason: null };
    }

    const declaredVersion = semver.coerce(range.replace(/^[^\d]*/, ''));
    if (!declaredVersion) return { state: 'behind', gap: null, reason: null };

    if (semver.gte(declaredVersion, target)) {
        // Declared newer than the registry knows about: a pre-release, or a
        // registry that has not caught up. Not something to chase.
        return { state: 'current', gap: null, reason: null };
    }

    return { state: 'behind', gap: semver.diff(declaredVersion, target) ?? null, reason: null };
}

/**
 * Back-compatible shorthand: true when nothing needs doing.
 * @returns {boolean}
 */
export function isSatisfied(declared, latest, ecosystem = 'NPM') {
    return compareVersions(ecosystem, declared, latest).state !== 'behind';
}
