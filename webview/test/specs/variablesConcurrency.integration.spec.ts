import { expect, test, type Page } from '@playwright/test';
import { SessionMethods, VariablesMethods, createSession, createVariablesInstance, registerVariablesDefaults } from '../harness/domains';
import { openWebviewPage } from '../harness/page';
import type { MockWebviewBackend } from '../harness/mockWebviewBackend';

function entry(name: string) {
    return { type: 'item' as const, id: name, path: [name], displayName: name, displayValue: 'value', displayType: 'list', kind: 'collection', hasChildren: false, hasViewer: false, isExpanded: false };
}
function deferred() {
    let resolve!: (value: unknown) => void;
    const promise = new Promise<unknown>(yes => { resolve = yes; });
    return { promise, resolve };
}
async function deliver(page: Page, backend: MockWebviewBackend, reply: ReturnType<typeof deferred>, result: unknown) {
    const original = backend.respond.bind(backend);
    let delivered!: () => void;
    const sent = new Promise<void>(resolve => { delivered = resolve; });
    backend.respond = async (id, value) => {
        await original(id, value);
        if (value === result) { delivered(); }
    };
    reply.resolve(result);
    await sent;
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    backend.respond = original;
}

test('variables does not replace a kernel notification with a delayed initial snapshot', async ({ page }) => {
    const reply = deferred();
    const backend = await openWebviewPage(page, 'variables', { configure(mock) {
        registerVariablesDefaults(mock);
        mock.onRequest(VariablesMethods.listEntries, () => reply.promise);
    } });
    await backend.notify(VariablesMethods.instanceStarted, { instance: createVariablesInstance('session-1') });
    await backend.notify(SessionMethods.info, { sessions: [createSession()], activeSessionId: 'session-1' });
    await expect.poll(() => backend.requestCount(VariablesMethods.listEntries)).toBe(1);
    await backend.notify(VariablesMethods.entriesChanged, { sessionId: 'session-1', entries: [entry('latest-value')] });
    await expect(page.getByText('latest-value', { exact: true })).toBeVisible();
    await deliver(page, backend, reply, { entries: [entry('obsolete-value')] });
    await expect(page.getByText('latest-value', { exact: true })).toBeVisible();
    await expect(page.getByText('obsolete-value', { exact: true })).toHaveCount(0);
});

test('variables does not resurrect a stopped session from an outstanding snapshot', async ({ page }) => {
    const reply = deferred();
    let requests = 0;
    const backend = await openWebviewPage(page, 'variables', { configure(mock) {
        registerVariablesDefaults(mock);
        mock.onRequest(VariablesMethods.listEntries, () => ++requests === 1 ? reply.promise : { entries: [entry('restarted-value')] });
    } });
    await backend.notify(VariablesMethods.instanceStarted, { instance: createVariablesInstance('session-1') });
    await backend.notify(SessionMethods.info, { sessions: [createSession()], activeSessionId: 'session-1' });
    await expect.poll(() => requests).toBe(1);
    await backend.notify(VariablesMethods.instanceStopped, { sessionId: 'session-1' });
    await backend.notify(SessionMethods.info, { sessions: [] });
    await deliver(page, backend, reply, { entries: [entry('stopped-value')] });
    await backend.notify(VariablesMethods.instanceStarted, { instance: createVariablesInstance('session-1') });
    await backend.notify(SessionMethods.info, { sessions: [createSession()], activeSessionId: 'session-1' });
    await expect.poll(() => requests).toBe(2);
    await expect(page.getByText('restarted-value', { exact: true })).toBeVisible();
    await expect(page.getByText('stopped-value', { exact: true })).toHaveCount(0);
});

test('variables follows a newer foreground event instead of a delayed session selection reply', async ({ page }) => {
    const reply = deferred();
    const sessions = [createSession(), createSession({ id: 'session-2', name: 'Second' }), createSession({ id: 'session-3', name: 'Third' })];
    const backend = await openWebviewPage(page, 'variables', { configure(mock) {
        registerVariablesDefaults(mock, { entriesBySession: Object.fromEntries(sessions.map(session => [session.id, [entry(session.id)]])) });
        mock.onRequest(VariablesMethods.setActiveSession, () => reply.promise);
    } });
    for (const session of sessions) {
        await backend.notify(VariablesMethods.instanceStarted, { instance: createVariablesInstance(session.id) });
    }
    await backend.notify(SessionMethods.info, { sessions, activeSessionId: 'session-1' });
    await expect(page.getByText('session-1', { exact: true })).toBeVisible();
    await page.getByLabel('Select session to view variables from').click();
    await page.getByText('Second', { exact: true }).click();
    await expect.poll(() => backend.requestCount(VariablesMethods.setActiveSession)).toBe(1);
    await backend.notify(VariablesMethods.activeInstanceChanged, { sessionId: 'session-3' });
    await expect(page.getByText('session-3', { exact: true })).toBeVisible();
    await deliver(page, backend, reply, {});
    await expect(page.getByText('session-3', { exact: true })).toBeVisible();
    await expect(page.getByText('session-2', { exact: true })).toHaveCount(0);
});

test('variables closes a delete confirmation when its target session changes', async ({ page }) => {
    const sessions = [createSession(), createSession({ id: 'session-2', name: 'Second' })];
    const backend = await openWebviewPage(page, 'variables', { configure(mock) {
        registerVariablesDefaults(mock, { entriesBySession: { 'session-1': [entry('first')], 'session-2': [entry('second')] } });
    } });
    for (const session of sessions) {
        await backend.notify(VariablesMethods.instanceStarted, { instance: createVariablesInstance(session.id) });
    }
    await backend.notify(SessionMethods.info, { sessions, activeSessionId: 'session-1' });
    await expect(page.getByText('first', { exact: true })).toBeVisible();
    await page.getByLabel('Delete all objects').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await backend.notify(VariablesMethods.activeInstanceChanged, { sessionId: 'session-2' });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(backend.requestCount(VariablesMethods.clear)).toBe(0);
});
