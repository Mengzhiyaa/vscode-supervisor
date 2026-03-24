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

    const generated = fs.readFileSync(generatedPath, 'utf8').replace(/\r\n/g, '\n');
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
