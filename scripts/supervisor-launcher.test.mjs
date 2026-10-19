import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const { leaseExpired, shutdownServer } = require('../resources/supervisor-launcher.cjs');
const root = fileURLToPath(new URL('../', import.meta.url));

async function until(predicate, timeout = 10_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        if (predicate()) { return; }
        await delay(30);
    }
    assert.fail('Timed out waiting for launcher lifecycle');
}

function running(pid) {
    try {
        if (process.platform === 'linux' && fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(' ')[2] === 'Z') {
            return false;
        }
        process.kill(pid, 0);
        return true;
    } catch { return false; }
}

test('leases allow reload grace, persistent policies and a live paused owner', () => {
    assert.equal(leaseExpired({ keepAlive: false, ownerPid: 0, expiresAt: 100 }, 99), false);
    assert.equal(leaseExpired({ keepAlive: false, ownerPid: 0, expiresAt: 100 }, 100), true);
    assert.equal(leaseExpired({ keepAlive: true, ownerPid: 0, expiresAt: 100 }, 200), false);
    assert.equal(leaseExpired({ keepAlive: false, ownerPid: process.pid, expiresAt: 100 }, 200), false);
});

test('authenticated shutdown uses the configured transport without exposing credentials', async () => {
    const http = await import('node:http');
    const seen = [];
    const server = http.createServer((request, response) => {
        seen.push([request.url, request.method, request.headers.authorization]);
        response.end();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        await shutdownServer({ base_path: `http://127.0.0.1:${server.address().port}`, bearer_token: 'test-only' });
        assert.deepEqual(seen, [['/shutdown', 'POST', 'Bearer test-only']]);
    } finally { await new Promise(resolve => server.close(resolve)); }
});

test('isolated kernels survive a hangup; a replacement lease preserves them and an expired lease reaps the tree', {
    skip: process.platform === 'win32', timeout: 20_000,
}, async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-regression-'));
    const leaseDirectory = path.join(directory, 'lease');
    fs.mkdirSync(leaseDirectory, { mode: 0o700 });
    const leasePath = path.join(leaseDirectory, 'lease.json');
    const pidFile = path.join(directory, 'pids.json');
    const fixture = path.join(directory, "kernel with spaces 'quoted'.cjs");
    fs.writeFileSync(fixture, `
        const fs = require('node:fs');
        const { spawn } = require('node:child_process');
        const kernel = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
        fs.writeFileSync(process.argv[2], JSON.stringify({ server: process.pid, kernel: kernel.pid }));
        setInterval(() => {}, 1000);
    `);
    const writeLease = value => {
        fs.writeFileSync(`${leasePath}.tmp`, JSON.stringify({ version: 1, ownerPid: 0, ...value }), { mode: 0o600 });
        fs.renameSync(`${leasePath}.tmp`, leasePath);
    };
    writeLease({ keepAlive: false, expiresAt: Date.now() + 60_000 });
    const log = fs.openSync(path.join(directory, 'output.log'), 'a');
    const launcher = spawn(process.execPath, [path.join(root, 'resources/supervisor-launcher.cjs'), JSON.stringify({
        leasePath, wrapperPath: path.join(root, 'resources/supervisor-wrapper.sh'),
        outFile: path.join(directory, 'output.log'), args: [process.execPath, fixture, pidFile],
    })], { detached: true, env: { ...process.env, SHELL: '/bin/bash' }, stdio: ['ignore', log, log, 'ipc'] });
    fs.closeSync(log);
    let pids;
    try {
        await until(() => fs.existsSync(pidFile));
        pids = JSON.parse(fs.readFileSync(pidFile, 'utf8'));
        process.kill(-launcher.pid, 'SIGHUP');
        await delay(150);
        assert.ok(running(pids.server));
        assert.ok(running(pids.kernel));
        if (process.platform === 'linux') {
            const group = pid => fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(' ')[4];
            assert.notEqual(group(pids.kernel), String(launcher.pid));
        }
        // A new extension host claims the process before the previous grace
        // period expires. An outdated timestamp is harmless while it is alive.
        writeLease({ keepAlive: false, ownerPid: process.pid, expiresAt: Date.now() - 1 });
        await delay(1200);
        assert.ok(running(pids.kernel));
        writeLease({ keepAlive: true, expiresAt: Date.now() - 1 });
        await delay(1200);
        assert.ok(running(pids.kernel));
        writeLease({ keepAlive: false, expiresAt: Date.now() - 1 });
        await until(() => !running(pids.server) && !running(pids.kernel));
        await until(() => !running(launcher.pid));
        assert.equal(fs.existsSync(leaseDirectory), false);
    } finally {
        if (launcher.connected) { launcher.disconnect(); }
        for (const pid of [pids?.kernel, pids?.server, launcher.pid]) {
            if (pid && running(pid)) { try { process.kill(pid, 'SIGKILL'); } catch { /* already exited */ } }
        }
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
