import fs from 'fs';
import crypto from 'crypto';
import http from 'http';
import https from 'https';
import os from 'os';
import path from 'path';
import process from 'process';
import { execFileSync, execSync } from 'child_process';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

function parseArgs() {
    let retries = 1;
    let platform;

    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === '--retry') {
            retries = Number.parseInt(args[index + 1] ?? '1', 10) || 1;
            index += 1;
        } else if (arg === '--platform') {
            platform = args[index + 1];
            index += 1;
        }
    }

    return { retries, platform };
}

function normalizeOs(osName) {
    switch (osName) {
        case 'darwin':
        case 'macos':
            return 'darwin';
        case 'win32':
        case 'windows':
            return 'windows';
        default:
            return osName;
    }
}

function normalizeArch(arch) {
    switch (arch) {
        case 'amd64':
        case 'x86_64':
            return 'x64';
        case 'aarch64':
            return 'arm64';
        default:
            return arch;
    }
}

function detectPlatform(explicitPlatform) {
    if (explicitPlatform) {
        return explicitPlatform;
    }

    const targetOs = process.env.TARGET_OS;
    const targetArch = process.env.TARGET_ARCH;
    if (targetOs && targetArch) {
        return `${normalizeOs(targetOs)}-${normalizeArch(targetArch)}`;
    }

    return `${normalizeOs(os.platform())}-${normalizeArch(os.arch())}`;
}

function readKallichoreManifest(platform) {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    const version = pkg?.positron?.binaryDependencies?.kallichore;
    if (!version) {
        throw new Error('Missing positron.binaryDependencies.kallichore in package.json');
    }

    return {
        version,
        checksum: pkg?.positron?.binaryChecksums?.kallichore?.[platform],
    };
}

function verifyChecksum(filePath, expectedDigest) {
    if (!expectedDigest) {
        throw new Error(`Missing checksum for ${path.basename(filePath)}`);
    }

    const [algorithm, expected] = expectedDigest.split(':', 2);
    if (algorithm !== 'sha256' || !expected) {
        throw new Error(`Unsupported checksum '${expectedDigest}' for ${path.basename(filePath)}`);
    }

    const actual = crypto.createHash(algorithm).update(fs.readFileSync(filePath)).digest('hex');
    if (actual !== expected.toLowerCase()) {
        throw new Error(
            `Checksum mismatch for ${path.basename(filePath)}: expected ${expected}, got ${actual}`,
        );
    }

    console.log(`Verified ${algorithm} checksum for ${path.basename(filePath)}`);
}

function binaryName(basePlatform) {
    return basePlatform.startsWith('windows') ? 'kcserver.exe' : 'kcserver';
}

function archiveName(version, basePlatform) {
    return `kallichore-${version}-${basePlatform}.zip`;
}

function download(url, destination) {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(destination);

        const request = (currentUrl, redirectCount) => {
            if (redirectCount > 5) {
                reject(new Error(`Too many redirects for ${url}`));
                return;
            }

            const protocol = currentUrl.startsWith('https') ? https : http;
            protocol.get(currentUrl, (response) => {
                if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                    response.resume();
                    request(response.headers.location, redirectCount + 1);
                    return;
                }

                if (response.statusCode !== 200) {
                    response.resume();
                    reject(new Error(`Download failed for ${currentUrl}: HTTP ${response.statusCode}`));
                    return;
                }

                response.pipe(output);
                output.on('finish', () => {
                    output.close();
                    resolve();
                });
            }).on('error', reject);
        };

        request(url, 0);
    });
}

function extractZip(zipPath, destination) {
    fs.mkdirSync(destination, { recursive: true });
    if (process.platform === 'win32') {
        execSync(
            `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destination}' -Force"`,
            { stdio: 'pipe' },
        );
        return;
    }

    execSync(`unzip -o -q "${zipPath}" -d "${destination}"`, { stdio: 'pipe' });
}

function findFile(rootDir, filename) {
    const entries = fs.readdirSync(rootDir, { withFileTypes: true });
    for (const entry of entries) {
        const entryPath = path.join(rootDir, entry.name);
        if (entry.isFile() && entry.name === filename) {
            return entryPath;
        }

        if (entry.isDirectory()) {
            const nested = findFile(entryPath, filename);
            if (nested) {
                return nested;
            }
        }
    }

    return undefined;
}

async function installKallichore(platform) {
    const { version, checksum } = readKallichoreManifest(platform);
    const executableName = binaryName(platform);
    const archiveFile = archiveName(version, platform);
    const downloadUrl = `https://github.com/posit-dev/kallichore-builds/releases/download/${version}/${archiveFile}`;
    const installDir = path.join(repoRoot, 'resources', 'kallichore');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-supervisor-binary-'));

    try {
        const archivePath = path.join(tempDir, archiveFile);
        const extractDir = path.join(tempDir, 'extract');

        console.log(`Installing kallichore ${version} for ${platform}`);
        console.log(`Downloading ${downloadUrl}`);
        await download(downloadUrl, archivePath);
        verifyChecksum(archivePath, checksum);
        extractZip(archivePath, extractDir);

        const extractedBinary = findFile(extractDir, executableName);
        if (!extractedBinary) {
            throw new Error(`Could not find ${executableName} in extracted archive`);
        }

        fs.mkdirSync(installDir, { recursive: true });
        const destination = path.join(installDir, executableName);
		const staged = path.join(
			installDir,
			`.install-${process.pid}-${Date.now()}-${executableName}`,
		);
		let reportedVersion;
		try {
			fs.copyFileSync(extractedBinary, staged);
			if (process.platform !== 'win32') {
				fs.chmodSync(staged, 0o755);
			}

			reportedVersion = execFileSync(staged, ['--version'], {
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'pipe'],
			}).trim();
			const parsedVersion = reportedVersion.match(
				/\b(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/,
			)?.[1];
			if (parsedVersion !== version) {
				throw new Error(
					`Downloaded binary reported '${reportedVersion || 'unknown'}'; expected ${version}`,
				);
			}

			if (process.platform === 'win32' && fs.existsSync(destination)) {
				fs.unlinkSync(destination);
			}
			fs.renameSync(staged, destination);
		} finally {
			fs.rmSync(staged, { force: true });
		}

        console.log(`Installed ${destination} (${reportedVersion})`);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

async function main() {
    const { retries, platform: explicitPlatform } = parseArgs();
    const platform = detectPlatform(explicitPlatform);

    let lastError;
    for (let attempt = 1; attempt <= retries; attempt += 1) {
        try {
            await installKallichore(platform);
            return;
        } catch (error) {
            lastError = error;
            console.error(`Attempt ${attempt}/${retries} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    throw lastError;
}

await main();
