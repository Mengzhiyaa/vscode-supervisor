import fs from 'fs';
import path from 'path';
import process from 'process';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = path.dirname(repoRoot);
const checkOnly = process.argv.includes('--check');

const kallichoreRoot = path.join(projectRoot, 'kallichore');
const positronSupervisorRoot = path.join(
    projectRoot,
    'positron',
    'extensions',
    'positron-supervisor',
);

const sourceSpec = path.join(kallichoreRoot, 'kallichore.json');
const sourceApi = path.join(positronSupervisorRoot, 'src', 'kcclient', 'api.ts');
const targetSpec = path.join(repoRoot, 'kallichore.json');
const targetApi = path.join(repoRoot, 'src', 'supervisor', 'kcclient', 'api.ts');

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readKallichoreVersion() {
    const cargoToml = fs.readFileSync(
        path.join(kallichoreRoot, 'crates', 'kcserver', 'Cargo.toml'),
        'utf8',
    );
    const match = cargoToml.match(/^version\s*=\s*"([^"]+)"/m);
    if (!match) {
        throw new Error('Could not read the kcserver version from crates/kcserver/Cargo.toml');
    }
    return match[1];
}

function readPinnedVersion(packagePath) {
    const version = readJson(packagePath)?.positron?.binaryDependencies?.kallichore;
    if (!version) {
        throw new Error(`Missing positron.binaryDependencies.kallichore in ${packagePath}`);
    }
    return version;
}

function standaloneApi(source) {
    const rewritten = source.replaceAll("from 'axios';", "from '../httpClient';");

    if (rewritten === source || rewritten.includes("from 'axios'")) {
        throw new Error('Could not rewrite generated Axios imports to the local HTTP compatibility client');
    }
    // OpenAPI Generator currently emits whitespace-only lines and trailing
    // spaces in JSDoc. Normalize those so `git diff --check` remains useful.
    return rewritten.replace(/[ \t]+$/gm, '').replace(/\s+$/, '\n');
}

function syncFile(sourceContent, destination) {
    const current = fs.existsSync(destination) ? fs.readFileSync(destination, 'utf8') : undefined;
    if (current === sourceContent) {
        console.log(`Up to date: ${path.relative(repoRoot, destination)}`);
        return false;
    }
    if (checkOnly) {
        console.error(`Out of date: ${path.relative(repoRoot, destination)}`);
        return true;
    }
    fs.writeFileSync(destination, sourceContent);
    console.log(`Updated: ${path.relative(repoRoot, destination)}`);
    return true;
}

const sourceVersion = readKallichoreVersion();
const standaloneVersion = readPinnedVersion(path.join(repoRoot, 'package.json'));
const positronVersion = readPinnedVersion(path.join(positronSupervisorRoot, 'package.json'));
if (new Set([sourceVersion, standaloneVersion, positronVersion]).size !== 1) {
    throw new Error(
        `Kallichore version mismatch: source=${sourceVersion}, ` +
        `vscode-supervisor=${standaloneVersion}, positron-supervisor=${positronVersion}`,
    );
}

console.log(`Synchronizing Kallichore ${sourceVersion} API`);
const changed = [
    syncFile(fs.readFileSync(sourceSpec, 'utf8'), targetSpec),
    syncFile(standaloneApi(fs.readFileSync(sourceApi, 'utf8')), targetApi),
].some(Boolean);

if (checkOnly && changed) {
    process.exitCode = 1;
}
