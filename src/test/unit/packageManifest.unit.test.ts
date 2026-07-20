import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

interface PackageJsonShape {
    name?: string;
    publisher?: string;
    icon?: string;
    homepage?: string;
    bugs?: { url?: string };
    repository?: { type?: string; url?: string };
    main?: string;
    activationEvents?: string[];
    extensionDependencies?: string[];
    scripts?: Record<string, string | undefined>;
    workspaces?: string[];
    devDependencies?: Record<string, string | undefined>;
    positron?: {
        binaryDependencies?: Record<string, string | undefined>;
        binaryChecksums?: Record<string, Record<string, string | undefined> | undefined>;
    };
    contributes?: {
        languages?: Array<{ id?: string }>;
        grammars?: Array<{ language?: string }>;
        commands?: Array<{ command?: string }>;
        notebookRenderer?: Array<{
            id?: string;
            entrypoint?: string;
            requiresMessaging?: string;
            mimeTypes?: string[];
        }>;
        configuration?: {
            properties?: Record<string, { default?: unknown; enum?: unknown[] }>;
        };
        views?: Record<string, Array<{ id?: string; name?: string }>>;
        viewsWelcome?: Array<{ view?: string; contents?: string }>;
    };
}

function readPackageJson(): PackageJsonShape {
    const repoRoot = path.resolve(__dirname, '../../..');
    const packageJsonPath = path.join(repoRoot, 'package.json');
    return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as PackageJsonShape;
}

