import { defineConfig } from '@vscode/test-cli';

const mocha = {
    ui: 'tdd',
    require: './out/test/mocha-setup.js',
    timeout: 60000,
};

export default defineConfig([
    {
        label: 'all',
        files: 'out/test/**/*.test.js',
        mocha,
    },
    {
        label: 'unit',
        files: 'out/test/unit/**/*.test.js',
        mocha,
    },
]);
