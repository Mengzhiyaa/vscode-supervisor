/**
 * Binary Manager — Runtime auto-download for universal VSIX installs.
 *
 * On extension activation, checks whether core and language-provided binaries
 * are available. If missing, downloads them from GitHub Releases with a VS
 * Code progress notification.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { execFileSync, execSync } from 'child_process';
import * as vscode from 'vscode';
import { type BinaryDefinition, type IBinaryProvider } from './api';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BINARY_VERSION_STATE_KEY = 'supervisor.binaryManager.installedVersions';
const DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_REDIRECTS = 3;

const isWindows = os.platform() === 'win32';

class DownloadTimeoutError extends Error {
    constructor(
        public readonly url: string,
        public readonly timeoutMs: number,
    ) {
        super(`Download timed out after ${Math.floor(timeoutMs / 1000)}s for ${url}`);
        this.name = 'DownloadTimeoutError';
    }
}

interface BinaryDownloadInfo {
    platform: string;
    archiveFile: string;
    downloadUrl: string;
    installDir: string;
    destPath: string;
}

interface ResolvedBinaryDefinition {
    definition: BinaryDefinition;
    version?: string;
}

function resolveInstallDir(
    extensionPath: string,
    installDir: string,
): string {
    return path.isAbsolute(installDir)
        ? installDir
        : path.join(extensionPath, installDir);
}

function getBundledBinaryVersions(extensionPath: string): Record<string, string> {
    const pkgPath = path.join(extensionPath, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const deps = pkg?.positron?.binaryDependencies;
    if (!deps) {
        throw new Error('Could not find positron.binaryDependencies in package.json');
    }
    return deps as Record<string, string>;
}

function getBinaryDefs(
    extensionPath: string,
    binaryProviders: ReadonlyArray<IBinaryProvider>,
): Record<string, ResolvedBinaryDefinition> {
    const bundledVersions = getBundledBinaryVersions(extensionPath);
    const defs: Record<string, ResolvedBinaryDefinition> = {
        kallichore: {
            definition: {
                repo: 'posit-dev/kallichore-builds',
                binaryName: isWindows ? 'kcserver.exe' : 'kcserver',
                archivePattern: (version, platform) => `kallichore-${version}-${platform}.zip`,
                installDir: 'resources/kallichore',
            },
            version: bundledVersions.kallichore,
        },
    };

    for (const provider of binaryProviders) {
        for (const [name, definition] of Object.entries(provider.getBinaryDefinitions())) {
            defs[name] = {
                definition,
                version: definition.version ?? bundledVersions[name],
            };
        }
    }

    return defs;
}

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

function detectPlatform(): string {
    const platformMap: Record<string, string> = {
        darwin: 'darwin',
        linux: 'linux',
        win32: 'windows',
    };
    const archMap: Record<string, string> = {
        x64: 'x64',
        arm64: 'arm64',
    };

    const p = platformMap[os.platform()];
    const a = archMap[os.arch()];

    if (!p || !a) {
        throw new Error(`Unsupported platform: ${os.platform()}-${os.arch()}`);
    }

    return `${p}-${a}`;
}

function getDownloadInfo(
    def: BinaryDefinition,
    version: string,
    basePlatform: string,
    extensionPath: string,
): BinaryDownloadInfo {
    const platform = def.platformOverride ? def.platformOverride(basePlatform) : basePlatform;
    const archiveFile = def.archivePattern(version, platform);
    const downloadUrl = `https://github.com/${def.repo}/releases/download/${version}/${archiveFile}`;
    const installDir = resolveInstallDir(extensionPath, def.installDir);
    const destPath = path.join(installDir, def.binaryName);

    return { platform, archiveFile, downloadUrl, installDir, destPath };
}

// ---------------------------------------------------------------------------
// Download with redirect following
// ---------------------------------------------------------------------------

function download(
    url: string,
    destPath: string,
    timeoutMs: number,
    onProgress?: (bytes: number) => void,
): Promise<void> {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destPath);
        let settled = false;
        let currentUrl = url;
        let activeRequest: http.ClientRequest | undefined;

        const finish = () => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timeoutHandle);
            resolve();
        };

        const fail = (err: Error) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timeoutHandle);
            activeRequest?.destroy();
            file.destroy();
            fs.unlink(destPath, () => {
                reject(err);
            });
        };

        const timeoutHandle = setTimeout(() => {
            fail(new DownloadTimeoutError(currentUrl, timeoutMs));
        }, timeoutMs);

        file.on('finish', () => {
            file.close();
            finish();
        });

        file.on('error', (err) => {
            fail(err);
        });

        const request = (nextUrl: string, redirectCount: number) => {
            if (settled) {
                return;
            }
            if (redirectCount > MAX_REDIRECTS) {
                fail(new Error('Too many redirects'));
                return;
            }

            currentUrl = nextUrl;
            const proto = nextUrl.startsWith('https') ? https : http;
            const requestRef = proto.get(nextUrl, (response) => {
                if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                    response.resume();
                    request(response.headers.location, redirectCount + 1);
                    return;
                }

                if (response.statusCode && response.statusCode !== 200) {
                    response.resume();
                    fail(new Error(`Download failed: HTTP ${response.statusCode} for ${currentUrl}`));
                    return;
                }

                let downloaded = 0;
                response.on('data', (chunk: Buffer) => {
                    downloaded += chunk.length;
                    onProgress?.(downloaded);
                });

                response.on('error', (err) => {
                    fail(err instanceof Error ? err : new Error(String(err)));
                });

                response.pipe(file);
            });

            activeRequest = requestRef;
            requestRef.on('error', (err) => {
                fail(err instanceof Error ? err : new Error(String(err)));
            });
        };

        request(url, 0);
    });
}

// ---------------------------------------------------------------------------
// Extract zip
// ---------------------------------------------------------------------------

function extractZip(zipPath: string, destDir: string): void {
    fs.mkdirSync(destDir, { recursive: true });

    if (isWindows) {
        execSync(
            `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`,
            { stdio: 'pipe' }
        );
    } else {
        execSync(`unzip -o -q "${zipPath}" -d "${destDir}"`, { stdio: 'pipe' });
    }
}

// ---------------------------------------------------------------------------
// Find binary in extracted directory
// ---------------------------------------------------------------------------

function findBinary(dir: string, binaryName: string): string | null {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isFile() && entry.name === binaryName) {
            return fullPath;
        }
        if (entry.isDirectory()) {
            const found = findBinary(fullPath, binaryName);
            if (found) { return found; }
        }
    }

    return null;
}

function resolveInstalledVersion(binaryPath: string): string | undefined {
    try {
        const stdout = execFileSync(binaryPath, ['--version'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 5000,
            windowsHide: true,
        });

        const output = stdout.trim();
        if (!output) {
            return undefined;
        }

        // Handles outputs like "Ark 0.1.227" or "kcserver 0.1.63".
        const match = output.match(/\b(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/);
        return match?.[1];
    } catch {
        return undefined;
    }
}

// ---------------------------------------------------------------------------
// Install a single binary
// ---------------------------------------------------------------------------

async function installBinary(
    name: string,
    def: BinaryDefinition,
    version: string,
    basePlatform: string,
    extensionPath: string,
    log: vscode.LogOutputChannel,
    progress: vscode.Progress<{ message?: string; increment?: number }>,
): Promise<void> {
    const downloadInfo = getDownloadInfo(def, version, basePlatform, extensionPath);
    const { platform, archiveFile, downloadUrl, installDir, destPath } = downloadInfo;

    log.info(`[BinaryManager] Downloading ${name} v${version} (${platform})...`);
    progress.report({ message: `Downloading ${name} v${version}...` });

    fs.mkdirSync(installDir, { recursive: true });

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-install-`));

    try {
        const zipPath = path.join(tmpDir, archiveFile);

        // Download
        await download(downloadUrl, zipPath, DOWNLOAD_TIMEOUT_MS, (bytes) => {
            progress.report({ message: `Downloading ${name}... ${(bytes / 1024 / 1024).toFixed(1)} MB` });
        });

        // Extract
        progress.report({ message: `Extracting ${name}...` });
        const extractDir = path.join(tmpDir, 'extracted');
        extractZip(zipPath, extractDir);

        // Find binary
        const binaryPath = findBinary(extractDir, def.binaryName);
        if (!binaryPath) {
            throw new Error(`Could not find ${def.binaryName} in downloaded archive for ${name}`);
        }

        // Copy to install location
        fs.copyFileSync(binaryPath, destPath);

        if (!isWindows) {
            fs.chmodSync(destPath, 0o755);
        }

        const size = (fs.statSync(destPath).size / 1024 / 1024).toFixed(2);
        log.info(`[BinaryManager] ✅ Installed ${name} v${version} (${size} MB) → ${destPath}`);

    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Ensures that core and language-provided binaries are available.
 *
 * - If binaries already exist (platform-specific VSIX), returns immediately.
 * - If any binaries are missing (universal VSIX), downloads them from GitHub
 *   Releases with a progress notification.
 *
 * This should be called early in `activate()`, before the session manager or
 * runtime discovery attempts to use the binaries.
 */
