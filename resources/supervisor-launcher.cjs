// Runs independently of the extension host and terminal. Do not put connection
// credentials in its arguments, logs or lease file.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const { spawn } = require('node:child_process');

function readLease(leasePath) {
    const value = JSON.parse(fs.readFileSync(leasePath, 'utf8'));
    if (value.version !== 1 || !Number.isSafeInteger(value.ownerPid) || value.ownerPid < 0 ||
        !Number.isFinite(value.expiresAt) || typeof value.keepAlive !== 'boolean') {
        throw new Error('Invalid supervisor lease');
    }
    return value;
}

function ownerIsRunning(pid) {
    if (pid < 1) { return false; }
    try { process.kill(pid, 0); return true; }
    catch (error) { return error.code === 'EPERM'; }
}

function leaseExpired(lease, now = Date.now()) {
    return !lease.keepAlive && now >= lease.expiresAt && !ownerIsRunning(lease.ownerPid);
}

function shutdownServer(state) {
    return new Promise(resolve => {
        const target = state.socket_path || state.named_pipe;
        const url = target ? undefined : new URL(`${state.base_path.replace(/\/$/, '')}/shutdown`);
        const transport = url?.protocol === 'https:' ? https : http;
        const request = transport.request(target ? {
            socketPath: target, path: '/shutdown', method: 'POST',
            headers: { Authorization: `Bearer ${state.bearer_token}` },
        } : {
            protocol: url.protocol, hostname: url.hostname, port: url.port,
            path: url.pathname, method: 'POST',
            headers: { Authorization: `Bearer ${state.bearer_token}` },
        }, response => { response.resume(); response.on('end', resolve); });
        request.setTimeout(2000, () => request.destroy());
        request.on('error', resolve);
        request.end();
    });
}

async function run(config) {
    let lease = readLease(config.leasePath);
    let state;
    let stopping = false;
    const environment = { ...process.env };
    delete environment.ELECTRON_RUN_AS_NODE;
    // The Unix wrapper retains login-shell environment initialization. Its
    // whole process group is isolated from both the launcher and any old pty.
    const child = process.platform === 'win32'
        ? spawn(config.args[0], config.args.slice(1), {
            detached: true, windowsHide: true, env: environment, stdio: ['ignore', 1, 2],
        })
        : spawn(config.wrapperPath, [config.outFile, ...config.args], {
            detached: true, env: environment, stdio: ['ignore', 1, 2],
        });

    const cleanup = () => {
        clearInterval(timer);
        fs.rmSync(path.dirname(config.leasePath), { recursive: true, force: true });
        process.exit(0);
    };
    const killTree = () => {
        if (!child.pid) { return; }
        if (process.platform === 'win32') {
            const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
                windowsHide: true, stdio: 'ignore',
            });
            killer.on('error', cleanup);
            killer.on('exit', cleanup);
        } else {
            try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already exited */ }
            cleanup();
        }
    };
    const stop = async () => {
        if (stopping) { return; }
        stopping = true;
        // Give Kallichore a chance to close every kernel before a bounded
        // process-group cleanup, including unresponsive descendants.
        child.removeAllListeners('exit');
        if (state) { await shutdownServer(state); }
        const deadline = setTimeout(killTree, 3000);
        // Keep the fallback active even if the wrapper exits before its children.
        deadline.ref();
    };
    process.on('message', message => {
        if (message.kind === 'connection') { state = message.state; }
        if (message.kind === 'stop') { void stop(); }
    });
    process.on('SIGTERM', () => { void stop(); });
    process.on('SIGHUP', () => { /* Old terminals must not end this server. */ });
    child.on('error', error => { console.error(`Supervisor launch failed: ${error.message}`); cleanup(); });
    child.on('exit', cleanup);
    const timer = setInterval(() => {
        try { lease = readLease(config.leasePath); }
        catch { /* An unavailable lease cannot extend the last valid expiry. */ }
        if (leaseExpired(lease)) { void stop(); }
    }, 1000);
}

module.exports = { readLease, leaseExpired, shutdownServer };
if (require.main === module) {
    run(JSON.parse(process.argv[2])).catch(error => {
        console.error(`Supervisor launcher failed: ${error.message}`);
        process.exit(1);
    });
}
