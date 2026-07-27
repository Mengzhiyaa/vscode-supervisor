import { expect, test } from '@playwright/test';
import {
    DataExplorerMethods,
    createDataExplorerBackendState,
    createDataExplorerSchemaColumn,
} from '../harness/domains';
import { openWebviewPage } from '../harness/page';

interface DataRequestParams {
    startRow: number;
    endRow: number;
    columns: number[];
    requestId: number;
    generation: number;
}

async function initializeExplorerFixture(
    backend: Awaited<ReturnType<typeof openWebviewPage>>,
    options: {
        backendState?: ReturnType<typeof createDataExplorerBackendState>;
        columns?: ReturnType<typeof createDataExplorerSchemaColumn>[];
        data?: Array<Array<number | string>>;
    } = {},
) {
    await backend.notify(DataExplorerMethods.initialize, {
        identifier: 'fixture-table',
        displayName: 'Fixture Table',
        backendState: options.backendState ?? createDataExplorerBackendState(),
    });
    await backend.notify(DataExplorerMethods.schema, {
        columns: options.columns ?? [
            createDataExplorerSchemaColumn({
                column_name: 'id',
                column_index: 0,
                type_name: 'INTEGER',
                type_display: 'integer',
            }),
            createDataExplorerSchemaColumn({
                column_name: 'species',
                column_index: 1,
                type_name: 'VARCHAR',
                type_display: 'string',
            }),
        ],
    });
    await expect
        .poll(() => backend.notificationCount(DataExplorerMethods.requestData))
        .toBeGreaterThan(0);
    const dataRequest = backend.notifications(DataExplorerMethods.requestData).at(-1)!;
    const dataRequestParams = dataRequest.params as DataRequestParams;
    await backend.notify(DataExplorerMethods.data, {
        startRow: dataRequestParams.startRow,
        endRow: dataRequestParams.endRow,
        columnIndices: dataRequestParams.columns,
        requestId: dataRequestParams.requestId,
        generation: dataRequestParams.generation,
        columns: options.data ?? [
            ['1', '2', '3'],
            ['setosa', 'versicolor', 'virginica'],
        ],
    });
}

function mirrorDataExplorerPanelState(
    backend: Awaited<ReturnType<typeof openWebviewPage>>,
) {
    backend.onNotification(DataExplorerMethods.setLayout, async (notification) => {
        const params = notification.params as { layout: 'SummaryOnLeft' | 'SummaryOnRight' };
        await backend.notify(DataExplorerMethods.layoutChanged, {
            layout: params.layout,
        });
    });

    backend.onNotification(DataExplorerMethods.setSummaryCollapsed, async (notification) => {
        const params = notification.params as { collapsed: boolean };
        await backend.notify(DataExplorerMethods.summaryCollapsedChanged, {
            collapsed: params.collapsed,
        });
    });

    backend.onNotification(DataExplorerMethods.setSummaryWidth, async (notification) => {
        const params = notification.params as { summaryWidth: number };
        await backend.notify(DataExplorerMethods.summaryWidthChanged, params);
    });

    backend.onNotification(DataExplorerMethods.setSelection, async (notification) => {
        await backend.notify(DataExplorerMethods.selectionChanged, notification.params);
    });
}

test('data explorer initializes, renders schema, and requests visible data', async ({ page }) => {
    const backend = await openWebviewPage(page, 'dataExplorer');
    await expect(page.locator('.positron-data-explorer')).toBeVisible({ timeout: 15_000 });
    await expect
        .poll(() => backend.notificationCount(DataExplorerMethods.ready), {
            timeout: 15_000,
        })
        .toBeGreaterThan(0);

    await backend.notify(DataExplorerMethods.initialize, {
        identifier: 'fixture-table',
        displayName: 'Fixture Table',
        backendState: createDataExplorerBackendState({
            table_shape: { num_rows: 120, num_columns: 2 },
            table_unfiltered_shape: { num_rows: 120, num_columns: 2 },
        }),
    });
    await backend.notify(DataExplorerMethods.schema, {
        columns: [
            createDataExplorerSchemaColumn({
                column_name: 'id',
                column_index: 0,
                type_name: 'INTEGER',
                type_display: 'integer',
            }),
            createDataExplorerSchemaColumn({
                column_name: 'species',
                column_index: 1,
                type_name: 'VARCHAR',
                type_display: 'string',
            }),
        ],
    });

    await expect
        .poll(() =>
            backend.notifications(DataExplorerMethods.requestData).find((message) => {
                const params = message.params as {
                    startRow?: number;
                    columns?: number[];
                };
                return (
                    params.startRow === 0 &&
                    Array.isArray(params.columns) &&
                    params.columns.includes(0) &&
                    params.columns.includes(1)
                );
            }),
        )
        .toBeTruthy();
    const dataRequest = backend.notifications(DataExplorerMethods.requestData).find((message) => {
        const params = message.params as {
            startRow?: number;
            columns?: number[];
        };
        return (
            params.startRow === 0 &&
            Array.isArray(params.columns) &&
            params.columns.includes(0) &&
            params.columns.includes(1)
        );
    })!;
    expect(dataRequest.params).toMatchObject({
        startRow: 0,
        columns: expect.arrayContaining([0, 1]),
    });

    await backend.notify(DataExplorerMethods.data, {
        startRow: 0,
        endRow: 50,
        columnIndices: [0, 1],
        requestId: (dataRequest.params as DataRequestParams).requestId,
        generation: (dataRequest.params as DataRequestParams).generation,
        columns: [
            ['1', '2', '3'],
            ['setosa', 'versicolor', 'virginica'],
        ],
    });

    await expect(page.getByText('id')).toBeVisible();
    await expect(page.getByText('species')).toBeVisible();
    await expect(page.locator('.status-bar')).toContainText('120');
    await expect(page.locator('.status-bar')).toContainText('2');
});

