import Dependency from '../../domain/entities/Dependency.js';

/**
 * Parse a Podfile.
 *
 * A Ruby DSL, close enough to a Gemfile that rubyParser.js is the model. It
 * carries constraints; cocoapodsParser.js reads Podfile.lock, and its rows win
 * when both are present.
 *
 * The name has to match what cocoapodsParser.js produces, subspecs included, or
 * the reconciliation in reconcileDependencies.js cannot tell the two apart.
 */
export const manifestFiles = ['Podfile'];

// pod 'Alamofire', '~> 5.9' — and pod 'DeepLinkKit', :path => '.'
const POD = /^pod\s+['"]([^'"]+)['"]\s*(.*)$/;

/**
 * @param {string} fileContent
 * @param {string} manifestFileName
 * @returns {Dependency[]}
 */
export function parse(fileContent, manifestFileName) {
    const byName = new Map();

    for (const raw of fileContent.split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;

        const declared = line.match(POD);
        if (!declared || byName.has(declared[1])) continue;

        byName.set(
            declared[1],
            new Dependency({
                ecosystem: 'COCOAPODS',
                name: declared[1],
                version: constraintIn(declared[2]),
                manifestFile: manifestFileName,
            })
        );
    }

    return [...byName.values()];
}

/**
 * The constraint after a pod's name.
 *
 * `:path`, `:git`, `:podspec` and `:branch` name a source rather than a version —
 * DeepLinkKit's own Podfile is `pod 'DeepLinkKit', :path => '.'`, its own code —
 * and a pod with nothing after its name takes whatever is newest.
 *
 * @param {string} rest
 * @returns {string|null}
 */
function constraintIn(rest) {
    if (/:\s*(path|git|podspec|branch|commit|tag)\b|:(path|git|podspec|branch|commit|tag)\s*=>/.test(rest)) {
        return null;
    }

    const constraint = rest.match(/^,\s*['"]([^'"]+)['"]/);
    return constraint ? constraint[1] : null;
}
