const instances = new Map();
const STYLE_ID = 'supervisor-inline-data-explorer-styles';

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
        .supervisor-inline-actions{display:flex;gap:2px;flex-shrink:0}.supervisor-inline-button{min-height:24px;color:var(--vscode-button-secondaryForeground,var(--vscode-foreground));background:transparent;border:0;border-radius:3px;padding:2px 7px;cursor:pointer;font:inherit}.supervisor-inline-button:hover{background:var(--vscode-toolbar-hoverBackground,var(--vscode-button-secondaryHoverBackground))}.supervisor-inline-button:active{background:var(--vscode-toolbar-activeBackground,var(--vscode-button-secondaryHoverBackground))}.supervisor-inline-button:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:-1px}
        .supervisor-inline-viewport{max-height:min(320px,50vh);overflow:auto;outline:none}.supervisor-inline-viewport:focus-visible{box-shadow:inset 0 0 0 1px var(--vscode-focusBorder)}.supervisor-inline-data-explorer table{border-collapse:separate;border-spacing:0;min-width:100%;font-family:var(--vscode-editor-font-family);font-size:var(--vscode-editor-font-size,var(--vscode-font-size));font-variant-numeric:tabular-nums}
        .supervisor-inline-data-explorer th,.supervisor-inline-data-explorer td{height:26px;padding:3px 8px;border-right:1px solid var(--vscode-panel-border);border-bottom:1px solid var(--vscode-panel-border);text-align:left;white-space:nowrap;max-width:320px;overflow:hidden;text-overflow:ellipsis}.supervisor-inline-data-explorer th{position:sticky;top:0;background:var(--vscode-editorGroupHeader-tabsBackground,var(--vscode-editor-background));z-index:2;font-weight:600}.supervisor-inline-data-explorer th small{display:block;color:var(--vscode-descriptionForeground);font-weight:normal;font-size:10px}.supervisor-inline-data-explorer tbody tr:hover td{background:var(--vscode-list-hoverBackground)}
        .supervisor-inline-data-explorer .supervisor-inline-row-index{position:sticky;left:0;z-index:1;width:1%;min-width:42px;max-width:72px;text-align:right;color:var(--vscode-descriptionForeground);background:var(--vscode-editorGroupHeader-tabsBackground,var(--vscode-editor-background));font-family:var(--vscode-editor-font-family);font-size:11px;font-weight:normal}.supervisor-inline-data-explorer thead .supervisor-inline-row-index{z-index:3}
        .supervisor-inline-null{color:var(--vscode-descriptionForeground);font-style:italic}.supervisor-inline-empty{display:flex;min-height:92px;align-items:center;justify-content:center;padding:16px;color:var(--vscode-descriptionForeground);text-align:center}
        .supervisor-inline-detail{padding:5px 8px;color:var(--vscode-descriptionForeground);font-size:11px;background:var(--vscode-editorGroupHeader-tabsBackground,var(--vscode-editor-background))}.supervisor-inline-detail:empty{display:none}
        .supervisor-inline-progress{display:none;position:absolute;z-index:4;top:33px;left:0;width:100%;height:2px;overflow:hidden;background:color-mix(in srgb,var(--vscode-progressBar-background) 24%,transparent)}.supervisor-inline-progress::after{content:'';display:block;width:35%;height:100%;background:var(--vscode-progressBar-background);animation:supervisor-inline-progress 1.2s ease-in-out infinite}
        .supervisor-inline-data-explorer[data-state=loading] .supervisor-inline-progress{display:block}.supervisor-inline-data-explorer[data-state=loading] .supervisor-inline-viewport{opacity:.55;pointer-events:none}.supervisor-inline-data-explorer[data-state=error] .supervisor-inline-status{color:var(--vscode-errorForeground)}.supervisor-inline-data-explorer[data-state=error] .supervisor-inline-viewport{display:none}.supervisor-inline-data-explorer[data-state=error]{border-color:var(--vscode-inputValidation-errorBorder,var(--vscode-errorForeground))}
        body.vscode-high-contrast .supervisor-inline-data-explorer,body.vscode-high-contrast-light .supervisor-inline-data-explorer{border-color:var(--vscode-contrastBorder,var(--vscode-panel-border))}
        @keyframes supervisor-inline-progress{from{transform:translateX(-110%)}to{transform:translateX(320%)}}
        @media(max-width:480px){.supervisor-inline-data-explorer header{align-items:flex-start;flex-direction:column;gap:3px}.supervisor-inline-actions{align-self:flex-end}.supervisor-inline-progress{top:61px}.supervisor-inline-shape{font-size:11px}}
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