test('data explorer preserves numeric special-value sentinels without reclassifying literal strings', async ({ page }) => {
    const backend = await openWebviewPage(page, 'dataExplorer');
    await expect(page.locator('.positron-data-explorer')).toBeVisible({ timeout: 15_000 });

    await initializeExplorerFixture(backend, {
        data: [[0], ['NULL']],
    });

    const sentinelValue = page.locator(
        '.data-grid-row-cell[data-column-index="0"][data-row-index="0"] .text-value',
    );
    const literalValue = page.locator(
        '.data-grid-row-cell[data-column-index="1"][data-row-index="0"] .text-value',
    );
    await expect(sentinelValue).toHaveText('NULL');
    await expect(sentinelValue).toHaveClass(/special-value/);
    await expect(literalValue).toHaveText('NULL');
    await expect(literalValue).not.toHaveClass(/special-value/);
});

test('data explorer requests visible schema for a zero-row table', async ({ page }) => {
    const backend = await openWebviewPage(page, 'dataExplorer');
    await expect(page.locator('.positron-data-explorer')).toBeVisible({ timeout: 15_000 });

    await backend.notify(DataExplorerMethods.initialize, {
        identifier: 'empty-table',
        displayName: 'Empty Table',
        backendState: createDataExplorerBackendState({
            table_shape: { num_rows: 0, num_columns: 2 },
            table_unfiltered_shape: { num_rows: 0, num_columns: 2 },
        }),
    });

    await expect
        .poll(() => backend.notificationCount(DataExplorerMethods.requestData))
        .toBeGreaterThan(0);
    const request = backend.notifications(DataExplorerMethods.requestData).at(-1)!;
    const params = request.params as DataRequestParams;
    expect(params).toMatchObject({
        startRow: 0,
        endRow: 0,
        columns: expect.arrayContaining([0, 1]),
    });

    const schema = [
        createDataExplorerSchemaColumn({
            column_name: 'id',
            column_index: 0,
            type_name: 'INTEGER',
            type_display: 'integer',
        }),
        createDataExplorerSchemaColumn({
            column_name: 'species',
            column_index: 1,
            type_name: 'VARCHAR',
            type_display: 'string',
        }),
    ];
    await backend.notify(DataExplorerMethods.data, {
        startRow: 0,
        endRow: 0,
        columnIndices: params.columns,
        columns: params.columns.map(() => []),
        schema,
        requestId: params.requestId,
        generation: params.generation,
    });

    await expect(page.getByText('id')).toBeVisible();
    await expect(page.getByText('species')).toBeVisible();
    await expect(page.locator('.status-bar')).toContainText('0');
});

test('data explorer ignores a data response from an invalidated generation', async ({ page }) => {
    const backend = await openWebviewPage(page, 'dataExplorer');
    await expect(page.locator('.positron-data-explorer')).toBeVisible({ timeout: 15_000 });
    await initializeExplorerFixture(backend);

    const initialRequest = backend.notifications(DataExplorerMethods.requestData).at(-1)!;
    const initialParams = initialRequest.params as DataRequestParams;
    const requestCount = backend.notificationCount(DataExplorerMethods.requestData);
    await backend.notify(DataExplorerMethods.dataInvalidated, {
        generation: initialParams.generation + 1,
        schemaChanged: false,
    });
    await expect
        .poll(() => backend.notificationCount(DataExplorerMethods.requestData))
        .toBeGreaterThan(requestCount);
    const currentRequest = backend.notifications(DataExplorerMethods.requestData).at(-1)!;
    const currentParams = currentRequest.params as DataRequestParams;

    await backend.notify(DataExplorerMethods.data, {
        startRow: initialParams.startRow,
        endRow: initialParams.endRow,
        columnIndices: initialParams.columns,
        columns: [['stale'], ['stale']],
        requestId: initialParams.requestId,
        generation: initialParams.generation,
    });
    await backend.notify(DataExplorerMethods.data, {
        startRow: currentParams.startRow,
        endRow: currentParams.endRow,
        columnIndices: currentParams.columns,
        columns: [['fresh'], ['fresh']],
        requestId: currentParams.requestId,
        generation: currentParams.generation,
    });

    await expect(page.locator('.data-grid-row-cell').filter({ hasText: 'fresh' }).first()).toBeVisible();
    await expect(page.getByText('stale')).toHaveCount(0);
});

