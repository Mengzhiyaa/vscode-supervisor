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
    l10n?: string;
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
        colors?: Array<{
            id?: string;
            description?: string;
            defaults?: {
                light?: string;
                dark?: string;
                highContrast?: string;
                highContrastLight?: string;
            };
        }>;
        commands?: Array<{ command?: string }>;
        keybindings?: Array<{
            command?: string;
            key?: string;
            mac?: string;
            when?: string;
        }>;
        notebookRenderer?: Array<{
            id?: string;
            entrypoint?: string;
            requiresMessaging?: string;
            mimeTypes?: string[];
        }>;
        configuration?: {
            properties?: Record<string, {
                default?: unknown;
                enum?: unknown[];
                scope?: string;
                description?: string;
            }>;
        };
        viewsContainers?: Record<string, Array<{
            id?: string;
            title?: string;
            icon?: string;
            when?: string;
        }>>;
        views?: Record<string, Array<{
            id?: string;
            name?: string;
            when?: string;
        }>>;
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
        assert.strictEqual(packageJson.l10n, './l10n');
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
        assert.strictEqual(packageJson.scripts?.['test:binaries'], 'node --test scripts/install-binaries.test.mjs');
        assert.strictEqual(packageJson.scripts?.['sync:kallichore-api'], 'node scripts/sync-kallichore-api.mjs');
        assert.strictEqual(packageJson.scripts?.['verify:kallichore-api'], 'node scripts/sync-kallichore-api.mjs --check');
        assert.strictEqual(packageJson.scripts?.['sync:webview-rpc-contracts'], 'node scripts/sync-webview-rpc-contracts.mjs');
        assert.strictEqual(packageJson.scripts?.['verify:webview-rpc-contracts'], 'node scripts/sync-webview-rpc-contracts.mjs --check');
        assert.strictEqual(packageJson.scripts?.['sync:positron-contracts'], 'node scripts/sync-positron-contracts.mjs');
        assert.strictEqual(packageJson.scripts?.['verify:positron-contracts'], 'node scripts/sync-positron-contracts.mjs --check');
        assert.strictEqual(
            packageJson.scripts?.['verify:contracts'],
            'npm run verify:api-dts && npm run verify:webview-rpc-contracts && npm run verify:positron-contracts && npm run verify:data-explorer-localization',
        );
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
        assert.ok(commands.has('supervisor.dataExplorer.openAsSpreadsheet'));
        assert.ok(commands.has('supervisor.dataExplorer.selectWorksheet'));
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
        assert.ok(fs.existsSync(path.join(path.resolve(__dirname, '../../..'), 'package.nls.json')));
        assert.ok(fs.existsSync(path.join(path.resolve(__dirname, '../../..'), 'package.nls.zh-cn.json')));
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

    test('contributes rebindable Console find commands and default keys', () => {
        const packageJson = readPackageJson();
        const commands = new Set(
            (packageJson.contributes?.commands ?? []).map(entry => entry.command),
        );
        for (const command of [
            'supervisor.console.find',
            'supervisor.console.findNext',
            'supervisor.console.findPrevious',
            'supervisor.console.findClose',
        ]) {
            assert.ok(commands.has(command), `Expected ${command} command contribution`);
        }

        const keybindings = packageJson.contributes?.keybindings ?? [];
        assert.ok(keybindings.some(binding =>
            binding.command === 'supervisor.console.findNext' &&
            binding.key === 'f3' &&
            binding.mac === 'cmd+g'
        ));
        assert.ok(keybindings.some(binding =>
            binding.command === 'supervisor.console.findPrevious' &&
            binding.key === 'shift+f3' &&
            binding.mac === 'cmd+shift+g'
        ));
    });

    test('contributes rebindable Variables focus and list commands', () => {
        const packageJson = readPackageJson();
        const commands = new Set(
            (packageJson.contributes?.commands ?? []).map(entry => entry.command),
        );
        for (const command of [
            'supervisor.variables.focus',
            'supervisor.variables.expand',
            'supervisor.variables.collapse',
            'supervisor.variables.copyAsText',
            'supervisor.variables.copyAsHtml',
        ]) {
            assert.ok(commands.has(command), `Expected ${command} command contribution`);
        }

        const keybindings = packageJson.contributes?.keybindings ?? [];
        assert.ok(keybindings.some(binding =>
            binding.command === 'supervisor.variables.focus' &&
            binding.key === 'ctrl+k ctrl+v' &&
            binding.mac === 'cmd+k cmd+v'
        ));
        for (const [command, key, mac] of [
            ['supervisor.variables.expand', 'right', undefined],
            ['supervisor.variables.collapse', 'left', undefined],
            ['supervisor.variables.copyAsText', 'ctrl+c', 'cmd+c'],
            ['supervisor.variables.copyAsHtml', 'ctrl+shift+c', 'cmd+shift+c'],
        ]) {
            assert.ok(keybindings.some(binding =>
                binding.command === command &&
                binding.key === key &&
                binding.mac === mac &&
                binding.when === 'supervisor.variablesFocused && supervisor.variablesHasSelection'
            ));
        }
    });

    test('contributes the P0 plots contract and opt-in runtime diagnostics view', () => {
        const packageJson = readPackageJson();
        const properties = packageJson.contributes?.configuration?.properties ?? {};
        assert.strictEqual(properties['plots.defaultSizingPolicy']?.default, 'auto');
        assert.deepStrictEqual(properties['plots.historyPolicy']?.enum, ['auto', 'always', 'never']);
        assert.deepStrictEqual(properties['plots.darkFilter']?.enum, ['auto', 'on', 'off']);
        assert.strictEqual(properties['plots.darkFilterMode'], undefined);
        assert.strictEqual(properties['interpreters.showSessions']?.default, false);
        assert.strictEqual(properties['interpreters.showSessions']?.scope, 'machine');
        assert.strictEqual(
            properties['supervisor.interpreters.startupBehavior']?.default,
            'manual',
        );
        assert.strictEqual(
            properties['kernelSupervisor.shutdownTimeout']?.default,
            'immediately',
        );

        const commands = new Set((packageJson.contributes?.commands ?? []).map(entry => entry.command));
        assert.ok(commands.has('supervisor.runtimeSessions.refresh'));
        const runtimeContainers = packageJson.contributes?.viewsContainers?.activitybar ?? [];
        assert.deepStrictEqual(
            runtimeContainers.find(container => container.id === 'supervisor-runtimes'),
            {
                id: 'supervisor-runtimes',
                title: 'Runtimes',
                icon: '$(versions)',
                when: 'config.interpreters.showSessions',
            },
        );
        const runtimeViews = packageJson.contributes?.views?.['supervisor-runtimes'] ?? [];
        assert.deepStrictEqual(
            runtimeViews.find(view => view.id === 'supervisor.runtimeSessions'),
            {
                name: 'Sessions',
                id: 'supervisor.runtimeSessions',
                icon: '$(versions)',
                when: 'config.interpreters.showSessions',
            },
        );
        const sessionViews = packageJson.contributes?.views?.['supervisor-session'] ?? [];
        assert.ok(!sessionViews.some(view => view.id === 'supervisor.runtimeSessions'));
    });

    test('projects the Positron view-container boundaries onto standard VS Code', () => {
        const packageJson = readPackageJson();
        const containers = packageJson.contributes?.viewsContainers ?? {};

        assert.deepStrictEqual(
            (containers.panel ?? []).map(container => container.id),
            ['supervisor-console-panel'],
        );
        assert.deepStrictEqual(
            (containers.activitybar ?? []).map(container => container.id),
            [
                'supervisor-packages',
                'supervisor-session',
                'supervisor-connections',
                'supervisor-help',
                'supervisor-viewer',
                'supervisor-runtimes',
            ],
        );
        assert.strictEqual(
            containers.auxiliarybar,
            undefined,
            'Standard VS Code does not support extension-contributed auxiliary bar containers',
        );

        assert.deepStrictEqual(
            (packageJson.contributes?.views?.['supervisor-session'] ?? []).map(view => view.id),
            ['supervisor.variables', 'supervisor.plots'],
        );
        assert.deepStrictEqual(
            (packageJson.contributes?.views?.['supervisor-packages'] ?? []).map(view => view.id),
            ['supervisor.packages'],
        );
        assert.deepStrictEqual(
            (packageJson.contributes?.views?.['supervisor-connections'] ?? []).map(view => view.id),
            ['supervisor.connections'],
        );
        assert.deepStrictEqual(
            (packageJson.contributes?.views?.['supervisor-help'] ?? []).map(view => view.id),
            ['supervisor.help'],
        );
        assert.deepStrictEqual(
            (packageJson.contributes?.views?.['supervisor-viewer'] ?? []).map(view => view.id),
            ['supervisor.viewer'],
        );
    });

    test('contributes surface-neutral console and runtime status colors', () => {
        const packageJson = readPackageJson();
        const colors = new Map(
            (packageJson.contributes?.colors ?? []).map(color => [color.id, color]),
        );

        assert.deepStrictEqual(
            colors.get('supervisor.console.executingIndicator')?.defaults,
            {
                light: '#2EB77C',
                dark: '#2EB77C',
                highContrast: '#2EB77C',
                highContrastLight: '#2EB77C',
            },
        );
        assert.deepStrictEqual(
            colors.get('supervisor.runtime.stateIconActive')?.defaults,
            {
                light: '#3A79B2',
                dark: '#AFCBE9',
                highContrast: '#AFCBE9',
                highContrastLight: '#3A79B2',
            },
        );
        assert.ok(colors.has('supervisor.runtime.stateIconDisconnected'));
        assert.ok(colors.has('supervisor.runtime.stateIconIdle'));

        const consoleStyles = readRepoFile('webview/src/console/styles.css');
        const activityInput = readRepoFile('webview/src/console/ActivityInput.svelte');
        const consoleTypes = readRepoFile('webview/src/types/console.ts');
        assert.match(consoleStyles, /--vscode-supervisor-console-executingIndicator/);
        assert.match(consoleStyles, /--vscode-positronRuntime-stateIconActive/);
        assert.match(activityInput, /--supervisor-console-executing-indicator/);
        assert.match(consoleTypes, /--supervisor-runtime-state-icon-active/);
        assert.doesNotMatch(consoleTypes, /--vscode-positronConsole-stateIcon/);
    });

    test('uses Monaco 0.56 public entrypoints and loads its shared styles', () => {
        const webviewPackageJson = JSON.parse(
            readRepoFile('webview/package.json'),
        ) as { dependencies?: Record<string, string> };
        assert.strictEqual(
            webviewPackageJson.dependencies?.['monaco-editor'],
            '^0.56.0',
        );

        const setup = readRepoFile('webview/src/lib/monaco/setup.ts');
        const colorizer = readRepoFile(
            'webview/src/lib/monaco/activityInputColorizer.ts',
        );
        const consoleStyles = readRepoFile('webview/src/console/styles.css');
        const viteConfig = readRepoFile('webview/vite.config.ts');
        const consoleProvider = readRepoFile('src/webview/consoleProvider.ts');
        const dataExplorerProvider = readRepoFile(
            'src/services/dataExplorer/positronDataExplorerEditorProvider.ts',
        );

        assert.match(setup, /from "monaco-editor\/editor"/);
        assert.match(setup, /"monaco-editor\/features\/register\.all"/);
        assert.match(
            setup,
            /"monaco-editor\/languages\/definitions\/r\/register"/,
        );
        assert.match(
            setup,
            /"monaco-editor\/languages\/definitions\/python\/register"/,
        );
        assert.match(
            setup,
            /"monaco-editor\/editor\/editor\.worker\?worker&url"/,
        );
        assert.match(colorizer, /monaco\.editor\.colorize/);

        for (const source of [setup, consoleStyles, viteConfig]) {
            assert.doesNotMatch(
                source,
                /monaco-editor\/(?:min|esm)\//,
            );
            assert.doesNotMatch(source, /edcore\.main/);
        }

        assert.match(consoleProvider, /'setup', 'index\.css'/);
        assert.match(
            dataExplorerProvider,
            /'setup',[\s\S]{0,80}'index\.css'/,
        );
        assert.ok(fs.existsSync(path.join(
            path.resolve(__dirname, '../../..'),
            'webview/dist/setup/index.css',
        )));
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
        const connectionViews = packageJson.contributes?.views?.['supervisor-connections'] ?? [];
        assert.ok(connectionViews.some(view => view.id === 'supervisor.connections'));
        const connectionsWelcome = packageJson.contributes?.viewsWelcome?.find(
            welcome => welcome.view === 'supervisor.connections',
        );
        assert.match(connectionsWelcome?.contents ?? '', /No database connections are currently active/);
        assert.match(connectionsWelcome?.contents ?? '', /supervisor\.connections\.refresh/);
    });
});
