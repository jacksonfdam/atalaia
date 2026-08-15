/**
 * The documentation site.
 *
 * The Markdown in docs/ is the source and stays readable on GitHub; this turns
 * it into static HTML wearing the console's own chrome. Nothing is duplicated
 * to make that work:
 *
 *  - the navigation is parsed out of docs/README.md, which is already the index
 *  - the landing page is built from the repository README, which is already the
 *    pitch
 *  - the palette is the console's own tokens.css, copied at build time rather
 *    than transcribed
 *
 * Output is docs/dist/, one directory per page so the URLs are clean without
 * any host configuration. `node site/build.mjs --serve` builds and then serves
 * it on :4321.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const SITE = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.resolve(SITE, '..');
const REPO = path.resolve(DOCS, '..');
const DIST = path.join(DOCS, 'dist');

const TOKENS = path.join(REPO, 'ui', 'src', 'styles', 'tokens.css');
const SCREENSHOTS = path.join(SITE, 'assets', 'screenshots');

const GITHUB = 'https://github.com/jacksonfdam/atalaia';

/* ------------------------------------------------------------------ markdown */

/**
 * Links between documents are relative Markdown paths on GitHub. On the site
 * every page lives at its own root-level directory, so `queues.md` becomes
 * `/queues/` and `docs/queues.md` (as written in the repository README) becomes
 * the same thing.
 */
function rewriteLink(href) {
    if (!href || /^(https?:|mailto:|#)/.test(href)) return href;

    const [target, hash = ''] = href.split('#');
    if (!target.endsWith('.md')) return href;

    const slug = path.basename(target, '.md');
    const to = slug === 'README' ? '/docs/' : `/${slug}/`;

    return hash ? `${to}#${hash}` : to;
}

/** Inline Markdown only — for blurbs, which are one sentence and carry `code`. */
function renderInline(markdown) {
    return marked.parseInline(markdown, { gfm: true, async: false });
}

function render(markdown) {
    const renderer = new marked.Renderer();

    const link = renderer.link.bind(renderer);
    renderer.link = token => link({ ...token, href: rewriteLink(token.href) });

    // Wide tables scroll inside the window rather than stretching the page.
    const table = renderer.table.bind(renderer);
    renderer.table = token => `<div class="table-scroll">${table(token)}</div>`;

    return marked.parse(markdown, { renderer, gfm: true, async: false });
}

/** The first `# Heading` of a document, which is its title. */
function titleOf(markdown, fallback) {
    return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? fallback;
}

/** Everything after the first heading, minus the heading itself. */
function bodyOf(markdown) {
    return markdown.replace(/^#\s+.+$/m, '').trimStart();
}

/* ---------------------------------------------------------------- navigation */

/**
 * The index table in docs/README.md is the table of contents: one row per
 * document, with the sentence that describes it. Parsing it here means the
 * sidebar cannot fall out of step with the index a reader sees on GitHub.
 *
 * @returns {{ slug: string, label: string, blurb: string }[]}
 */
function parseIndex(indexMarkdown) {
    const rows = [];

    for (const line of indexMarkdown.split('\n')) {
        const match = line.match(/^\|\s*\[([^\]]+)\]\(([^)]+\.md)\)\s*\|\s*([^|]*?)\s*\|/);
        if (!match) continue;

        rows.push({
            slug: path.basename(match[2], '.md'),
            label: match[1].trim(),
            blurb: match[3].trim(),
        });
    }

    return rows;
}

/* -------------------------------------------------------------------- layout */

const escape = text => String(text).replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
);

function navigation(pages, current) {
    const item = (href, label, active) =>
        `<a href="${href}"${active ? ' class="active"' : ''}>${escape(label)}</a>`;

    return `<nav class="nav">
        ${item('/', 'Overview', current === 'home')}
        ${pages.map(page => item(`/${page.slug}/`, page.label, current === page.slug)).join('\n        ')}
        <a href="${GITHUB}" class="external">GitHub <span class="tally">↗</span></a>
      </nav>`;
}