test('data explorer renders row-label placeholders until row labels are cached', async ({ page }) => {
    const backend = await openWebviewPage(page, 'dataExplorer');
    await expect(page.locator('.positron-data-explorer')).toBeVisible({ timeout: 15_000 });
    await expect
        .poll(() => backend.notificationCount(DataExplorerMethods.ready), {
            timeout: 15_000,
        })
        .toBeGreaterThan(0);

    await backend.notify(DataExplorerMethods.initialize, {
        identifier: 'fixture-table',
        displayName: 'Fixture Table',
        backendState: createDataExplorerBackendState({
            table_shape: { num_rows: 12, num_columns: 2 },
            table_unfiltered_shape: { num_rows: 12, num_columns: 2 },
            has_row_labels: true,
        }),
    });
    await backend.notify(DataExplorerMethods.schema, {
        columns: [
            createDataExplorerSchemaColumn({
                column_name: 'id',
                column_index: 0,
                type_name: 'INTEGER',
                type_display: 'integer',
            }),
            createDataExplorerSchemaColumn({
                column_name: 'species',
                column_index: 1,
                type_name: 'VARCHAR',
                type_display: 'string',
            }),
        ],
    });

    const firstRowHeader = page.locator('.data-grid-row-header[data-row-index="0"]');
    await expect(firstRowHeader).toContainText('...');

    await expect
        .poll(() => backend.notificationCount(DataExplorerMethods.requestData))
        .toBeGreaterThan(0);
    const dataRequest = backend.notifications(DataExplorerMethods.requestData).at(-1)!;
    const dataRequestParams = dataRequest.params as DataRequestParams;

    await backend.notify(DataExplorerMethods.data, {
        startRow: dataRequestParams.startRow,
        endRow: dataRequestParams.endRow,
        columnIndices: dataRequestParams.columns,
        requestId: dataRequestParams.requestId,
        generation: dataRequestParams.generation,
        rowLabels: ['iris_1', 'iris_2', 'iris_3'],
        columns: [
            ['1', '2', '3'],
            ['setosa', 'versicolor', 'virginica'],
        ],
    });

    await expect(firstRowHeader).toContainText('iris_1');
});

test('data explorer sends toolbar and schema-expansion notifications', async ({ page }) => {
    const backend = await openWebviewPage(page, 'dataExplorer');
    mirrorDataExplorerPanelState(backend);
    await expect(page.locator('.positron-data-explorer')).toBeVisible({ timeout: 15_000 });
    await expect
        .poll(() => backend.notificationCount(DataExplorerMethods.ready), {
            timeout: 15_000,
        })
        .toBeGreaterThan(0);

    await initializeExplorerFixture(backend, {
        backendState: createDataExplorerBackendState({
            table_shape: { num_rows: 12, num_columns: 3 },
            table_unfiltered_shape: { num_rows: 12, num_columns: 3 },
            sort_keys: [{ column_index: 0, ascending: true }],
        }),
    });

    // Test clear sort via column header context menu
    const clearSort = backend.waitForNextNotification(DataExplorerMethods.clearSort);
    await backend.notify(DataExplorerMethods.showColumnContextMenu);
    await page.getByText('Clear Sorting').click();
    expect((await clearSort).params).toEqual({ type: 'clearSort' });

    // Test layout change via splitter double-click
    const setLayout = backend.waitForNextNotification(DataExplorerMethods.setLayout);
    const splitter = page.locator('.vertical-splitter .sash');
    const box = await splitter.boundingBox();
    await splitter.dblclick({ position: { x: 1, y: 64 } });
    expect((await setLayout).params).toEqual({
        type: 'setLayout',
        layout: 'SummaryOnRight',
    });
    await expect(page.locator('.data-explorer')).toHaveClass(/summary-on-right/);

    // Test move to new window (triggered via backend notification)
    const moveToNewWindow = backend.waitForNextNotification(DataExplorerMethods.moveToNewWindow);
    await backend.notify(DataExplorerMethods.moveToNewWindow);
    expect((await moveToNewWindow).params).toEqual({ type: 'moveToNewWindow' });

    // Test request schema via add filter from cell context menu
    const requestSchema = backend.waitForNextNotification(DataExplorerMethods.requestSchema);
    await backend.notify(DataExplorerMethods.showCellContextMenu);
    await page.getByText('Add Filter').click();
    expect((await requestSchema).params).toEqual({
        type: 'requestSchema',
        columns: [0, 1, 2],
    });
});

test('data explorer notifies summary collapse changes from the splitter control', async ({ page }) => {
    const backend = await openWebviewPage(page, 'dataExplorer');
    mirrorDataExplorerPanelState(backend);
    await expect(page.locator('.positron-data-explorer')).toBeVisible({ timeout: 15_000 });
    await expect
        .poll(() => backend.notificationCount(DataExplorerMethods.ready), {
            timeout: 15_000,
        })
        .toBeGreaterThan(0);

    await initializeExplorerFixture(backend);
    const splitterButton = page.locator('.expand-collapse-button');
    await expect.poll(() => splitterButton.getAttribute('aria-label')).toBe('Collapse summary');

    const collapseSummary = backend.waitForNextNotification(DataExplorerMethods.setSummaryCollapsed);
    await splitterButton.focus();
    await splitterButton.press('Enter');
    expect((await collapseSummary).params).toEqual({
        type: 'setSummaryCollapsed',
        collapsed: true,
    });
    await expect.poll(() => splitterButton.getAttribute('aria-label')).toBe('Expand summary');

    const expandSummary = backend.waitForNextNotification(DataExplorerMethods.setSummaryCollapsed);
    await splitterButton.press('Enter');
    expect((await expandSummary).params).toEqual({
        type: 'setSummaryCollapsed',
        collapsed: false,
    });
    await expect.poll(() => splitterButton.getAttribute('aria-label')).toBe('Collapse summary');
});

