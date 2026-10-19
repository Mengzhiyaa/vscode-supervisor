import * as assert from 'assert';
import { disposeAll, toDisposable, withDisposables } from '../kit-disposables';

suite('[Unit] test resource cleanup', () => {
    test('awaits every cleanup in reverse order even when earlier cleanups fail', async () => {
        const order: number[] = [];
        const failure = new Error('cleanup failed');
        const disposables = [
            toDisposable(() => {
                order.push(1);
            }),
            toDisposable(async () => {
                await Promise.resolve();
                order.push(2);
            }),
            toDisposable(() => {
                order.push(3);
                throw failure;
            }),
        ];
        await assert.rejects(disposeAll(disposables), (error: unknown) => {
            assert.ok(error instanceof AggregateError);
            assert.deepStrictEqual(error.errors, [failure]);
            return true;
        });
        assert.deepStrictEqual(order, [3, 2, 1]);
        assert.deepStrictEqual(disposables, []);
    });

    test('returns the body result after successful cleanup', async () => {
        let disposed = false;
        const result = await withDisposables((disposables) => {
            disposables.push(
                toDisposable(() => {
                    disposed = true;
                }),
            );
            return 42;
        });
        assert.strictEqual(result, 42);
        assert.strictEqual(disposed, true);
    });

    test('preserves a failing assertion and still cleans up', async () => {
        const failure = new assert.AssertionError({ message: 'body failed' });
        let disposed = false;
        await assert.rejects(
            withDisposables((disposables) => {
                disposables.push(
                    toDisposable(() => {
                        disposed = true;
                    }),
                );
                throw failure;
            }),
            (error: unknown) => error === failure,
        );
        assert.strictEqual(disposed, true);
    });

    test('fails a successful body when its cleanup fails', async () => {
        const failure = new Error('cleanup failed');
        await assert.rejects(
            withDisposables((disposables) => {
                disposables.push(
                    toDisposable(() => {
                        throw failure;
                    }),
                );
            }),
            (error: unknown) => error === failure,
        );
    });

    test('reports both body and cleanup failures without losing either', async () => {
        const bodyFailure = new Error('body failed');
        const cleanupFailure = new Error('cleanup failed');
        await assert.rejects(
            withDisposables((disposables) => {
                disposables.push(
                    toDisposable(() => {
                        throw cleanupFailure;
                    }),
                );
                throw bodyFailure;
            }),
            (error: unknown) => {
                assert.ok(error instanceof AggregateError);
                assert.deepStrictEqual(error.errors, [bodyFailure, cleanupFailure]);
                return true;
            },
        );
    });
});
