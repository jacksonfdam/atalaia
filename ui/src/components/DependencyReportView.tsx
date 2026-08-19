import { Link } from 'react-router-dom';
import { Window, Body, Loading, Notice, Empty, BarRow, formatDate } from './ui';
import type { DependencyReport } from '../types';

/**
 * The dependency and technology report, on screen.
 *
 * One component for both places it is read: the Reports page shows the fleet,
 * a repository's own page shows itself. `GET /reports/dependencies` is the same
 * endpoint either way, so the two can never disagree.
 *
 * The four states are kept apart everywhere, including in the headline numbers.
 * "412 dependencies, 380 up to date" is a lie when 200 of them were never
 * compared with a registry, and it is the kind of lie a page like this exists to
 * avoid telling.
 */

const GAP_COLOR: Record<string, string> = {
  major: 'var(--severity-critical)',
  minor: 'var(--severity-high)',
  patch: 'var(--severity-low)',
  other: 'var(--severity-unknown)',
};

const LANGUAGE_COLORS = [
  'var(--cyan)',
  'var(--pink)',
  'var(--lime)',
  'var(--orange)',
  'var(--violet)',
];

function bytes(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} MB`;
  if (value >= 1000) return `${Math.round(value / 1000)} kB`;
  return `${value} B`;
}

export function DependencyReportView({
  report,
  loading,
  error,
}: {
  report: DependencyReport | null;
  loading: boolean;
  error?: string | null;
}) {
  if (loading) {
    return (
      <Window title="DEPENDENCIES.RPT" accent="var(--cyan)">
        <Body>
          <Loading what="the dependency report" />
        </Body>
      </Window>
    );
  }

  if (error) {
    return (
      <Window title="DEPENDENCIES.RPT" accent="var(--cyan)">
        <Body>
          <Notice kind="error">{error}</Notice>
        </Body>
      </Window>
    );
  }

  if (!report) return null;

  const { coverage, dependencies, updates, technologies, notes } = report;
  const fleet = report.scope.kind === 'fleet';

  return (
    <>
      <Window
        title="DEPENDENCIES.RPT"
        note={fleet ? `${coverage.repositories} repositories` : report.scope.repository?.name}
        accent="var(--cyan)"
      >
        <Body>
          <p className="muted">
            As of {formatDate(report.generatedAt)}. {dependencies.packages} distinct{' '}
            {dependencies.packages === 1 ? 'package' : 'packages'} across {dependencies.manifests}{' '}
            {dependencies.manifests === 1 ? 'manifest' : 'manifests'} in {dependencies.ecosystems}{' '}
            {dependencies.ecosystems === 1 ? 'ecosystem' : 'ecosystems'}
            {fleet
              ? `, from ${coverage.scanned} of ${coverage.repositories} repositories scanned`
              : ''}
            .
          </p>

          <div className="grid cols-4">
            <Figure label="Dependencies" value={dependencies.total} />
            <Figure label="Behind" value={dependencies.byState.behind} accent="var(--orange)" />
            <Figure label="Up to date" value={dependencies.byState.current} accent="var(--lime)" />
            <Figure
              label="Unknown or unchecked"
              value={dependencies.byState.unknown + dependencies.byState.unchecked}
              accent="var(--severity-unknown)"
            />
          </div>

          <p className="muted" style={{ marginTop: '0.5rem' }}>
            Of the {dependencies.total} stored,{' '}
            <strong>{dependencies.byState.behind}</strong> are behind,{' '}
            <strong>{dependencies.byState.current}</strong> already allow the newest release,{' '}
            <strong>{dependencies.byState.unknown}</strong> were checked and cannot be compared, and{' '}
            <strong>{dependencies.byState.unchecked}</strong> have never been checked at all. The
            last two are unknown, not up to date.
          </p>

          {dependencies.checkedAt.newest ? (
            <p className="muted mono" style={{ fontSize: '0.7rem' }}>
              registry answers between {formatDate(dependencies.checkedAt.oldest)} and{' '}
              {formatDate(dependencies.checkedAt.newest)}
            </p>
          ) : null}

          {notes.map(note => (
            <div key={note.text} style={{ marginTop: '0.45rem' }}>
              <Notice kind={note.level === 'warn' ? 'warn' : 'ok'}>{note.text}</Notice>
            </div>
          ))}
        </Body>
      </Window>

      <Window
        title="UPDATES.LST"
        note={`${updates.behind} behind`}
        accent="var(--orange)"
      >
        <Body>
          {updates.behind === 0 ? (
            <Empty>
              Nothing is behind a release the manifest does not already allow.
              {dependencies.byState.unchecked > 0
                ? ` ${dependencies.byState.unchecked} were never checked, so this is not the whole picture.`
                : ''}
            </Empty>
          ) : (
            <>
              <p className="muted" style={{ marginBottom: '0.5rem' }}>
                The registry has a release the manifest does not admit. Whether the upgrade is safe
                is a question about your code.
              </p>

              <div style={{ marginBottom: '0.7rem' }}>
                {(['major', 'minor', 'patch', 'other'] as const).map(gap => (
                  <BarRow
                    key={gap}
                    label={gap === 'other' ? 'not comparable' : gap}
                    count={updates.byGap[gap]}
                    max={updates.behind}
                    color={GAP_COLOR[gap]}
                  />
                ))}
              </div>

              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Ecosystem</th>
                      <th>Package</th>
                      <th>Declared</th>
                      <th>Latest</th>
                      <th>Gap</th>
                      {fleet ? <th>Repos</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {updates.packages.items.map(entry => (
                      <tr key={`${entry.ecosystem}-${entry.name}`}>
                        <td className="tight mono">{entry.ecosystem}</td>
                        <td className="mono">{entry.name}</td>
                        <td className="tight mono">{entry.declared.join(', ')}</td>
                        <td className="tight mono">{entry.latest ?? '—'}</td>
                        <td className="tight" style={{ color: GAP_COLOR[entry.worstGap ?? 'other'] }}>
                          {entry.worstGap ?? '—'}
                        </td>
                        {fleet ? <td className="tight mono">{entry.repositories}</td> : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {updates.packages.count > updates.packages.shown ? (
                <p className="muted" style={{ marginTop: '0.4rem' }}>
                  Showing {updates.packages.shown} of {updates.packages.count} packages, the ones
                  reaching the most repositories first.
                </p>
              ) : null}

              {fleet && updates.repositories.count > 0 ? (
                <>
                  <p className="muted" style={{ margin: '0.8rem 0 0.35rem' }}>
                    Where that work sits:
                  </p>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Repository</th>
                          <th>Behind</th>
                          <th>Of</th>
                          <th>Unchecked</th>
                          <th>Scanned</th>
                        </tr>
                      </thead>
                      <tbody>
                        {updates.repositories.items.map(entry => (
                          <tr key={entry.id}>
                            <td>
                              <Link to={`/repositories/${entry.id}`}>{entry.name}</Link>
                            </td>
                            <td className="tight mono">{entry.behind}</td>
                            <td className="tight mono">{entry.total}</td>
                            <td className="tight mono">{entry.unchecked}</td>
                            <td className="tight muted">{formatDate(entry.lastScannedAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {updates.repositories.count > updates.repositories.shown ? (
                    <p className="muted" style={{ marginTop: '0.4rem' }}>
                      Showing {updates.repositories.shown} of {updates.repositories.count}.
                    </p>
                  ) : null}
                </>
              ) : null}
            </>
          )}
        </Body>
      </Window>

      <Window
        title="TECHNOLOGIES.DAT"
        note={`${technologies.ecosystems.length} ecosystems`}
        accent="var(--violet)"
      >
        <Body>
          <p className="muted" style={{ marginBottom: '0.5rem' }}>
            Languages come from the hosting provider and describe the code; ecosystems come from the
            manifests a scan found and describe what it depends on. A repository can report
            TypeScript and carry its risk in a Dockerfile.
          </p>

          {technologies.languages.length === 0 ? (
            <Empty>No language breakdown has been read from the provider yet.</Empty>
          ) : (
            <div style={{ marginBottom: '0.8rem' }}>
              {technologies.languages.slice(0, 8).map((language, index) => (
                <BarRow
                  key={language.name}
                  label={`${language.name} · ${bytes(language.bytes)}${
                    language.share !== null ? ` · ${language.share}%` : ''
                  }`}
                  count={language.bytes}
                  max={technologies.languages[0].bytes}
                  color={LANGUAGE_COLORS[index % LANGUAGE_COLORS.length]}
                />
              ))}
            </div>
          )}

          {technologies.ecosystems.length === 0 ? (
            <Empty>Nothing has been parsed from a manifest yet.</Empty>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Ecosystem</th>
                    <th>Packages</th>
                    <th>Behind</th>
                    <th>Unchecked</th>
                    {fleet ? <th>Repos</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {technologies.ecosystems.map(ecosystem => (
                    <tr key={ecosystem.name}>
                      <td className="mono">{ecosystem.name}</td>
                      <td className="tight mono">{ecosystem.packages}</td>
                      <td className="tight mono">{ecosystem.behind}</td>
                      <td className="tight mono">{ecosystem.unchecked}</td>
                      {fleet ? <td className="tight mono">{ecosystem.repositories}</td> : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {technologies.manifests.length > 0 ? (
            <p className="muted" style={{ marginTop: '0.6rem' }}>
              Read from{' '}
              {technologies.manifests.slice(0, 12).map((manifest, index) => (
                <span key={manifest.file}>
                  {index > 0 ? ', ' : ''}
                  <span className="mono">{manifest.file}</span>
                  {fleet ? ` (${manifest.repositories})` : ''}
                </span>
              ))}
              {technologies.manifests.length > 12
                ? ` and ${technologies.manifests.length - 12} more`
                : ''}
              .
            </p>
          ) : null}

          {technologies.topics.length > 0 ? (
            <p className="muted" style={{ marginTop: '0.35rem' }}>
              Topics:{' '}
              {technologies.topics.slice(0, 15).map((topic, index) => (
                <span key={topic.name}>
                  {index > 0 ? ', ' : ''}
                  <span className="mono">{topic.name}</span>
                  {fleet ? ` (${topic.repositories})` : ''}
                </span>
              ))}
              .
            </p>
          ) : null}
        </Body>
      </Window>
    </>
  );
}

/** A headline number. Local because it takes an accent colour; ui.tsx's does not. */
function Figure({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="stat">
      <span className="value" style={accent ? { color: accent } : undefined}>
        {value}
      </span>
      <span className="label">{label}</span>
    </div>
  );
}