test('data explorer toggles the summary layout from splitter double click', async ({ page }) => {
    const backend = await openWebviewPage(page, 'dataExplorer');
    mirrorDataExplorerPanelState(backend);
    await expect(page.locator('.positron-data-explorer')).toBeVisible({ timeout: 15_000 });
    await expect
        .poll(() => backend.notificationCount(DataExplorerMethods.ready), {
            timeout: 15_000,
        })
        .toBeGreaterThan(0);

    await initializeExplorerFixture(backend);

    const splitterSash = page.locator('.vertical-splitter .sash');
    const switchToRight = backend.waitForNextNotification(DataExplorerMethods.setLayout);
    await splitterSash.dblclick({ position: { x: 1, y: 64 } });
    expect((await switchToRight).params).toEqual({
        type: 'setLayout',
        layout: 'SummaryOnRight',
    });
    await expect(page.locator('.data-explorer')).toHaveClass(/summary-on-right/);

    const switchToLeft = backend.waitForNextNotification(DataExplorerMethods.setLayout);
    await splitterSash.dblclick({ position: { x: 1, y: 64 } });
    expect((await switchToLeft).params).toEqual({
        type: 'setLayout',
        layout: 'SummaryOnLeft',
    });
    await expect(page.locator('.data-explorer')).toHaveClass(/summary-on-left/);
});

test('data explorer supports keyboard resizing, collapse, and layout inversion', async ({ page }) => {
    const backend = await openWebviewPage(page, 'dataExplorer');
    mirrorDataExplorerPanelState(backend);
    await expect(page.locator('.positron-data-explorer')).toBeVisible({ timeout: 15_000 });
    await initializeExplorerFixture(backend);

    const sash = page.getByRole('separator', { name: 'Resize summary panel' });
    await expect(sash).toHaveAttribute('aria-valuenow', '350');

    const resize = backend.waitForNextNotification(DataExplorerMethods.setSummaryWidth);
    await sash.focus();
    await sash.press('ArrowRight');
    expect((await resize).params).toEqual({
        type: 'setSummaryWidth',
        summaryWidth: 360,
    });
    await expect(sash).toHaveAttribute('aria-valuenow', '360');

    const invert = backend.waitForNextNotification(DataExplorerMethods.setLayout);
    await sash.press('Enter');
    expect((await invert).params).toEqual({
        type: 'setLayout',
        layout: 'SummaryOnRight',
    });

    const collapse = backend.waitForNextNotification(DataExplorerMethods.setSummaryCollapsed);
    await sash.press('Home');
    expect((await collapse).params).toEqual({
        type: 'setSummaryCollapsed',
        collapsed: true,
    });
});

test('data explorer publishes model-owned summary width and selection intents', async ({ page }) => {
    const backend = await openWebviewPage(page, 'dataExplorer');
    mirrorDataExplorerPanelState(backend);
    await expect(page.locator('.positron-data-explorer')).toBeVisible({ timeout: 15_000 });
    await initializeExplorerFixture(backend);

    const selectionChanged = backend.waitForNextNotification(DataExplorerMethods.setSelection);
    await page.locator('.data-grid-row-cell[data-column-index="1"][data-row-index="0"]').click();
    expect((await selectionChanged).params).toMatchObject({
        type: 'setSelection',
        selectionType: 'cell',
        columnIndex: 1,
        rowIndex: 0,
    });

    const sash = page.locator('.vertical-splitter .sash');
    const box = await sash.boundingBox();
    expect(box).not.toBeNull();
    const widthChanged = backend.waitForNextNotification(DataExplorerMethods.setSummaryWidth);
    await page.mouse.move(box!.x + box!.width / 2, box!.y + 60);
    await page.mouse.down();
    await page.mouse.move(box!.x + 50, box!.y + 60);
    await page.mouse.up();
    const widthParams = (await widthChanged).params as {
        type: string;
        summaryWidth: number;
    };
    expect(widthParams.type).toBe('setSummaryWidth');
    expect(widthParams.summaryWidth).toBeGreaterThan(350);
});

