import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'path';

export default defineConfig(({ mode }) => ({
    plugins: [svelte()],
    base: './', // Use relative paths for VSCode webview compatibility
    server: {
        host: '0.0.0.0',
        port: 5173,
        strictPort: true
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        sourcemap: mode === 'development',
        assetsInlineLimit: 4096, // Default Vite limit; fonts are emitted as shared external assets
        rollupOptions: {
            input: {
                // Host HTML loads shared icons and toolbar/menu styles once.
                common: resolve(__dirname, 'src/shared/common.css'),
                console: resolve(__dirname, 'src/console/main.ts'),
                variables: resolve(__dirname, 'src/variables/main.ts'),
                plots: resolve(__dirname, 'src/plots/main.ts'),
                plotEditor: resolve(__dirname, 'src/plotEditor/main.ts'),
                packages: resolve(__dirname, 'src/packages/main.ts'),
                viewer: resolve(__dirname, 'src/viewer/main.ts'),
                help: resolve(__dirname, 'src/help/main.ts'),
                dataExplorer: resolve(__dirname, 'src/dataExplorer/main.ts'),
            },
            output: {
                // Keep Monaco CSS at setup/index.css, which Host HTML loads explicitly.
                // Feature pruning must not split core styles into an unlinked editor CSS.
                codeSplitting: {
                    groups: [{
                        name: 'setup',
                        test: /(?:node_modules[\\/]monaco-editor[\\/]|src[\\/]lib[\\/]monaco[\\/]setup\.ts$)/,
                    }],
                },
                entryFileNames: '[name]/index.js',
                chunkFileNames: 'shared/[name]-[hash].js',
                assetFileNames: (assetInfo) => {
                    // Put CSS files next to their JS entry points
                    if (assetInfo.name?.endsWith('.css')) {
                        return '[name]/index.css';
                    }
                    return 'assets/[name]-[hash][extname]';
                }
            }
        },
        // Enable minification in production mode
        minify: mode === 'production' ? 'esbuild' : false
    },
    // Resolve aliases
    resolve: {
        alias: {
            '$lib': resolve(__dirname, 'src/lib'),
            '@shared': resolve(__dirname, '..', 'src', 'shared')
        }
    },
    // Optimize deps for Monaco and TextMate integration
    optimizeDeps: {
        include: [
            'monaco-editor/editor',
            'monaco-editor/languages/definitions/r/register',
            'monaco-editor/languages/definitions/python/register',
            'vscode-textmate',
            'vscode-oniguruma'
        ]
    },
    // Ensure .wasm files are treated as assets
    assetsInclude: ['**/*.wasm']
}));