function renderTable(state, message) {
    const { root, status, viewport, table, empty, detail } = state;
    status.replaceChildren();
    table.replaceChildren();
    detail.replaceChildren();
    empty.replaceChildren();
    empty.hidden = true;

    const title = document.createElement('strong');
    text(title, message.title || state.payload.title || 'Data Explorer');
    const shape = message.shape || state.payload.shape || {};
    const size = document.createElement('span');
    size.className = 'supervisor-inline-shape';
    text(size, `${shape.rows ?? 0} rows × ${shape.columns ?? 0} columns`);
    status.append(title, size);

    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    const rowIndexHeader = document.createElement('th');
    rowIndexHeader.className = 'supervisor-inline-row-index';
    rowIndexHeader.scope = 'col';
    rowIndexHeader.setAttribute('aria-label', 'Row number');
    text(rowIndexHeader, '#');
    headRow.appendChild(rowIndexHeader);
    for (const column of message.columns || []) {
        const cell = document.createElement('th');
        cell.scope = 'col';
        const name = document.createElement('span');
        const type = document.createElement('small');
        text(name, column.name);
        text(type, column.type);
        cell.append(name, type);
        headRow.appendChild(cell);
    }
    head.appendChild(headRow);

    const body = document.createElement('tbody');
    const columns = message.values || [];
    const rowCount = columns.reduce((max, column) => Math.max(max, column.length), 0);
    for (let row = 0; row < rowCount; row++) {
        const rowElement = document.createElement('tr');
        const rowIndex = document.createElement('th');
        rowIndex.className = 'supervisor-inline-row-index';
        rowIndex.scope = 'row';
        text(rowIndex, row + 1);
        rowElement.appendChild(rowIndex);
        for (const column of columns) {
            const cell = document.createElement('td');
            const value = column[row];
            text(cell, value);
            if (value === null || value === undefined) {
                cell.className = 'supervisor-inline-null';
                text(cell, value === null ? 'NULL' : 'NA');
            } else {
                cell.title = String(value);
            }
            rowElement.appendChild(cell);
        }
        body.appendChild(rowElement);
    }
    table.append(head, body);

    if ((message.columns || []).length === 0 || rowCount === 0) {
        table.replaceChildren();
        empty.hidden = false;
        text(empty, 'No rows to display.');
    }

    if (message.truncated) {
        text(detail, 'Showing the first 100 rows and 50 columns. Open the full Data Explorer for all data.');
    }
    root.dataset.state = 'ready';
    root.setAttribute('aria-busy', 'false');
    viewport.setAttribute('aria-label', `${message.title || state.payload.title || 'Data Explorer'}, ${shape.rows ?? 0} rows by ${shape.columns ?? 0} columns`);
}

function renderError(state, message) {
    state.root.dataset.state = 'error';
    state.root.setAttribute('aria-busy', 'false');
    state.table.replaceChildren();
    text(state.status, message.message || 'Data Explorer backend is unavailable.');
    text(state.detail, 'Re-run the notebook cell to reconnect this output.');
}

export const activate = (context) => {
    context.onDidReceiveMessage(message => {
        if (!message || typeof message.requestId !== 'string') {
            return;
        }
        const state = [...instances.values()].find(candidate => candidate.requestId === message.requestId);
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
            const outputId = typeof outputItem.id === 'string'
                ? outputItem.id
                : `inline-data-explorer-${Date.now()}-${Math.random().toString(16).slice(2)}`;
            const requestId = `${outputId}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
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
            status.setAttribute('aria-atomic', 'true');
            text(status, 'Loading Data Explorer…');
            const actions = document.createElement('div');
            actions.className = 'supervisor-inline-actions';
            actions.append(
                button('Refresh', 'Refresh inline preview', () => {
                    root.dataset.state = 'loading';
                    root.setAttribute('aria-busy', 'true');
                    text(status, 'Refreshing Data Explorer…');
                    context.postMessage({
                        type: 'inlineDataExplorer/load', requestId, outputId, commId: payload.comm_id,
                    });
                }),
                button('Open', 'Open full Data Explorer', () => context.postMessage({
                    type: 'inlineDataExplorer/open', requestId, outputId, commId: payload.comm_id,
                })),
            );
            toolbar.append(status, actions);

            const viewport = document.createElement('div');
            viewport.className = 'supervisor-inline-viewport';
            viewport.tabIndex = 0;
            viewport.setAttribute('role', 'region');
            viewport.setAttribute('aria-label', 'Inline data preview');
            const table = document.createElement('table');
            table.setAttribute('aria-label', 'Data preview');
            viewport.appendChild(table);
            const empty = document.createElement('div');
            empty.className = 'supervisor-inline-empty';
            empty.hidden = true;
            viewport.appendChild(empty);
            const detail = document.createElement('div');
            detail.className = 'supervisor-inline-detail';
            const progress = document.createElement('div');
            progress.className = 'supervisor-inline-progress';
            progress.setAttribute('aria-hidden', 'true');
            root.append(toolbar, progress, viewport, detail);
            element.replaceChildren(root);

            const state = { requestId, outputId, payload, root, status, viewport, table, empty, detail };
            instances.set(outputId, state);
            if (!payload || typeof payload.comm_id !== 'string') {
                renderError(state, { message: 'Invalid inline Data Explorer output.' });
                return;
            }
            context.postMessage({
                type: 'inlineDataExplorer/load', requestId, outputId, commId: payload.comm_id,
            });
        },
        disposeOutputItem(outputId) {
            const state = instances.get(outputId);
            if (!state) {
                return;
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