test('data explorer bridges convert-to-code, file options, and focus changes', async ({ page }) => {
    const backend = await openWebviewPage(page, 'dataExplorer');
    mirrorDataExplorerPanelState(backend);
    await expect(page.locator('.positron-data-explorer')).toBeVisible({ timeout: 15_000 });
    await expect
        .poll(() => backend.notificationCount(DataExplorerMethods.ready), {
            timeout: 15_000,
        })
        .toBeGreaterThan(0);

    await backend.notify(DataExplorerMethods.initialize, {
        identifier: 'fixture-table',
        displayName: 'Fixture Table',
        backendState: createDataExplorerBackendState({
            __ark_file_options: {
                supportsFileOptions: true,
                fileHasHeaderRow: false,
            },
        }),
    });
    await backend.notify(DataExplorerMethods.schema, {
        columns: [
            createDataExplorerSchemaColumn({
                column_name: 'id',
                column_index: 0,
            }),
            createDataExplorerSchemaColumn({
                column_name: 'species',
                column_index: 1,
                type_name: 'VARCHAR',
                type_display: 'string',
            }),
        ],
    });

    const previewRequest = backend.waitForNextNotification(
        DataExplorerMethods.requestConvertToCodePreview,
    );
    await backend.notify(DataExplorerMethods.convertToCode, {
        suggestedSyntax: 'python',
        availableSyntaxes: ['python', 'r'],
    });

    await expect(page.getByRole('dialog', { name: 'Convert to Code' })).toBeVisible();
    const previewMessage = await previewRequest;
    expect(previewMessage.params).toMatchObject({
        desiredSyntax: 'python',
        type: 'requestConvertToCodePreview',
    });

    await backend.notify(DataExplorerMethods.convertToCodePreview, {
        desiredSyntax: 'python',
        requestId: (previewMessage.params as { requestId: number }).requestId,
        code: 'print(df.head())',
    });

    const runConvertToCode = backend.waitForNextNotification(DataExplorerMethods.runConvertToCode);
    await page.getByRole('button', { name: 'Copy Code' }).click();
    expect((await runConvertToCode).params).toEqual({
        type: 'runConvertToCode',
        desiredSyntax: 'python',
    });

    await backend.notify(DataExplorerMethods.toggleFileOptions, {
        hasHeaderRow: false,
        supportsFileOptions: true,
        availableSheets: ['Summary', 'People'],
        selectedSheet: 'Summary',
    });
    await expect(page.getByRole('dialog', { name: 'File Options' })).toBeVisible();

    const applyFileOptions = backend.waitForNextNotification(DataExplorerMethods.applyFileOptions);
    await page.getByRole('checkbox').click();
    await page.getByLabel('Worksheet').selectOption('People');
    await page.getByRole('button', { name: 'Apply' }).click();
    expect((await applyFileOptions).params).toEqual({
        type: 'applyFileOptions',
        hasHeaderRow: true,
        sheetName: 'People',
    });

    await page.evaluate(() => {
        const button = document.createElement('button');
        button.id = 'outside-focus-target';
        button.textContent = 'outside';
        button.style.position = 'fixed';
        button.style.top = '4px';
        button.style.right = '4px';
        document.body.append(button);
    });

    // Focus on summary sort dropdown button
    const focusIn = backend.waitForNextNotification(DataExplorerMethods.focusChanged);
    await page.locator('.summary-sort-button').focus();
    expect((await focusIn).params).toEqual({
        type: 'focusChanged',
        focused: true,
    });

    const focusOut = backend.waitForNextNotification(DataExplorerMethods.focusChanged);
    await page.locator('#outside-focus-target').focus();
    expect((await focusOut).params).toEqual({
        type: 'focusChanged',
        focused: false,
    });
});

test('data explorer restores the last focused control when the host regains focus', async ({ page }) => {
    const backend = await openWebviewPage(page, 'dataExplorer');
    await expect(page.locator('.positron-data-explorer')).toBeVisible({ timeout: 15_000 });
    await initializeExplorerFixture(backend);

    const focusTarget = page.locator('.summary-sort-button');
    await focusTarget.focus();
    await page.evaluate(() => {
        const outside = document.createElement('button');
        outside.id = 'outside-focus-restore';
        document.body.append(outside);
        outside.focus();
    });
    await expect(page.locator('#outside-focus-restore')).toBeFocused();

    await backend.notify(DataExplorerMethods.focus);
    await expect(focusTarget).toBeFocused();
});

test('data explorer disables advanced features for large-column datasets', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    const backend = await openWebviewPage(page, 'dataExplorer');
    await expect(page.locator('.positron-data-explorer')).toBeVisible({ timeout: 15_000 });

    await backend.notify(DataExplorerMethods.initialize, {
        identifier: 'large-workbook',
        displayName: 'Large Workbook',
        backendState: createDataExplorerBackendState({
            table_shape: { num_rows: 1, num_columns: 10_000_000 },
            table_unfiltered_shape: { num_rows: 1, num_columns: 10_000_000 },
        }),
    });

    // The summary row action bar should be disabled for large-column datasets
    const summaryActionBar = page.locator('.summary-row-action-bar');
    await expect(summaryActionBar).toBeVisible();

    // Check that the sort dropdown is disabled
    const sortDropdown = page.locator('.summary-sort-button');
    await expect(sortDropdown).toBeVisible();
    await expect(sortDropdown).toHaveAttribute('disabled', '');

    // Check that the filter input is disabled
    const filterInput = page.locator('.summary-row-filter-bar input');
    await expect(filterInput).toBeVisible();
    await expect(filterInput).toHaveAttribute('disabled', '');
});

