import assert from 'node:assert/strict';
import test from 'node:test';
import { assertKallichoreApiMatchesSpec, assertKallichoreVersionsCanSync } from './sync-kallichore-api.mjs';

test('allows matching spec, standalone binary and Positron versions', () => {
    assert.doesNotThrow(() => {
        assertKallichoreVersionsCanSync({
            sourceVersion: '0.1.71',
            standaloneVersion: '0.1.71',
            positronVersion: '0.1.71',
        });
    });
});

test('rejects a newer Positron client paired with an older spec and binary', () => {
    assert.throws(
        () => assertKallichoreVersionsCanSync({
            sourceVersion: '0.1.67',
            standaloneVersion: '0.1.67',
            positronVersion: '0.1.71',
        }),
        /source=0\.1\.67, vscode-supervisor=0\.1\.67, Positron=0\.1\.71/,
    );
});

test('requires the standalone binary version to match the Kallichore source', () => {
    assert.throws(
        () => assertKallichoreVersionsCanSync({
            sourceVersion: '0.1.68',
            standaloneVersion: '0.1.67',
            positronVersion: '0.1.68',
        }),
        /source=0\.1\.68, vscode-supervisor=0\.1\.67/,
    );
});

const spec = {
    components: {
        schemas: {
            status: { type: 'string', enum: ['ready'] },
            session: {
                type: 'object',
                properties: {
                    status: { $ref: '#/components/schemas/status' },
                    history: { type: 'array', items: { type: 'string' } },
                },
                required: ['status'],
            },
        },
    },
    paths: {
        '/sessions/{session_id}': { get: { operationId: 'get-session' } },
    },
};

const api = `
export const Status = { Ready: 'ready' } as const;
export type Status = typeof Status[keyof typeof Status];
export interface Session {
    'status': Status;
    'history'?: Array<string>;
}
export const DefaultApiAxiosParamCreator = function() {
    return {
        getSession: async (sessionId: string) => {
            const localVarPath = \`/sessions/{session_id}\`.replace('{session_id}', encodeURIComponent(sessionId));
            const localVarRequestOptions = { method: 'GET' };
            return { url: localVarPath, options: localVarRequestOptions };
        },
    };
};
export class DefaultApi {
    public getSession(sessionId: string) {}
}
`;

test('accepts generated operations and model contracts matching the spec', () => {
    assert.doesNotThrow(() => assertKallichoreApiMatchesSpec(spec, api));
});

test('rejects a stale client without a new model field', () => {
    assert.throws(() => assertKallichoreApiMatchesSpec(spec, api.replace("'history'?: Array<string>;", '')),
        /Model Session mismatch: missing=\[history\]/);
});

test('rejects changed field optionality and types', () => {
    assert.throws(() => assertKallichoreApiMatchesSpec(spec, api.replace("'history'?:", "'history':")),
        /field optionality mismatch: Session.history/);
    assert.throws(() => assertKallichoreApiMatchesSpec(spec, api.replace('Array<string>', 'Array<number>')),
        /field type mismatch: Session.history/);
});

test('rejects enum drift', () => {
    assert.throws(() => assertKallichoreApiMatchesSpec(spec, api.replace("Ready: 'ready'", "Ready: 'idle'")),
        /Enum Status mismatch/);
});

test('rejects new spec operations absent from the generated client', () => {
    const newerSpec = structuredClone(spec);
    newerSpec.paths['/history'] = { get: { operationId: 'get-history' } };
    assert.throws(() => assertKallichoreApiMatchesSpec(newerSpec, api),
        /Kallichore operations mismatch: missing=\[getHistory\]/);
});

test('rejects changed HTTP routes and methods even when operation names match', () => {
    assert.throws(() => assertKallichoreApiMatchesSpec(spec, api.replace('`/sessions/{session_id}`', '`/wrong/{session_id}`')),
        /route\/method mismatch: getSession/);
    assert.throws(() => assertKallichoreApiMatchesSpec(spec, api.replace("method: 'GET'", "method: 'POST'")),
        /route\/method mismatch: getSession/);
});