function page({ title, description, pages, current, main }) {
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="dark" />
    <title>${escape(title)}</title>
    <meta name="description" content="${escape(description)}" />
    <meta property="og:title" content="${escape(title)}" />
    <meta property="og:description" content="${escape(description)}" />
    <meta property="og:type" content="website" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Geist+Mono:wght@400;500;600&display=swap"
      rel="stylesheet"
    />
    <link rel="stylesheet" href="/tokens.css" />
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <div class="shell">
      <aside class="sidebar">
        <a class="brand" href="/">Atalaia<small>Documentation</small></a>
        ${navigation(pages, current)}
        <div class="sidebar-foot">
          Vulnerability intelligence<br />for engineering teams.<br />MIT licensed.
        </div>
      </aside>
      <main class="main">
${main}
      </main>
    </div>
  </body>
</html>
`;
}

/** The console's window chrome: a title bar, an accent, and paper inside. */
function windowBox({ title, note = '', accent = 'var(--pink)', body, flush = false }) {
    return `        <section class="window" style="--accent: ${accent}">
          <div class="titlebar"><span class="grow">${escape(title)}</span>${
              note ? `<span class="titlebar-note">${escape(note)}</span>` : ''
          }</div>
          <div class="window-body${flush ? ' flush' : ''}">
${body}
          </div>
        </section>`;
}

/* ------------------------------------------------------------------ the pages */

const ACCENTS = ['var(--pink)', 'var(--cyan)', 'var(--lime)', 'var(--violet)', 'var(--orange)'];

async function screenshots() {
    let files = [];
    try {
        files = (await fs.readdir(SCREENSHOTS)).filter(name => /\.(png|jpe?g|webp|gif)$/i.test(name)).sort();
    } catch {
        // No directory, no section. A gallery of placeholders would be a lie
        // about what the console looks like.
        return '';
    }

    if (files.length === 0) return '';

    const caption = file =>
        path
            .basename(file, path.extname(file))
            .replace(/^\d+[-_]?/, '')
            .replace(/[-_]+/g, ' ')
            .replace(/^\w/, c => c.toUpperCase());

    const shots = files
        .map(
            file => `            <figure class="shot">
              <img src="/screenshots/${encodeURIComponent(file)}" alt="${escape(caption(file))}" loading="lazy" />
              <figcaption>${escape(caption(file))}</figcaption>
            </figure>`
        )
        .join('\n');

    return windowBox({
        title: 'console.exe',
        note: `${files.length} screen${files.length === 1 ? '' : 's'}`,
        accent: 'var(--cyan)',
        body: `            <div class="gallery">\n${shots}\n            </div>`,
    });
}

/**
 * The landing page is the repository README, split at its headings so each
 * section lands in its own window — the same README, wearing the console.
 */
function landing(readme, pages) {
    const sections = readme.split(/^## /m).slice(1);
    const pitch = readme.slice(readme.indexOf('\n'), readme.indexOf('\n## ')).trim();

    const hero = `        <section class="hero window" style="--accent: var(--lime)">
          <div class="titlebar"><span class="grow">atalaia.exe</span><span class="titlebar-note">v1.0.0</span></div>
          <div class="window-body">
            <p class="eyebrow">Proactive vulnerability intelligence</p>
            <h1>Watch the feeds.<br />Filter to your stack.<br />Alert the owner.</h1>
${render(pitch.replace(/^\*\*.*\*\*\n?/, ''))}
            <div class="cta">
              <a class="button primary" href="/running/">Get started</a>
              <a class="button" href="/architecture/">How it works</a>
              <a class="button" href="${GITHUB}">Source</a>
            </div>
          </div>
        </section>`;

    const windows = sections
        .map((section, index) => {
            const [heading, ...rest] = section.split('\n');
            const body = rest.join('\n').trim();
            if (!body) return '';

            return windowBox({
                title: `${heading.trim().toLowerCase().replace(/\s+/g, '-')}.txt`,
                accent: ACCENTS[index % ACCENTS.length],
                body: `            <h2>${escape(heading.trim())}</h2>\n${render(body)}`,
            });
        })
        .filter(Boolean);

    const index = windowBox({
        title: 'documentation',
        note: `${pages.length} pages`,
        accent: 'var(--violet)',
        body: `            <div class="cards">
${pages
    .map(
        p => `              <a class="card" href="/${p.slug}/">
                <span class="card-title">${escape(p.label)}</span>
                <span class="card-blurb">${renderInline(p.blurb)}</span>
              </a>`
    )
    .join('\n')}
            </div>`,
    });

    return { hero, windows, index };
}

/* --------------------------------------------------------------------- build */

async function copyStatic() {
    await fs.mkdir(DIST, { recursive: true });
    await fs.copyFile(TOKENS, path.join(DIST, 'tokens.css'));
    await fs.copyFile(path.join(SITE, 'styles', 'site.css'), path.join(DIST, 'styles.css'));
    await fs.copyFile(path.join(SITE, 'assets', 'favicon.svg'), path.join(DIST, 'favicon.svg'));

    try {
        await fs.cp(SCREENSHOTS, path.join(DIST, 'screenshots'), { recursive: true });
    } catch {
        // Nothing to copy.
    }
}

async function writePage(slug, html) {
    const directory = slug === null ? DIST : path.join(DIST, slug);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'index.html'), html);
}

async function build() {
    await fs.rm(DIST, { recursive: true, force: true });
    await copyStatic();

    const indexMarkdown = await fs.readFile(path.join(DOCS, 'README.md'), 'utf-8');
    const pages = parseIndex(indexMarkdown);

    if (pages.length === 0) throw new Error('docs/README.md has no index table — nothing to build');

    // The site's own README page: the index itself, so /docs/ is not a dead link.
    const readme = await fs.readFile(path.join(REPO, 'README.md'), 'utf-8');
    const { hero, windows, index } = landing(readme, pages);

    await writePage(
        null,
        page({
            title: 'Atalaia — vulnerability intelligence for engineering teams',
            description:
                'Atalaia watches public vulnerability feeds, filters them against the technologies you ship, ' +
                'correlates them with your repositories and alerts the people responsible.',
            pages,
            current: 'home',
            main: [hero, await screenshots(), index, ...windows].filter(Boolean).join('\n'),
        })
    );

    await writePage(
        'docs',
        page({
            title: 'Documentation — Atalaia',
            description: 'Every guide, in one index.',
            pages,
            current: 'docs',
            main: windowBox({
                title: 'documentation',
                note: `${pages.length} pages`,
                accent: 'var(--violet)',
                body: render(bodyOf(indexMarkdown)),
            }),
        })
    );

    for (const [position, entry] of pages.entries()) {
        const markdown = await fs.readFile(path.join(DOCS, `${entry.slug}.md`), 'utf-8');

        await writePage(
            entry.slug,
            page({
                title: `${titleOf(markdown, entry.label)} — Atalaia`,
                description: entry.blurb,
                pages,
                current: entry.slug,
                main: windowBox({
                    // The title bar carries the file name only. What the page is
                    // about is the line above the heading, where there is room
                    // for it — a sentence squeezed into chrome is a sentence
                    // nobody reads.
                    title: `${entry.slug}.md`,
                    accent: ACCENTS[position % ACCENTS.length],
                    body: `            <p class="eyebrow">${renderInline(entry.blurb)}</p>
            <h1>${escape(titleOf(markdown, entry.label))}</h1>
${render(bodyOf(markdown))}`,
                }),
            })
        );
    }

    console.log(`Built ${pages.length + 2} pages into ${path.relative(REPO, DIST)}`);
}

await build();

if (process.argv.includes('--serve')) {
    const { createServer } = await import('node:http');
    const PORT = 4321;

    const TYPES = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.webp': 'image/webp',
    };

    createServer(async (req, res) => {
        const url = decodeURIComponent(req.url.split('?')[0]);
        const candidate = url.endsWith('/') ? path.join(DIST, url, 'index.html') : path.join(DIST, url);

        try {
            const body = await fs.readFile(candidate);
            res.writeHead(200, { 'Content-Type': TYPES[path.extname(candidate)] ?? 'application/octet-stream' });
            res.end(body);
        } catch {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found');
        }
    }).listen(PORT, () => console.log(`Serving ${path.relative(REPO, DIST)} on http://localhost:${PORT}`));
}
