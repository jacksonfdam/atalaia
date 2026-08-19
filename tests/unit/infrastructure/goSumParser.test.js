import { describe, test, expect } from '@jest/globals';

const sum = await import('#app/infrastructure/parsers/goSumParser.js');
const mod = await import('#app/infrastructure/parsers/goParser.js');
const { findParsersForFile } = await import('#app/infrastructure/parsers/parserRegistry.js');

// Trimmed from kubernetes/kubernetes, where 513 go.sum lines describe 208
// modules and go.mod redirects more than a hundred of its own to ./staging.
const GO_SUM = `bitbucket.org/bertimus9/systemstat v0.5.0 h1:n0aLnh2Jo4nBUBym9cE5PJDG8GT6g+4VuS2Ya2jYYpA=
bitbucket.org/bertimus9/systemstat v0.5.0/go.mod h1:EkUWPp8lKFPMXP8vnbpT5JDI0W/sTiLZAvN8ONWErHY=
buf.build/go/protovalidate v0.12.0/go.mod h1:q3PFfbzI05LeqxSwq+begW2syjy2Z6hLxZSkP1OH/D0=
github.com/Azure/go-autorest v14.2.0+incompatible h1:fake=
github.com/Azure/go-autorest v14.2.0+incompatible/go.mod h1:fake=
github.com/armon/go-socks5 v0.0.0-20160902184237-e75332964ef5 h1:fake=
github.com/armon/go-socks5 v0.0.0-20160902184237-e75332964ef5/go.mod h1:fake=
github.com/spf13/pflag v1.0.5 h1:fake=
github.com/spf13/pflag v1.0.5/go.mod h1:fake=
github.com/spf13/pflag v1.0.9 h1:fake=
github.com/spf13/pflag v1.0.9/go.mod h1:fake=
`;

const GO_MOD = `module k8s.io/kubernetes

go 1.24.0

require (
	github.com/spf13/pflag v1.0.9
	github.com/stretchr/testify v1.11.1
	k8s.io/api v0.0.0
	k8s.io/apimachinery v0.0.0
	// a comment
)

require github.com/google/go-cmp v0.7.0

replace (
	k8s.io/api => ./staging/src/k8s.io/api
	k8s.io/apimachinery => ./staging/src/k8s.io/apimachinery
)

replace github.com/stretchr/testify => github.com/someone/testify v1.9.0
`;

const read = (parser, content, file) =>
    Object.fromEntries(parser.parse(content, file).map(d => [d.name, d.version]));

describe('discovery', () => {
    test.each([
        ['go.sum', 1],
        ['go.mod', 1],
        ['services/api/go.sum', 1],
    ])('%s matches %i parser(s)', (filePath, expected) => {
        expect(findParsersForFile(filePath)).toHaveLength(expected);
    });

    test('only go.sum claims to resolve versions', () => {
        expect(sum.resolvesVersions).toBe(true);
        expect(mod.resolvesVersions).toBeUndefined();
    });
});

describe('go.sum', () => {
    const deps = read(sum, GO_SUM, 'go.sum');

    // In Go a transitive module is compiled into the binary exactly like a
    // direct one, so a CVE in one is the same exposure. go.mod names neither.
    test('reads a module go.mod never mentions', () => {
        expect(deps['github.com/armon/go-socks5']).toBe('v0.0.0-20160902184237-e75332964ef5');
    });

    // A module with only a /go.mod line was consulted to resolve versions and
    // its source was never downloaded, so nothing of it is in the binary.
    test('a module with only a /go.mod line is not in the build', () => {
        expect(Object.keys(deps)).not.toContain('buf.build/go/protovalidate');
    });

    test('no version carries the /go.mod suffix', () => {
        expect(Object.values(deps).some(version => version.endsWith('/go.mod'))).toBe(false);
    });

    // These are real, comparable versions to the Go proxy. Reporting either as
    // unknown would throw away an answer we have.
    test('a pseudo-version is kept as it is', () => {
        expect(deps['github.com/armon/go-socks5']).toMatch(/^v0\.0\.0-\d{14}-/);
    });

    test('an +incompatible suffix is kept as it is', () => {
        expect(deps['github.com/Azure/go-autorest']).toBe('v14.2.0+incompatible');
    });

    // The same module appears once per version in the graph, and one file can
    // store one row per module. See pickVersion.js.
    test('a module at two versions keeps the lower one', () => {
        expect(deps['github.com/spf13/pflag']).toBe('v1.0.5');
    });

    test('the full module path is the name', () => {
        expect(Object.keys(deps).sort()).toEqual([
            'bitbucket.org/bertimus9/systemstat',
            'github.com/Azure/go-autorest',
            'github.com/armon/go-socks5',
            'github.com/spf13/pflag',
        ]);
    });
});

describe('go.mod replace directives', () => {
    const deps = read(mod, GO_MOD, 'go.mod');

    // Kubernetes redirects more than a hundred of its own modules to
    // ./staging/src/..., and every one of those requires names a version that
    // nothing compiles. The module in the build is local code.
    test.each(['k8s.io/api', 'k8s.io/apimachinery'])(
        '%s is replaced by a local directory, so it is not a dependency',
        name => {
            expect(deps).not.toHaveProperty(name);
        }
    );

    test('no local path leaks in as a module name', () => {
        expect(Object.keys(deps).some(name => name.startsWith('./'))).toBe(false);
    });

    // A redirect to another module means that module is what is compiled, under
    // its own path and at its own version.
    test('a redirect to another module reports the module that is built', () => {
        expect(Object.keys(deps)).not.toContain('github.com/stretchr/testify');
        expect(deps['github.com/someone/testify']).toBe('v1.9.0');
    });

    test('an unreplaced require is untouched', () => {
        expect(deps['github.com/spf13/pflag']).toBe('v1.0.9');
    });

    test('a single-line require is still read', () => {
        expect(deps['github.com/google/go-cmp']).toBe('v0.7.0');
    });

    test('the module declaration is not a dependency', () => {
        expect(Object.keys(deps)).not.toContain('k8s.io/kubernetes');
    });
});

describe('what must not throw', () => {
    test.each([
        ['an empty go.sum', ''],
        ['a go.sum with only /go.mod lines', 'example.com/x v1.0.0/go.mod h1:fake=\n'],
        ['a truncated line', 'example.com/x\n'],
    ])('%s', (_label, content) => {
        expect(sum.parse(content, 'go.sum')).toEqual([]);
    });

    test('a go.mod with no requires', () => {
        expect(mod.parse('module example.com/x\n\ngo 1.24\n', 'go.mod')).toEqual([]);
    });

    test('a replace with no version on the right', () => {
        const deps = read(mod, 'require example.com/a v1.0.0\nreplace example.com/a => example.com/b\n', 'go.mod');

        expect(deps['example.com/b']).toBeNull();
    });
});
