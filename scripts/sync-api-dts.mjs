import fs from 'fs';
import os from 'os';
import path from 'path';
import process from 'process';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const sourcePath = path.join(repoRoot, 'src', 'api.ts');
const targetPath = path.join(repoRoot, 'src', 'api.d.ts');
const checkOnly = process.argv.includes('--check');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-supervisor-api-dts-'));
const tscPath = require.resolve('typescript/bin/tsc');

try {
    const result = spawnSync(
        process.execPath,
        [
            tscPath,
            sourcePath,
            '--declaration',
            '--emitDeclarationOnly',
            '--module',
            'Node16',
            '--moduleResolution',
            'node16',
            '--target',
            'ES2022',
            '--lib',
            'ES2022',
            '--strict',
            '--skipLibCheck',
            '--outDir',
            tempDir,
        ],
        {
            cwd: repoRoot,
            encoding: 'utf8',
        }
    );

    if (result.status !== 0) {
        throw new Error(result.stderr || result.stdout || 'TypeScript declaration emit failed');
    }

    const generatedPath = path.join(tempDir, 'api.d.ts');
    if (!fs.existsSync(generatedPath)) {
        throw new Error(`Generated declaration not found: ${generatedPath}`);
    }

    let generated = fs.readFileSync(generatedPath, 'utf8').replace(/\r\n/g, '\n');

    // --- Post-process: inline leaf declarations to produce a self-contained bundle ---
    generated = inlineLeafDeclarations(generated, tempDir);

    const current = fs.existsSync(targetPath)
        ? fs.readFileSync(targetPath, 'utf8').replace(/\r\n/g, '\n')
        : undefined;

    if (checkOnly) {
        if (generated !== current) {
            throw new Error(
                [
                    'src/api.d.ts is out of sync with src/api.ts.',
                    `Source: ${sourcePath}`,
                    `Target: ${targetPath}`,
                    'Run `npm run sync:api-dts` to update it.',
                ].join('\n')
            );
        }

        console.log(`Supervisor API declaration is in sync: ${targetPath}`);
        process.exit(0);
    }

    fs.writeFileSync(targetPath, generated);
    console.log(`Generated ${targetPath} from ${sourcePath}`);
} finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
}

/**
 * Inline any relative-path re-exports from leaf declaration files into the
 * main api.d.ts, producing a self-contained single-file declaration bundle.
 *
 * Handles patterns like:
 *   import { Foo } from './shared/bar';
 *   export { Foo } from './shared/bar';
 * by replacing them with the actual declaration body from the leaf .d.ts.
 */
function inlineLeafDeclarations(source, tempOutDir) {
    // Match pairs of: import { X } from './path'; ... export { X } from './path';
    // Also handle standalone export { X } from './path'; without a preceding import.
    const reExportPattern = /^export \{[^}]+\} from '(\.\/[^']+)';$/gm;
    const importPattern = /^import \{[^}]+\} from '(\.\/[^']+)';$/gm;

    // Collect all relative module specifiers that appear in re-exports
    const leafSpecifiers = new Set();
    for (const match of source.matchAll(reExportPattern)) {
        leafSpecifiers.add(match[1]);
    }

    if (leafSpecifiers.size === 0) {
        return source;
    }

    for (const specifier of leafSpecifiers) {
        // Resolve the leaf .d.ts from tsc output
        const leafDtsPath = path.join(tempOutDir, specifier + '.d.ts');
        if (!fs.existsSync(leafDtsPath)) {
            console.warn(`Warning: leaf declaration not found for '${specifier}', skipping inline`);
            continue;
        }

        const leafContents = fs.readFileSync(leafDtsPath, 'utf8')
            .replace(/\r\n/g, '\n')
            .trim();

        // Remove the `import { ... } from '<specifier>';` line
        const importRe = new RegExp(
            `^import \\{[^}]+\\} from '${escapeRegExp(specifier)}';\\n`,
            'gm',
        );
        source = source.replace(importRe, '');

        // Replace the `export { ... } from '<specifier>';` line with the leaf body
        const exportRe = new RegExp(
            `^export \\{[^}]+\\} from '${escapeRegExp(specifier)}';$`,
            'gm',
        );
        source = source.replace(exportRe, leafContents);
    }

    return source;
}

function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