test('data explorer syncs model-owned panel state, metadata, status indicators, and closed overlays', async ({ page }) => {
    const backend = await openWebviewPage(page, 'dataExplorer', {
        initialState: {
            dataExplorerPanel: {
                layout: 'SummaryOnLeft',
                summaryWidth: 350,
                isSummaryCollapsed: false,
            },
        },
    });
    await expect(page.locator('.positron-data-explorer')).toBeVisible({ timeout: 15_000 });
    await expect
        .poll(() => backend.notificationCount(DataExplorerMethods.ready), {
            timeout: 15_000,
        })
        .toBeGreaterThan(0);

    await initializeExplorerFixture(backend, {
        backendState: createDataExplorerBackendState({
            table_shape: { num_rows: 12, num_columns: 2 },
            table_unfiltered_shape: { num_rows: 12, num_columns: 2 },
        }),
    });

    await backend.notify(DataExplorerMethods.layoutChanged, {
        layout: 'SummaryOnRight',
    });
    await expect(page.locator('.data-explorer')).toHaveClass(/summary-on-right/);

    await backend.notify(DataExplorerMethods.summaryCollapsedChanged, {
        collapsed: true,
    });
    await expect(page.getByLabel('Expand summary')).toBeVisible();

    await backend.notify(DataExplorerMethods.metadata, {
        displayName: 'Updated Table',
        numRows: 24,
        numColumns: 3,
    });
    await expect(page.locator('.status-bar')).toContainText('24');
    await expect(page.locator('.status-bar')).toContainText('3');

    await backend.notify(DataExplorerMethods.loading, {
        isLoading: true,
    });
    await expect(page.locator('.status-bar-indicator .icon')).toHaveAttribute('aria-label', 'Computing');

    await backend.notify(DataExplorerMethods.loading, {
        isLoading: false,
    });
    await expect.poll(async () => {
        return page.locator('.status-bar-indicator .icon').getAttribute('aria-label');
    }).toBe('Idle');

    await backend.notify(DataExplorerMethods.error, {
        message: 'Broken backend',
    });
    await expect(page.locator('.status-bar-indicator .icon')).toHaveAttribute('aria-label', 'Error');

    await backend.notify(DataExplorerMethods.backendState, {
        state: createDataExplorerBackendState({
            table_shape: { num_rows: 24, num_columns: 3 },
            table_unfiltered_shape: { num_rows: 24, num_columns: 3 },
            connected: false,
            error_message: 'Connection lost',
        }),
    });
    await expect(page.getByText('Error Opening Data Explorer')).toBeVisible();
    await expect(page.getByText('Connection lost')).toBeVisible();

    const closeRequest = backend.waitForNextNotification(DataExplorerMethods.close);
    await page.getByLabel('Close Data Explorer').click();
    expect((await closeRequest).params).toEqual({ type: 'close' });

    await backend.notify(DataExplorerMethods.backendState, {
        state: createDataExplorerBackendState({
            table_shape: { num_rows: 24, num_columns: 3 },
            table_unfiltered_shape: { num_rows: 24, num_columns: 3 },
            connected: false,
        }),
    });
    await expect(page.getByText('Connection Closed')).toBeVisible();
});

test('data explorer bridges copy, open, and data-grid context menu notifications', async ({ page }) => {
    const backend = await openWebviewPage(page, 'dataExplorer');
    await expect(page.locator('.positron-data-explorer')).toBeVisible({ timeout: 15_000 });
    await expect
        .poll(() => backend.notificationCount(DataExplorerMethods.ready), {
            timeout: 15_000,
        })
        .toBeGreaterThan(0);

    await initializeExplorerFixture(backend, {
        backendState: createDataExplorerBackendState({
            table_shape: { num_rows: 12, num_columns: 2 },
            table_unfiltered_shape: { num_rows: 12, num_columns: 2 },
        }),
    });

    await page.locator('.data-grid-row-cell[data-column-index="0"][data-row-index="0"]').click();

    const copyCurrentSelection = backend.waitForNextNotification(DataExplorerMethods.copyToClipboard);
    await backend.notify(DataExplorerMethods.copy);
    expect((await copyCurrentSelection).params).toEqual({
        type: 'copyToClipboard',
        selectionType: 'cell',
        columnIndex: 0,
        rowIndex: 0,
    });

    const copyTableData = backend.waitForNextNotification(DataExplorerMethods.copyTableData);
    await backend.notify(DataExplorerMethods.copyTableData);
    expect((await copyTableData).params).toEqual({ type: 'copyTableData' });

    const openAsPlaintext = backend.waitForNextNotification(DataExplorerMethods.openAsPlaintext);
    await backend.notify(DataExplorerMethods.openAsPlaintext);
    expect((await openAsPlaintext).params).toEqual({ type: 'openAsPlaintext' });

    const sortRequest = backend.waitForNextNotification(DataExplorerMethods.sort);
    await backend.notify(DataExplorerMethods.showColumnContextMenu);
    await page.getByText('Sort Ascending').click();
    expect((await sortRequest).params).toMatchObject({
        sortKeys: [{ columnIndex: 0, ascending: true }],
    });

    const copyRow = backend.waitForNextNotification(DataExplorerMethods.copyToClipboard);
    await backend.notify(DataExplorerMethods.showRowContextMenu);
    await page.getByText('Copy Row').click();
    expect((await copyRow).params).toEqual({
        type: 'copyToClipboard',
        selectionType: 'rows',
        rowIndexes: [0],
    });

    await backend.notify(DataExplorerMethods.showCellContextMenu);
    await page.getByText('Add Filter').click();
    await expect(page.getByRole('button', { name: 'Apply Filter' })).toBeVisible();
    await expect(page.locator('.drop-down-column-selector')).toContainText('id');
});

