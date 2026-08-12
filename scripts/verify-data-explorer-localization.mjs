import fs from 'fs';
import path from 'path';
import process from 'process';
import { fileURLToPath } from 'url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const hostLocalizationPath = path.join(
    repositoryRoot,
    'src',
    'webview',
    'webviewLocalization.ts',
);
const simplifiedChineseBundlePath = path.join(
    repositoryRoot,
    'l10n',
    'bundle.l10n.zh-cn.json',
);
const sourceRoots = [
    path.join(repositoryRoot, 'webview', 'src', 'dataExplorer'),
    path.join(repositoryRoot, 'webview', 'src', 'dataGrid'),
];

const hostSource = fs.readFileSync(hostLocalizationPath, 'utf8');
const hostKeys = new Set(
    Array.from(
        hostSource.matchAll(/^\s*['"]([^'"]+)['"]:\s*vscode\.l10n\.t\(/gm),
        match => match[1],
    ),
);
const usages = new Map();
const dynamicCalls = [];

for (const sourceRoot of sourceRoots) {
    for (const sourcePath of walkSourceFiles(sourceRoot)) {
        const source = fs.readFileSync(sourcePath, 'utf8');
        const localizeCalls = source.match(/localize\s*\(/g)?.length ?? 0;
        const staticCallPattern = /localize\(\s*(['"])([^'"\r\n]+)\1\s*,\s*(['"])(.*?)\3/gs;
        const staticCalls = Array.from(source.matchAll(staticCallPattern));
        const expectedHelperCalls = sourcePath.endsWith(`${path.sep}nls.ts`) ? 2 : 0;
        if (localizeCalls !== staticCalls.length + expectedHelperCalls) {
            dynamicCalls.push(path.relative(repositoryRoot, sourcePath));
        }
        for (const match of staticCalls) {
            const key = match[2];
            const defaultMessage = match[4].replace(/\s+/g, ' ');
            const previous = usages.get(key);
            if (previous && previous.defaultMessage !== defaultMessage) {
                throw new Error(
                    `Data Explorer localization key '${key}' has conflicting defaults: ` +
                    `'${previous.defaultMessage}' and '${defaultMessage}'.`,
                );
            }
            usages.set(key, {
                defaultMessage,
                sourcePath: path.relative(repositoryRoot, sourcePath),
            });
        }
    }
}

if (dynamicCalls.length > 0) {
    throw new Error([
        'Data Explorer localize() calls must use static string keys and defaults:',
        ...dynamicCalls.map(file => `  - ${file}`),
    ].join('\n'));
}

const missing = Array.from(usages.keys())
    .filter(key => !hostKeys.has(key))
    .sort((left, right) => left.localeCompare(right));
if (missing.length > 0) {
    throw new Error([
        'Data Explorer localization keys are missing from the extension-host payload:',
        ...missing.map(key => `  - ${key} (${usages.get(key).sourcePath})`),
    ].join('\n'));
}

const simplifiedChineseBundle = JSON.parse(
    fs.readFileSync(simplifiedChineseBundlePath, 'utf8'),
);
const missingTranslations = Array.from(usages.values())
    .map(usage => usage.defaultMessage)
    .filter(defaultMessage => typeof simplifiedChineseBundle[defaultMessage] !== 'string')
    .sort((left, right) => left.localeCompare(right));
if (missingTranslations.length > 0) {
    throw new Error([
        'Data Explorer default messages are missing from the Simplified Chinese bundle:',
        ...missingTranslations.map(message => `  - ${message}`),
    ].join('\n'));
}

console.log(
    `Verified ${usages.size} Data Explorer localization keys across ` +
    `${sourceRoots.length} Webview source roots.`,
);

function* walkSourceFiles(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            yield* walkSourceFiles(entryPath);
        } else if (
            entry.isFile() &&
            entry.name !== 'nls.ts' &&
            (entry.name.endsWith('.ts') || entry.name.endsWith('.svelte'))
        ) {
            yield entryPath;
        }
    }
}
