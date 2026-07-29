const instances = new Map();
const STYLE_ID = 'supervisor-inline-data-explorer-styles';
const ROW_HEIGHT = 26;
const HEADER_HEIGHT = 42;
const ROW_HEADER_WIDTH = 55;
const COLUMN_WIDTH = 180;
const OVERSCAN_FACTOR = 3;
const MAX_REQUEST_ROWS = 200;
const MAX_REQUEST_COLUMNS = 50;

function ensureStyles() {
    if (document.getElementById(STYLE_ID)) {
        return;
    }
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
        .supervisor-inline-data-explorer{position:relative;border:1px solid var(--vscode-panel-border);border-radius:5px;overflow:hidden;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font:var(--vscode-font-size) var(--vscode-font-family)}
        .supervisor-inline-data-explorer *{box-sizing:border-box}.supervisor-inline-data-explorer header{min-height:34px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:4px 6px 4px 9px;border-bottom:1px solid var(--vscode-panel-border);background:var(--vscode-editorGroupHeader-tabsBackground,var(--vscode-sideBar-background))}
        .supervisor-inline-status{display:flex;gap:10px;align-items:baseline;min-width:0}.supervisor-inline-status strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.supervisor-inline-shape{color:var(--vscode-descriptionForeground);white-space:nowrap;font-size:12px}
        .supervisor-inline-actions{display:flex;gap:2px;flex-shrink:0}.supervisor-inline-button{min-height:24px;color:var(--vscode-button-secondaryForeground,var(--vscode-foreground));background:transparent;border:0;border-radius:3px;padding:2px 7px;cursor:pointer;font:inherit}.supervisor-inline-button:hover{background:var(--vscode-toolbar-hoverBackground,var(--vscode-button-secondaryHoverBackground))}.supervisor-inline-button:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:-1px}
        .supervisor-inline-viewport{height:min(320px,50vh);min-height:120px;overflow:auto;outline:none;position:relative}.supervisor-inline-viewport:focus-visible{box-shadow:inset 0 0 0 1px var(--vscode-focusBorder)}
        .supervisor-inline-canvas{position:relative;min-width:100%;min-height:100%}.supervisor-inline-data-explorer table{position:absolute;border-collapse:separate;border-spacing:0;table-layout:fixed;font-family:var(--vscode-editor-font-family);font-size:var(--vscode-editor-font-size,var(--vscode-font-size));font-variant-numeric:tabular-nums;background:var(--vscode-editor-background)}
        .supervisor-inline-data-explorer th,.supervisor-inline-data-explorer td{height:${ROW_HEIGHT}px;padding:3px 8px;border-right:1px solid var(--vscode-panel-border);border-bottom:1px solid var(--vscode-panel-border);text-align:left;white-space:nowrap;width:${COLUMN_WIDTH}px;min-width:${COLUMN_WIDTH}px;max-width:${COLUMN_WIDTH}px;overflow:hidden;text-overflow:ellipsis}
        .supervisor-inline-data-explorer thead th{height:${HEADER_HEIGHT}px;background:var(--vscode-editorGroupHeader-tabsBackground,var(--vscode-editor-background));font-weight:600}.supervisor-inline-data-explorer th small{display:block;color:var(--vscode-descriptionForeground);font-weight:normal;font-size:10px}.supervisor-inline-data-explorer tbody tr:hover td{background:var(--vscode-list-hoverBackground)}
        .supervisor-inline-data-explorer .supervisor-inline-row-index{width:${ROW_HEADER_WIDTH}px;min-width:${ROW_HEADER_WIDTH}px;max-width:${ROW_HEADER_WIDTH}px;text-align:right;color:var(--vscode-descriptionForeground);background:var(--vscode-editorGroupHeader-tabsBackground,var(--vscode-editor-background));font-size:11px;font-weight:normal}
        .supervisor-inline-sort{cursor:pointer}.supervisor-inline-sort-indicator{float:right;color:var(--vscode-descriptionForeground)}
        .supervisor-inline-null{color:var(--vscode-descriptionForeground);font-style:italic}.supervisor-inline-empty{display:flex;position:absolute;inset:0;align-items:center;justify-content:center;padding:16px;color:var(--vscode-descriptionForeground);text-align:center}
        .supervisor-inline-detail{padding:5px 8px;color:var(--vscode-descriptionForeground);font-size:11px;background:var(--vscode-editorGroupHeader-tabsBackground,var(--vscode-editor-background))}
        .supervisor-inline-progress{display:none;position:absolute;z-index:4;top:33px;left:0;width:100%;height:2px;overflow:hidden;background:color-mix(in srgb,var(--vscode-progressBar-background) 24%,transparent)}.supervisor-inline-progress::after{content:'';display:block;width:35%;height:100%;background:var(--vscode-progressBar-background);animation:supervisor-inline-progress 1.2s ease-in-out infinite}
        .supervisor-inline-data-explorer[data-state=loading] .supervisor-inline-progress,.supervisor-inline-data-explorer[data-state=updating] .supervisor-inline-progress{display:block}.supervisor-inline-data-explorer[data-state=error] .supervisor-inline-status{color:var(--vscode-errorForeground)}.supervisor-inline-data-explorer[data-state=error] .supervisor-inline-viewport{display:none}.supervisor-inline-data-explorer[data-state=error]{border-color:var(--vscode-inputValidation-errorBorder,var(--vscode-errorForeground))}
        @keyframes supervisor-inline-progress{from{transform:translateX(-110%)}to{transform:translateX(320%)}}
        @media(max-width:480px){.supervisor-inline-data-explorer header{align-items:flex-start;flex-direction:column;gap:3px}.supervisor-inline-actions{align-self:flex-end}.supervisor-inline-progress{top:61px}}
        @media(prefers-reduced-motion:reduce){.supervisor-inline-progress::after{width:100%;animation:none}}
    `;
    document.head.appendChild(style);
}

function text(element, value) {
    element.textContent = value === undefined || value === null ? '' : String(value);
}

function button(label, title, action) {
    const element = document.createElement('button');
    element.className = 'supervisor-inline-button';
    element.type = 'button';
    element.title = title;
    element.setAttribute('aria-label', title);
    text(element, label);
    element.addEventListener('click', action);
    return element;
}

function decodeValue(value) {
    if (typeof value !== 'number') {
        return { value, special: value === null || value === undefined };
    }
    const specialValues = new Map([
        [0, 'NULL'],
        [1, 'NA'],
        [2, 'NaN'],
        [3, 'NaT'],
        [4, 'None'],
        [10, 'INF'],
        [11, '-INF'],
    ]);
    return specialValues.has(value)
        ? { value: specialValues.get(value), special: true }
        : { value, special: false };
}

function nextRequestId(state) {
    state.requestSequence += 1;
    return `${state.outputId}:${state.requestSequence}`;
}

function visibleWindow(state) {
    const shape = state.shape ?? state.payload.shape ?? {};
    const totalRows = Math.max(0, shape.rows ?? MAX_REQUEST_ROWS);
    const totalColumns = Math.max(0, shape.columns ?? MAX_REQUEST_COLUMNS);
    const visibleRows = Math.max(
        1,
        Math.ceil(state.viewport.clientHeight / ROW_HEIGHT),
    );
    const visibleColumns = Math.max(
        1,
        Math.ceil(state.viewport.clientWidth / COLUMN_WIDTH),
    );
    const firstVisibleRow = Math.max(
        0,
        Math.floor(
            (state.viewport.scrollTop - HEADER_HEIGHT) / ROW_HEIGHT,
        ),
    );
    const firstVisibleColumn = Math.max(
        0,
        Math.floor(
            (state.viewport.scrollLeft - ROW_HEADER_WIDTH) / COLUMN_WIDTH,
        ),
    );
    const rowOverscan = visibleRows * (OVERSCAN_FACTOR - 1);
    const columnOverscan = visibleColumns * (OVERSCAN_FACTOR - 1);
    const firstRow = Math.max(0, firstVisibleRow - Math.floor(rowOverscan / 2));
    const firstColumn = Math.max(
        0,
        firstVisibleColumn - Math.floor(columnOverscan / 2),
    );
    return {
        firstRow,
        numRows: Math.min(
            MAX_REQUEST_ROWS,
            totalRows - firstRow,
            visibleRows + rowOverscan,
        ),
        firstColumn,
        numColumns: Math.min(
            MAX_REQUEST_COLUMNS,
            totalColumns - firstColumn,
            visibleColumns + columnOverscan,
        ),
    };
}

function requestWindow(state, force = false, sortKeys) {
    if (!state.payload || typeof state.payload.comm_id !== 'string') {
        return;
    }
    const window = visibleWindow(state);
    const signature = JSON.stringify({ ...window, sortKeys });
    if (!force && signature === state.windowSignature) {
        return;
    }
    state.windowSignature = signature;
    state.requestId = nextRequestId(state);
    state.root.dataset.state = state.hasData ? 'updating' : 'loading';
    state.root.setAttribute('aria-busy', 'true');
    state.context.postMessage({
        type: sortKeys ? 'inlineDataExplorer/sort' : 'inlineDataExplorer/load',
        requestId: state.requestId,
        outputId: state.outputId,
        commId: state.payload.comm_id,
        ...window,
        sortKeys,
    });
}

function renderTable(state, message) {
    const { root, status, viewport, canvas, table, empty, detail } = state;
    state.shape = message.shape ?? state.shape ?? state.payload.shape ?? {};
    state.hasData = true;
    status.replaceChildren();
    table.replaceChildren();
    empty.replaceChildren();
    empty.hidden = true;

    const title = document.createElement('strong');
    text(title, message.title || state.payload.title || 'Data Explorer');
    const size = document.createElement('span');
    size.className = 'supervisor-inline-shape';
    text(
        size,
        `${state.shape.rows ?? 0} rows × ${state.shape.columns ?? 0} columns`,
    );
    status.append(title, size);

    canvas.style.width = `${ROW_HEADER_WIDTH + (state.shape.columns ?? 0) * COLUMN_WIDTH}px`;
    canvas.style.height = `${HEADER_HEIGHT + (state.shape.rows ?? 0) * ROW_HEIGHT}px`;
    table.style.left = `${(message.firstColumn ?? 0) * COLUMN_WIDTH}px`;
    table.style.top = `${(message.firstRow ?? 0) * ROW_HEIGHT}px`;
    table.style.width = `${ROW_HEADER_WIDTH + (message.columns?.length ?? 0) * COLUMN_WIDTH}px`;

    const sortKeys = new Map(
        (message.sortKeys ?? []).map(sortKey => [sortKey.columnIndex, sortKey]),
    );
    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    const rowIndexHeader = document.createElement('th');
    rowIndexHeader.className = 'supervisor-inline-row-index';
    rowIndexHeader.scope = 'col';
    text(rowIndexHeader, '#');
    headRow.appendChild(rowIndexHeader);
    for (let index = 0; index < (message.columns ?? []).length; index++) {
        const column = message.columns[index];
        const columnIndex =
            message.columnIndices?.[index] ?? (message.firstColumn ?? 0) + index;
        const cell = document.createElement('th');
        cell.scope = 'col';
        cell.className = 'supervisor-inline-sort';
        const name = document.createElement('span');
        const type = document.createElement('small');
        const sort = sortKeys.get(columnIndex);
        text(name, column.name);
        text(type, column.type);
        if (sort) {
            const indicator = document.createElement('span');
            indicator.className = 'supervisor-inline-sort-indicator';
            text(indicator, sort.ascending ? '↑' : '↓');
            name.appendChild(indicator);
        }
        cell.append(name, type);
        cell.addEventListener('click', () => {
            const nextSortKeys = sort
                ? sort.ascending
                    ? [{ columnIndex, ascending: false }]
                    : []
                : [{ columnIndex, ascending: true }];
            state.windowSignature = '';
            requestWindow(state, true, nextSortKeys);
        });
        headRow.appendChild(cell);
    }
    head.appendChild(headRow);

    const body = document.createElement('tbody');
    const columns = message.values ?? [];
    const rowCount = columns.reduce(
        (maximum, column) => Math.max(maximum, column.length),
        0,
    );
    for (let row = 0; row < rowCount; row++) {
        const rowElement = document.createElement('tr');
        const rowIndex = document.createElement('th');
        rowIndex.className = 'supervisor-inline-row-index';
        rowIndex.scope = 'row';
        text(
            rowIndex,
            message.rowLabels?.[row] ?? (message.firstRow ?? 0) + row,
        );
        rowElement.appendChild(rowIndex);
        for (const column of columns) {
            const cell = document.createElement('td');
            const decoded = decodeValue(column[row]);
            text(cell, decoded.value);
            if (decoded.special) {
                cell.className = 'supervisor-inline-null';
            } else {
                cell.title = String(decoded.value ?? '');
            }
            rowElement.appendChild(cell);
        }
        body.appendChild(rowElement);
    }
    table.append(head, body);

    if ((state.shape.columns ?? 0) === 0 || (state.shape.rows ?? 0) === 0) {
        table.replaceChildren();
        empty.hidden = false;
        text(empty, 'No rows to display.');
    }

    const lastRow = Math.min(
        state.shape.rows ?? 0,
        (message.firstRow ?? 0) + rowCount,
    );
    const lastColumn = Math.min(
        state.shape.columns ?? 0,
        (message.firstColumn ?? 0) + (message.columns?.length ?? 0),
    );
    text(
        detail,
        `Rows ${message.firstRow ?? 0}–${Math.max(message.firstRow ?? 0, lastRow - 1)}, columns ${message.firstColumn ?? 0}–${Math.max(message.firstColumn ?? 0, lastColumn - 1)}`,
    );
    root.dataset.state = 'ready';
    root.setAttribute('aria-busy', 'false');
    viewport.setAttribute(
        'aria-label',
        `${message.title || state.payload.title || 'Data Explorer'}, ${state.shape.rows ?? 0} rows by ${state.shape.columns ?? 0} columns`,
    );
}

function renderError(state, message) {
    state.root.dataset.state = 'error';
    state.root.setAttribute('aria-busy', 'false');
    state.table.replaceChildren();
    text(
        state.status,
        message.message || 'Data Explorer backend is unavailable.',
    );
    text(state.detail, 'Re-run the notebook cell to reconnect this output.');
}

export const activate = (context) => {
    context.onDidReceiveMessage(message => {
        if (!message || typeof message.requestId !== 'string') {
            return;
        }
        const state = [...instances.values()].find(
            candidate => candidate.requestId === message.requestId,
        );
        if (!state) {
            return;
        }
        if (message.type === 'inlineDataExplorer/data') {
            renderTable(state, message);
        } else if (message.type === 'inlineDataExplorer/error') {
            renderError(state, message);
        }
    });

    return {
        renderOutputItem(outputItem, element) {
            ensureStyles();
            let payload;
            try {
                payload = outputItem.json();
            } catch {
                payload = {};
            }
            if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
                payload = {};
            }
            const outputId =
                typeof outputItem.id === 'string'
                    ? outputItem.id
                    : `inline-data-explorer-${Date.now()}-${Math.random().toString(16).slice(2)}`;
            const root = document.createElement('section');
            root.className = 'supervisor-inline-data-explorer';
            root.dataset.state = 'loading';
            root.setAttribute('aria-label', 'Inline Data Explorer');
            root.setAttribute('aria-busy', 'true');

            const toolbar = document.createElement('header');
            const status = document.createElement('div');
            status.className = 'supervisor-inline-status';
            status.setAttribute('role', 'status');
            status.setAttribute('aria-live', 'polite');
            text(status, 'Loading Data Explorer…');
            const actions = document.createElement('div');
            actions.className = 'supervisor-inline-actions';
            const viewport = document.createElement('div');
            viewport.className = 'supervisor-inline-viewport';
            viewport.tabIndex = 0;
            viewport.setAttribute('role', 'region');
            const canvas = document.createElement('div');
            canvas.className = 'supervisor-inline-canvas';
            const table = document.createElement('table');
            table.setAttribute('aria-label', 'Data preview');
            const empty = document.createElement('div');
            empty.className = 'supervisor-inline-empty';
            empty.hidden = true;
            canvas.append(table, empty);
            viewport.appendChild(canvas);
            const detail = document.createElement('div');
            detail.className = 'supervisor-inline-detail';
            const progress = document.createElement('div');
            progress.className = 'supervisor-inline-progress';
            progress.setAttribute('aria-hidden', 'true');

            const state = {
                context,
                requestId: '',
                requestSequence: 0,
                windowSignature: '',
                outputId,
                payload,
                root,
                status,
                viewport,
                canvas,
                table,
                empty,
                detail,
                shape: payload.shape,
                hasData: false,
                scrollFrame: undefined,
            };
            actions.append(
                button('Refresh', 'Refresh inline data', () => {
                    state.windowSignature = '';
                    requestWindow(state, true);
                }),
                button('Open', 'Open full Data Explorer', () =>
                    context.postMessage({
                        type: 'inlineDataExplorer/open',
                        requestId: nextRequestId(state),
                        outputId,
                        commId: payload.comm_id,
                    }),
                ),
            );
            toolbar.append(status, actions);
            root.append(toolbar, progress, viewport, detail);
            element.replaceChildren(root);
            instances.set(outputId, state);

            viewport.addEventListener('scroll', () => {
                if (state.scrollFrame !== undefined) {
                    cancelAnimationFrame(state.scrollFrame);
                }
                state.scrollFrame = requestAnimationFrame(() => {
                    state.scrollFrame = undefined;
                    requestWindow(state);
                });
            });

            if (typeof payload.comm_id !== 'string') {
                renderError(state, {
                    message: 'Invalid inline Data Explorer output.',
                });
                return;
            }
            requestWindow(state, true);
        },
        disposeOutputItem(outputId) {
            const state = instances.get(outputId);
            if (!state) {
                return;
            }
            if (state.scrollFrame !== undefined) {
                cancelAnimationFrame(state.scrollFrame);
            }
            context.postMessage({
                type: 'inlineDataExplorer/dispose',
                outputId,
                commId: state.payload.comm_id,
            });
            instances.delete(outputId);
        },
    };
};
