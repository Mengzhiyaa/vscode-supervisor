import * as assert from 'assert';
import * as vscode from 'vscode';
import { RuntimeState } from '../../internal/runtimeTypes';
import type { RuntimeClientManager } from '../../runtime/runtimeClientManager';
import type { RuntimeSession } from '../../runtime/session';
import { DataExplorerRuntime } from '../../services/dataExplorer/dataExplorerRuntime';
import {
    PositronDataExplorerService,
    type IPositronDataExplorerService,
} from '../../services/dataExplorer/positronDataExplorerService';
import type { RuntimeSessionService } from '../../runtime/runtimeSession';

function createClientManager() {
    let registrations = 0;
    let disposals = 0;
    const manager = {
        clientInstances: [],
        registerClientHandler: () => {
            registrations += 1;
            let disposed = false;
            return {
                dispose: () => {
                    if (!disposed) {
                        disposed = true;
                        disposals += 1;
                    }
                },
            };
        },
    } as unknown as RuntimeClientManager;
    return {
        manager,
        get registrations() { return registrations; },
        get disposals() { return disposals; },
    };
}

suite('[Unit] Data Explorer runtime reattach', () => {
    test('re-registers the handler for a replacement manager and after exit', () => {
        const managerA = createClientManager();
        const managerB = createClientManager();
        const managerC = createClientManager();
        const managerEmitter = new vscode.EventEmitter<RuntimeClientManager>();
        const stateEmitter = new vscode.EventEmitter<RuntimeState>();
        const sessionShape: {
            sessionId: string;
            clientManager: RuntimeClientManager | undefined;
            onDidCreateClientManager: vscode.Event<RuntimeClientManager>;
            onDidChangeRuntimeState: vscode.Event<RuntimeState>;
        } = {
            sessionId: 'reattach-session',
            clientManager: managerA.manager,
            onDidCreateClientManager: managerEmitter.event,
            onDidChangeRuntimeState: stateEmitter.event,
        };
        const runtime = new DataExplorerRuntime(
            sessionShape as unknown as RuntimeSession,
            {} as IPositronDataExplorerService,
            {
                debug: () => undefined,
                info: () => undefined,
                warn: () => undefined,
                error: () => undefined,
            } as unknown as vscode.LogOutputChannel,
        );

        assert.strictEqual(managerA.registrations, 1);

        sessionShape.clientManager = managerB.manager;
        managerEmitter.fire(managerB.manager);
        assert.strictEqual(managerA.disposals, 1);
        assert.strictEqual(managerB.registrations, 1);

        stateEmitter.fire(RuntimeState.Exited);
        assert.strictEqual(managerB.disposals, 1);

        sessionShape.clientManager = managerC.manager;
        stateEmitter.fire(RuntimeState.Starting);
        assert.strictEqual(managerC.registrations, 1);

        runtime.dispose();
        assert.strictEqual(managerC.disposals, 1);
        managerEmitter.dispose();
        stateEmitter.dispose();
    });

    test('replaces the runtime owner when a new session object reuses the same id', () => {
        const managerA = createClientManager();
        const managerB = createClientManager();
        const managerEmitterA = new vscode.EventEmitter<RuntimeClientManager>();
        const managerEmitterB = new vscode.EventEmitter<RuntimeClientManager>();
        const stateEmitterA = new vscode.EventEmitter<RuntimeState>();
        const stateEmitterB = new vscode.EventEmitter<RuntimeState>();
        const sessionA = {
            sessionId: 'reused-session-id',
            clientManager: managerA.manager,
            onDidCreateClientManager: managerEmitterA.event,
            onDidChangeRuntimeState: stateEmitterA.event,
        } as unknown as RuntimeSession;
        const sessionB = {
            sessionId: 'reused-session-id',
            clientManager: managerB.manager,
            onDidCreateClientManager: managerEmitterB.event,
            onDidChangeRuntimeState: stateEmitterB.event,
        } as unknown as RuntimeSession;
        const willStartEmitter = new vscode.EventEmitter<{ session: RuntimeSession }>();
        const deleteEmitter = new vscode.EventEmitter<string>();
        const service = new PositronDataExplorerService(
            {
                sessions: [sessionA],
                onWillStartSession: willStartEmitter.event,
                onDidDeleteRuntimeSession: deleteEmitter.event,
            } as unknown as RuntimeSessionService,
            {
                debug: () => undefined,
                info: () => undefined,
                warn: () => undefined,
                error: () => undefined,
            } as unknown as vscode.LogOutputChannel,
        );

        service.initialize();
        assert.strictEqual(managerA.registrations, 1);

        willStartEmitter.fire({ session: sessionB });
        assert.strictEqual(managerA.disposals, 1);
        assert.strictEqual(managerB.registrations, 1);

        service.dispose();
        assert.strictEqual(managerB.disposals, 1);
        willStartEmitter.dispose();
        deleteEmitter.dispose();
        managerEmitterA.dispose();
        managerEmitterB.dispose();
        stateEmitterA.dispose();
        stateEmitterB.dispose();
    });
});
