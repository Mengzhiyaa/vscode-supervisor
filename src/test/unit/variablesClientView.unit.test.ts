import * as assert from 'assert';
import Module = require('module');

type VariablesClientModule = typeof import('../../runtime/VariablesClientInstance');

function createMockVscode() {
    class EventEmitter<T> {
        private _listeners: Array<(value: T) => void> = [];

        readonly event = (listener: (value: T) => void) => {
            this._listeners.push(listener);
            return {
                dispose: () => {
                    this._listeners = this._listeners.filter((current) => current !== listener);
                },
            };
        };

        fire(value: T): void {
            for (const listener of [...this._listeners]) {
                listener(value);
            }
        }

        dispose(): void {
            this._listeners = [];
        }
    }

    class Disposable {
        constructor(private readonly _onDispose?: () => void) { }

        dispose(): void {
            this._onDispose?.();
        }
    }

    return {
        Disposable,
        EventEmitter,
    };
}

function withMockedVscode<T>(callback: (variablesModule: VariablesClientModule) => Promise<T>): Promise<T>;
function withMockedVscode<T>(callback: (variablesModule: VariablesClientModule) => T): T;
function withMockedVscode<T>(
    callback: (variablesModule: VariablesClientModule) => Promise<T> | T
): Promise<T> | T {
    const originalLoad = (Module as any)._load;
    const mockVscode = createMockVscode();
    const modulePath = require.resolve('../../runtime/VariablesClientInstance');

    (Module as any)._load = function (request: string, ...args: any[]) {
        if (request === 'vscode') {
            return mockVscode;
        }
        return originalLoad.call(this, request, ...args);
    };

    delete require.cache[modulePath];

    try {
        const variablesModule = require('../../runtime/VariablesClientInstance') as VariablesClientModule;
        return callback(variablesModule);
    } finally {
        delete require.cache[modulePath];
        (Module as any)._load = originalLoad;
    }
}

suite('[Unit] variables client view diagnostics', () => {
    test('returns the backend viewer id returned by the view RPC', async () => {
        await withMockedVscode(async ({ VariablesClientInstance }) => {
            const requestedPaths: string[][] = [];
            const instance = Object.create(VariablesClientInstance.prototype) as InstanceType<typeof VariablesClientInstance>;

            (instance as any)._comm = {
                view: async (path: string[]) => {
                    requestedPaths.push(path);
                    return 'viewer-comm-1';
                },
            };

            const result = await (VariablesClientInstance.prototype.view as any).call(instance, ['db']);

            assert.deepStrictEqual(requestedPaths, [['db']]);
            assert.strictEqual(result, 'viewer-comm-1');
        });
    });
});