function readRepoFile(relativePath: string): string {
    const repoRoot = path.resolve(__dirname, '../../..');
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

suite('[Unit] Supervisor package manifest', () => {
    test('excludes R-owned manifest surface', () => {
        const packageJson = readPackageJson();

        assert.strictEqual(packageJson.name, 'vscode-supervisor');
        assert.strictEqual(packageJson.publisher, 'mengzhiya');
        assert.strictEqual(packageJson.icon, 'images/logo.png');
        assert.strictEqual(packageJson.main, './dist/extension.js');
        assert.strictEqual(packageJson.repository?.type, 'git');
        assert.strictEqual(packageJson.repository?.url, 'https://github.com/Mengzhiyaa/vscode-supervisor');
        assert.strictEqual(packageJson.homepage, 'https://github.com/Mengzhiyaa/vscode-supervisor#readme');
        assert.strictEqual(packageJson.bugs?.url, 'https://github.com/Mengzhiyaa/vscode-supervisor/issues');
        assert.deepStrictEqual(packageJson.activationEvents, ['onStartupFinished']);
        assert.deepStrictEqual(packageJson.workspaces, ['webview']);
        assert.strictEqual(packageJson.positron?.binaryDependencies?.kallichore, '0.1.67');
        assert.strictEqual(packageJson.positron?.binaryDependencies?.ark, undefined);
        assert.match(
            packageJson.positron?.binaryChecksums?.kallichore?.['linux-x64'] ?? '',
            /^sha256:[0-9a-f]{64}$/,
        );
        assert.ok(packageJson.devDependencies?.['@vscode/vsce']);
        assert.ok(packageJson.devDependencies?.ovsx);
        assert.strictEqual(packageJson.scripts?.['vsce:package'], 'vsce package');
        assert.strictEqual(packageJson.scripts?.['install:binaries'], 'node scripts/install-binaries.mjs');
        assert.strictEqual(packageJson.scripts?.['sync:kallichore-api'], 'node scripts/sync-kallichore-api.mjs');
        assert.strictEqual(packageJson.scripts?.['verify:kallichore-api'], 'node scripts/sync-kallichore-api.mjs --check');
        assert.strictEqual(packageJson.scripts?.['sync:webview-rpc-contracts'], 'node scripts/sync-webview-rpc-contracts.mjs');
        assert.strictEqual(packageJson.scripts?.['verify:webview-rpc-contracts'], 'node scripts/sync-webview-rpc-contracts.mjs --check');
        assert.strictEqual(packageJson.scripts?.['sync:positron-contracts'], 'node scripts/sync-positron-contracts.mjs');
        assert.strictEqual(packageJson.scripts?.['verify:positron-contracts'], 'node scripts/sync-positron-contracts.mjs --check');
        assert.strictEqual(packageJson.scripts?.['verify:contracts'], 'npm run verify:api-dts && npm run verify:webview-rpc-contracts');
        assert.strictEqual(packageJson.scripts?.['build:webview'], 'npm --prefix webview run build');
        assert.strictEqual(packageJson.scripts?.['build'], 'npm run check:webview && npm run build:webview && npm run copy:duckdb && npm run compile');
        assert.strictEqual(
            packageJson.scripts?.['test:unit:ext'],
            'npm run test:prepare && node scripts/run-vscode-tests.mjs --label unit'
        );
        assert.ok(!packageJson.extensionDependencies?.length, 'Supervisor package should not depend on language extensions');
        assert.deepStrictEqual(packageJson.contributes?.languages ?? [], []);
        assert.deepStrictEqual(packageJson.contributes?.grammars ?? [], []);

        const commands = new Set((packageJson.contributes?.commands ?? []).map((entry) => entry.command));
        assert.ok(!commands.has('supervisor.startConsole'));
        assert.ok(!commands.has('supervisor.restartKernel'));
        assert.ok(!commands.has('supervisor.selectRPath'));
        assert.ok(!commands.has('supervisor.runCurrentStatement'));
        assert.ok(!commands.has('supervisor.insertAssignmentOperator'));
        assert.ok(!commands.has('supervisor.insertPipeOperator'));
        assert.ok(!commands.has('supervisor.help.showHelpAtCursor'));
    });

    test('keeps release files and packaging rules', () => {
        const vscodeIgnore = readRepoFile('.vscodeignore');
        const readme = readRepoFile('README.md');

        for (const file of ['README.md', 'CHANGELOG.md', 'LICENSE.txt', 'ThirdPartyNotices.txt', '.vscodeignore']) {
            assert.ok(fs.existsSync(path.join(path.resolve(__dirname, '../../..'), file)), `Expected ${file} to exist`);
        }

        assert.match(readme, /Standalone kernel-supervisor framework extension/i);
        assert.match(readme, /ark\.vscode-ark/);
        assert.match(readme, /VSCE_PAT/);
        assert.match(readme, /OVSX_PAT/);
        assert.match(vscodeIgnore, /!LICENSE\.txt/);
        assert.match(vscodeIgnore, /!ThirdPartyNotices\.txt/);
        assert.match(vscodeIgnore, /!README\.md/);
        assert.match(vscodeIgnore, /!CHANGELOG\.md/);
        assert.match(vscodeIgnore, /webview\/package\.json/);
        assert.match(vscodeIgnore, /webview\/src\/\*\*/);
        assert.match(vscodeIgnore, /src\/\*\*/);
        assert.match(vscodeIgnore, /out\/\*\*/);
        assert.match(vscodeIgnore, /node_modules\/\*\*/);
        assert.match(vscodeIgnore, /webview\/node_modules\/\*\*/);
        assert.ok(fs.existsSync(path.join(path.resolve(__dirname, '../../..'), 'webview/package.json')));
        assert.ok(fs.existsSync(path.join(path.resolve(__dirname, '../../..'), 'webview/src/console/main.ts')));
        assert.ok(fs.existsSync(path.join(path.resolve(__dirname, '../../..'), 'scripts/install-binaries.mjs')));
        assert.ok(fs.existsSync(path.join(path.resolve(__dirname, '../../..'), 'scripts/run-vscode-tests.mjs')));
        assert.ok(fs.existsSync(path.join(path.resolve(__dirname, '../../..'), '.github/workflows/ci.yml')));
        assert.ok(fs.existsSync(path.join(path.resolve(__dirname, '../../..'), '.github/workflows/release.yml')));
    });

    test('contributes the P0 plots contract and runtime diagnostics view', () => {
        const packageJson = readPackageJson();
        const properties = packageJson.contributes?.configuration?.properties ?? {};
        assert.strictEqual(properties['plots.defaultSizingPolicy']?.default, 'auto');
        assert.deepStrictEqual(properties['plots.historyPolicy']?.enum, ['auto', 'always', 'never']);
        assert.deepStrictEqual(properties['plots.darkFilter']?.enum, ['auto', 'on', 'off']);
        assert.strictEqual(properties['plots.darkFilterMode'], undefined);

        const commands = new Set((packageJson.contributes?.commands ?? []).map(entry => entry.command));
        assert.ok(commands.has('supervisor.runtimeSessions.refresh'));
        const sessionViews = packageJson.contributes?.views?.['supervisor-sidebar-session'] ?? [];
        assert.ok(sessionViews.some(view => view.id === 'supervisor.runtimeSessions'));
    });

    test('contributes notebook inline Data Explorer and Connections surfaces', () => {
        const packageJson = readPackageJson();
        const renderer = packageJson.contributes?.notebookRenderer?.find(
            candidate => candidate.id === 'supervisor.inlineDataExplorerRenderer',
        );
        assert.strictEqual(renderer?.entrypoint, './notebook/inlineDataExplorerRenderer.js');
        assert.strictEqual(renderer?.requiresMessaging, 'always');
        assert.ok(renderer?.mimeTypes?.some(mime =>
            mime.toLowerCase() === 'application/vnd.positron.dataexplorer+json',
        ));
        assert.ok(fs.existsSync(path.join(
            path.resolve(__dirname, '../../..'),
            'notebook/inlineDataExplorerRenderer.js',
        )));

        const commands = new Set((packageJson.contributes?.commands ?? []).map(entry => entry.command));
        assert.ok(commands.has('supervisor.connections.refresh'));
        assert.ok(commands.has('supervisor.connections.disconnect'));
        assert.ok(commands.has('supervisor.connections.preview'));
        const explorationViews = packageJson.contributes?.views?.['supervisor-sidebar-exploration'] ?? [];
        assert.ok(explorationViews.some(view => view.id === 'supervisor.connections'));
        const connectionsWelcome = packageJson.contributes?.viewsWelcome?.find(
            welcome => welcome.view === 'supervisor.connections',
        );
        assert.match(connectionsWelcome?.contents ?? '', /No database connections are currently active/);
        assert.match(connectionsWelcome?.contents ?? '', /supervisor\.connections\.refresh/);
    });
});