export async function ensureBinaries(
    context: vscode.ExtensionContext,
    log: vscode.LogOutputChannel,
    binaryProviders: ReadonlyArray<IBinaryProvider> = [],
): Promise<void> {
    const defs = getBinaryDefs(context.extensionPath, binaryProviders);
    const platform = detectPlatform();

    // Check which binaries are missing
    const missing: string[] = [];
    const installedVersions = context.globalState.get<Record<string, string>>(BINARY_VERSION_STATE_KEY, {});
    let installedVersionsChanged = false;

    for (const [name, resolvedDef] of Object.entries(defs)) {
        const { definition: def, version: expectedVersion } = resolvedDef;
        const binaryPath = path.join(
            resolveInstallDir(context.extensionPath, def.installDir),
            def.binaryName,
        );

        if (!fs.existsSync(binaryPath)) {
            missing.push(name);
            log.info(`[BinaryManager] ${name} binary not found at ${binaryPath}`);
            continue;
        }

        const detectedVersion = resolveInstalledVersion(binaryPath);
        let installedVersion = detectedVersion ?? installedVersions[name];

        if (detectedVersion && installedVersions[name] !== detectedVersion) {
            installedVersions[name] = detectedVersion;
            installedVersionsChanged = true;
        }

        if (!installedVersion && expectedVersion) {
            // Some environments may block spawning binaries during activation.
            // If the file exists but version probing fails, assume bundled version
            // to avoid a perpetual download loop.
            installedVersion = expectedVersion;
            installedVersions[name] = expectedVersion;
            installedVersionsChanged = true;
            log.debug(`[BinaryManager] ${name} version probe failed; assuming expected=${expectedVersion}`);
        }

        if (expectedVersion && installedVersion !== expectedVersion) {
            // Binary exists but version mismatch — log but do NOT re-download.
            // The existing binary is functional; forcing a download risks 404s
            // when the expected release has not been published yet.
            log.info(`[BinaryManager] ${name} version mismatch: installed=${installedVersion ?? 'unknown'}, expected=${expectedVersion} (keeping existing)`);
        }
    }

    if (missing.length === 0) {
        if (installedVersionsChanged) {
            await context.globalState.update(BINARY_VERSION_STATE_KEY, installedVersions);
        }
        log.debug('[BinaryManager] All binaries present, skipping download');
        return;
    }

    log.info(`[BinaryManager] Missing binaries: ${missing.join(', ')}. Starting download...`);

    // Download with progress notification
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Ark: Installing binaries',
            cancellable: false,
        },
        async (progress) => {
            for (const name of missing) {
                const resolvedDef = defs[name];
                const { definition: def, version } = resolvedDef;

                if (!version) {
                    log.warn(`[BinaryManager] No version found for ${name}, skipping`);
                    continue;
                }

                const downloadInfo = getDownloadInfo(def, version, platform, context.extensionPath);

                try {
                    await installBinary(name, def, version, platform, context.extensionPath, log, progress);

                    // Update version cache
                    installedVersions[name] = version;
                    installedVersionsChanged = true;
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    log.error(`[BinaryManager] Failed to install ${name}: ${message}`);

                    if (err instanceof DownloadTimeoutError) {
                        const timeoutSeconds = Math.floor(DOWNLOAD_TIMEOUT_MS / 1000);
                        const manualHint = [
                            `[BinaryManager] ${name} download timed out after ${timeoutSeconds}s.`,
                            `[BinaryManager] Manual download URL: ${downloadInfo.downloadUrl}`,
                            `[BinaryManager] Save extracted binary to: ${downloadInfo.destPath}`,
                            `[BinaryManager] Ensure directory exists: ${downloadInfo.installDir}`,
                        ].join('\n');

                        log.error(manualHint);

                        void vscode.window.showErrorMessage(
                            `${name} download timed out after ${timeoutSeconds}s. ` +
                            `Download from ${downloadInfo.downloadUrl}, extract ${def.binaryName}, and place it at ${downloadInfo.destPath}.`
                        );
                        continue;
                    }

                    void vscode.window.showErrorMessage(
                        `Failed to download ${name} binary: ${message}. ` +
                        `You can set the binary path manually in settings or run 'npm run install:binaries'.`
                    );
                }
            }

            // Persist installed versions
            if (installedVersionsChanged) {
                await context.globalState.update(BINARY_VERSION_STATE_KEY, installedVersions);
            }

            progress.report({ message: 'Done!' });
        }
    );
}
