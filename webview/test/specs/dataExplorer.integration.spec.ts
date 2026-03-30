import { expect, test } from '@playwright/test';
import {
    DataExplorerMethods,
    createDataExplorerBackendState,
    createDataExplorerSchemaColumn,
} from '../harness/domains';
import { openWebviewPage } from '../harness/page';

async function initializeExplorerFixture(
    backend: Awaited<ReturnType<typeof openWebviewPage>>,
    options: {
        backendState?: ReturnType<typeof createDataExplorerBackendState>;
        columns?: ReturnType<typeof createDataExplorerSchemaColumn>[];
        data?: string[][];
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
    await backend.notify(DataExplorerMethods.data, {
        startRow: 0,
        endRow: 50,
        columnIndices: [0, 1],
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

test('data explorer sends toolbar and schema-expansion notifications', async ({ page }) => {
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
            table_shape: { num_rows: 12, num_columns: 3 },
            table_unfiltered_shape: { num_rows: 12, num_columns: 3 },
            sort_keys: [{ column_index: 0, ascending: true }],
        }),
    });
    await backend.notify(DataExplorerMethods.schema, {
        columns: [
            createDataExplorerSchemaColumn({
                column_name: 'id',
                column_index: 0,
            }),
        ],
    });

    const clearSort = backend.waitForNextNotification(DataExplorerMethods.clearSort);
    await page.getByLabel('Clear sorting').click();
    expect((await clearSort).params).toEqual({});

    const setLayout = backend.waitForNextNotification(DataExplorerMethods.setLayout);
    await page.getByLabel('Change layout').click();
    await page.getByText('Summary on Right').click();
    expect((await setLayout).params).toEqual({
        type: 'setLayout',
        layout: 'SummaryOnRight',
    });

    const moveToNewWindow = backend.waitForNextNotification(DataExplorerMethods.moveToNewWindow);
    await page.getByLabel('Move into New Window').click();
    expect((await moveToNewWindow).params).toEqual({ type: 'moveToNewWindow' });

    const requestSchema = backend.waitForNextNotification(DataExplorerMethods.requestSchema);
    await page.getByLabel('Add Filter').click();
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
    await expect.poll(() => splitterButton.getAttribute('aria-label')).toBe('Collapse Summary');

    const collapseSummary = backend.waitForNextNotification(DataExplorerMethods.setSummaryCollapsed);
    await splitterButton.focus();
    await splitterButton.press('Enter');
    expect((await collapseSummary).params).toEqual({
        type: 'setSummaryCollapsed',
        collapsed: true,
    });
    await expect.poll(() => splitterButton.getAttribute('aria-label')).toBe('Expand Summary');
    await expect.poll(async () => {
        const state = await backend.getState<{
            dataExplorerPanel?: { isSummaryCollapsed?: boolean };
        }>();
        return state?.dataExplorerPanel?.isSummaryCollapsed;
    }).toBe(true);

    const expandSummary = backend.waitForNextNotification(DataExplorerMethods.setSummaryCollapsed);
    await splitterButton.press('Enter');
    expect((await expandSummary).params).toEqual({
        type: 'setSummaryCollapsed',
        collapsed: false,
    });
    await expect.poll(() => splitterButton.getAttribute('aria-label')).toBe('Collapse Summary');
    await expect.poll(async () => {
        const state = await backend.getState<{
            dataExplorerPanel?: { isSummaryCollapsed?: boolean };
        }>();
        return state?.dataExplorerPanel?.isSummaryCollapsed;
    }).toBe(false);
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
    await expect.poll(async () => {
        const state = await backend.getState<{
            dataExplorerPanel?: { layout?: string };
        }>();
        return state?.dataExplorerPanel?.layout;
    }).toBe('SummaryOnRight');

    const switchToLeft = backend.waitForNextNotification(DataExplorerMethods.setLayout);
    await splitterSash.dblclick({ position: { x: 1, y: 64 } });
    expect((await switchToLeft).params).toEqual({
        type: 'setLayout',
        layout: 'SummaryOnLeft',
    });
    await expect.poll(async () => {
        const state = await backend.getState<{
            dataExplorerPanel?: { layout?: string };
        }>();
        return state?.dataExplorerPanel?.layout;
    }).toBe('SummaryOnLeft');
});

test('data explorer bridges convert-to-code, file options, and focus changes', async ({ page }) => {
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
    });
    await expect(page.getByRole('dialog', { name: 'File Options' })).toBeVisible();

    const applyFileOptions = backend.waitForNextNotification(DataExplorerMethods.applyFileOptions);
    await page.getByRole('checkbox').click();
    await page.getByRole('button', { name: 'Apply' }).click();
    expect((await applyFileOptions).params).toEqual({
        type: 'applyFileOptions',
        hasHeaderRow: true,
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

    const focusIn = backend.waitForNextNotification(DataExplorerMethods.focusChanged);
    await page.getByLabel('Clear sorting').focus();
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

test('data explorer syncs panel state, metadata, status indicators, and closed overlays', async ({ page }) => {
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
    await expect.poll(async () => {
        const state = await backend.getState<{
            dataExplorerPanel?: { layout?: string };
        }>();
        return state?.dataExplorerPanel?.layout;
    }).toBe('SummaryOnRight');

    await backend.notify(DataExplorerMethods.summaryCollapsedChanged, {
        collapsed: true,
    });
    await expect.poll(async () => {
        const state = await backend.getState<{
            dataExplorerPanel?: { isSummaryCollapsed?: boolean };
        }>();
        return state?.dataExplorerPanel?.isSummaryCollapsed;
    }).toBe(true);
    await expect(page.getByLabel('Expand Summary')).toBeVisible();

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
    });

    const profileRequest = backend.waitForNextNotification(DataExplorerMethods.requestColumnProfiles);
    await page.locator('.summary-panel [title="Expand"]').first().click();
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
    });
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