test('data explorer requests summary schema and column profiles from summary interactions', async ({ page }) => {
    const backend = await openWebviewPage(page, 'dataExplorer');
    await expect(page.locator('.positron-data-explorer')).toBeVisible({ timeout: 15_000 });
    await expect
        .poll(() => backend.notificationCount(DataExplorerMethods.ready), {
            timeout: 15_000,
        })
        .toBeGreaterThan(0);

    await initializeExplorerFixture(backend, {
        backendState: createDataExplorerBackendState({
            table_shape: { num_rows: 12, num_columns: 2 },
            table_unfiltered_shape: { num_rows: 12, num_columns: 2 },
        }),
    });

    await expect.poll(() => backend.notificationCount(DataExplorerMethods.searchSchema)).toBeGreaterThan(0);
    const initialSearch = backend.notifications(DataExplorerMethods.searchSchema)[0];
    expect(initialSearch.params).toMatchObject({
        type: 'searchSchema',
        text: '',
        sortOrder: 'original',
    });

    const initialProfileRequest = backend.waitForNextNotification(
        DataExplorerMethods.requestColumnProfiles,
    );
    await backend.notify(DataExplorerMethods.summarySchema, {
        columns: [
            createDataExplorerSchemaColumn({
                column_name: 'id',
                column_index: 0,
                type_name: 'INTEGER',
                type_display: 'integer',
            }),
            createDataExplorerSchemaColumn({
                column_name: 'species',
                column_index: 1,
                type_name: 'VARCHAR',
                type_display: 'string',
            }),
        ],
        columnIndices: [0, 1],
        requestId: (initialSearch.params as { requestId?: number }).requestId,
    });
    expect((await initialProfileRequest).params).toMatchObject({
        type: 'requestColumnProfiles',
        columnIndices: expect.arrayContaining([0, 1]),
    });

    const summarySearchInput = page.locator('.summary-row-filter-bar input[placeholder="Filter"]');
    await summarySearchInput.fill('spe');
    await expect.poll(() => backend.notificationCount(DataExplorerMethods.searchSchema)).toBeGreaterThan(1);
    const searchedRequest = backend.notifications(DataExplorerMethods.searchSchema).at(-1)!;
    expect(searchedRequest.params).toMatchObject({
        type: 'searchSchema',
        text: 'spe',
    });

    await backend.notify(DataExplorerMethods.summarySchema, {
        columns: [
            createDataExplorerSchemaColumn({
                column_name: 'species',
                column_index: 1,
                type_name: 'VARCHAR',
                type_display: 'string',
            }),
        ],
        columnIndices: [1],
        requestId: (searchedRequest.params as { requestId?: number }).requestId,
    });

    const basicProfileRequest = backend.notifications(DataExplorerMethods.requestColumnProfiles)[0];
    await expect
        .poll(() => backend.notificationCount(DataExplorerMethods.cancelColumnProfiles))
        .toBeGreaterThan(0);
    expect(
        backend.notifications(DataExplorerMethods.cancelColumnProfiles).at(-1)?.params,
    ).toMatchObject({
        requestIds: expect.arrayContaining([
            (basicProfileRequest.params as { requestId: number }).requestId,
        ]),
    });
    await backend.notify(DataExplorerMethods.columnProfiles, {
        profiles: [
            {
                columnIndex: 0,
                profile: {
                    profile_type: 'summary_stats',
                    summary_stats: {
                        type_display: 'integer',
                        null_count: 0,
                    },
                },
            },
            {
                columnIndex: 1,
                profile: {
                    profile_type: 'summary_stats',
                    summary_stats: {
                        type_display: 'string',
                        null_count: 0,
                    },
                },
            },
        ],
        requestId: (basicProfileRequest?.params as { requestId?: number } | undefined)?.requestId,
        generation: (basicProfileRequest?.params as { generation?: number } | undefined)?.generation,
    });

    const profileRequest = backend.waitForNextNotification(DataExplorerMethods.requestColumnProfiles);
    const summaryToggleButton = page
        .locator('.column-summary .expand-collapse-button')
        .first();
    await summaryToggleButton.click();
    const expandedProfileRequest = await profileRequest;
    expect(expandedProfileRequest.params).toMatchObject({
        type: 'requestColumnProfiles',
        columnIndices: expect.arrayContaining([1]),
        expandedColumnIndices: expect.arrayContaining([1]),
    });

    await backend.notify(DataExplorerMethods.columnProfiles, {
        profiles: [
            {
                columnIndex: 1,
                profile: {
                    profile_type: 'summary_stats',
                    summary_stats: {
                        type_display: 'string',
                        null_count: 0,
                    },
                },
            },
        ],
        requestId: (expandedProfileRequest.params as { requestId?: number }).requestId,
        generation: (expandedProfileRequest.params as { generation?: number }).generation,
    });

    const requestCountAfterExpanded = backend.notificationCount(
        DataExplorerMethods.requestColumnProfiles,
    );
    await summaryToggleButton.click();
    await summaryToggleButton.click();
    await expect
        .poll(() => backend.notificationCount(DataExplorerMethods.requestColumnProfiles))
        .toBe(requestCountAfterExpanded);
});

test('data explorer chunks visible profile requests into Positron-sized batches', async ({ page }) => {
    const backend = await openWebviewPage(page, 'dataExplorer');
    await expect(page.locator('.positron-data-explorer')).toBeVisible({ timeout: 15_000 });
    const columns = Array.from({ length: 12 }, (_, columnIndex) =>
        createDataExplorerSchemaColumn({
            column_name: `column_${columnIndex}`,
            column_index: columnIndex,
            type_name: 'INTEGER',
            type_display: 'integer',
        }),
    );

    await backend.notify(DataExplorerMethods.initialize, {
        identifier: 'profile-chunks',
        displayName: 'Profile Chunks',
        backendState: createDataExplorerBackendState({
            table_shape: { num_rows: 1, num_columns: columns.length },
            table_unfiltered_shape: { num_rows: 1, num_columns: columns.length },
        }),
    });
    await expect
        .poll(() => backend.notificationCount(DataExplorerMethods.searchSchema))
        .toBeGreaterThan(0);
    const searchRequest = backend.notifications(DataExplorerMethods.searchSchema).at(-1)!;
    await backend.notify(DataExplorerMethods.summarySchema, {
        columns,
        columnIndices: columns.map((column) => column.column_index),
        requestId: (searchRequest.params as { requestId: number }).requestId,
    });

    await expect
        .poll(() => backend.notificationCount(DataExplorerMethods.requestColumnProfiles))
        .toBeGreaterThan(1);
    const requests = backend.notifications(DataExplorerMethods.requestColumnProfiles);
    const requestedColumns = requests.flatMap((request) =>
        (request.params as { columnIndices: number[] }).columnIndices,
    );
    for (const request of requests) {
        expect((request.params as { columnIndices: number[] }).columnIndices.length)
            .toBeLessThanOrEqual(8);
    }
    expect(new Set(requestedColumns).size).toBe(12);
});

test('data explorer adds, updates, removes, and clears row filters through the UI', async ({ page }) => {
    const backend = await openWebviewPage(page, 'dataExplorer');
    await expect(page.locator('.positron-data-explorer')).toBeVisible({ timeout: 15_000 });
    await expect
        .poll(() => backend.notificationCount(DataExplorerMethods.ready), {
            timeout: 15_000,
        })
        .toBeGreaterThan(0);

    await initializeExplorerFixture(backend, {
        backendState: createDataExplorerBackendState({
            table_shape: { num_rows: 12, num_columns: 2 },
            table_unfiltered_shape: { num_rows: 12, num_columns: 2 },
            row_filters: [],
        }),
    });

    await page.locator('.data-grid-row-cell[data-column-index="1"][data-row-index="0"]').click();
    await backend.notify(DataExplorerMethods.showCellContextMenu);
    await page.getByText('Add Filter').click();
    await page.locator('.drop-down-list-box').click();
    await page.getByText('contains').click();
    await page.getByPlaceholder('value').fill('set');

    const addFilter = backend.waitForNextNotification(DataExplorerMethods.addFilter);
    await page.getByRole('button', { name: 'Apply Filter' }).click();
    expect((await addFilter).params).toMatchObject({
        type: 'addFilter',
        filter: expect.objectContaining({
            filter_type: 'search',
            condition: 'and',
            column_schema: expect.objectContaining({
                column_name: 'species',
                column_index: 1,
            }),
            params: expect.objectContaining({
                search_type: 'contains',
                term: 'set',
            }),
        }),
    });

    await backend.notify(DataExplorerMethods.backendState, {
        state: createDataExplorerBackendState({
            table_shape: { num_rows: 12, num_columns: 2 },
            table_unfiltered_shape: { num_rows: 12, num_columns: 2 },
            row_filters: [
                {
                    filter_id: 'filter-1',
                    filter_type: 'search',
                    column_schema: createDataExplorerSchemaColumn({
                        column_name: 'species',
                        column_index: 1,
                        type_name: 'VARCHAR',
                        type_display: 'string',
                    }),
                    condition: 'and',
                    is_valid: true,
                    params: {
                        search_type: 'contains',
                        term: 'set',
                        case_sensitive: false,
                    },
                },
            ],
        }),
    });

    const updateFilter = backend.waitForNextNotification(DataExplorerMethods.updateFilter);
    await page.locator('.row-filter-widget').click();
    await page.getByPlaceholder('value').fill('vir');
    await page.getByRole('button', { name: 'Apply Filter' }).click();
    expect((await updateFilter).params).toMatchObject({
        type: 'updateFilter',
        filter: expect.objectContaining({
            filter_id: 'filter-1',
            params: expect.objectContaining({
                term: 'vir',
            }),
        }),
    });

    const removeFilter = backend.waitForNextNotification(DataExplorerMethods.removeFilter);
    await page.getByLabel('Clear Filter').click();
    expect((await removeFilter).params).toEqual({
        type: 'removeFilter',
        filterId: 'filter-1',
    });

    await backend.notify(DataExplorerMethods.backendState, {
        state: createDataExplorerBackendState({
            table_shape: { num_rows: 12, num_columns: 2 },
            table_unfiltered_shape: { num_rows: 12, num_columns: 2 },
            row_filters: [
                {
                    filter_id: 'filter-1',
                    filter_type: 'search',
                    column_schema: createDataExplorerSchemaColumn({
                        column_name: 'species',
                        column_index: 1,
                        type_name: 'VARCHAR',
                        type_display: 'string',
                    }),
                    condition: 'and',
                    is_valid: true,
                    params: {
                        search_type: 'contains',
                        term: 'vir',
                        case_sensitive: false,
                    },
                },
            ],
        }),
    });

    const clearFilters = backend.waitForNextNotification(DataExplorerMethods.clearFilters);
    await page.getByLabel('Manage Filters').click();
    await page.getByText('Clear Filters').click();
    expect((await clearFilters).params).toEqual({ type: 'clearFilters' });
});
