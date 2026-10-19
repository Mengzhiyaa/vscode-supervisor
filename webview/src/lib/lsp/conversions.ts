import type * as Lsp from 'vscode-languageserver-protocol';
import { monaco } from '$lib/monaco/setup';

export function position(value: monaco.Position): Lsp.Position {
    return { line: value.lineNumber - 1, character: value.column - 1 };
}

export function lspRange(value: monaco.IRange): Lsp.Range {
    return {
        start: { line: value.startLineNumber - 1, character: value.startColumn - 1 },
        end: { line: value.endLineNumber - 1, character: value.endColumn - 1 },
    };
}

export function range(value: Lsp.Range): monaco.Range {
    return new monaco.Range(
        value.start.line + 1,
        value.start.character + 1,
        value.end.line + 1,
        value.end.character + 1,
    );
}

export function languageSelector(
    value: Lsp.DocumentSelector | null | undefined,
): monaco.languages.LanguageSelector {
    if (value == null) {
        return '*';
    }
    const filters: (string | monaco.languages.LanguageFilter)[] = [];
    for (const filter of value) {
        if (typeof filter === 'string') {
            filters.push(filter);
            continue;
        }
        // Console models are text documents, never notebook cells.
        if ('notebook' in filter) {
            continue;
        }
        const pattern = filter.pattern;
        filters.push({
            language: filter.language,
            scheme: filter.scheme,
            pattern:
                typeof pattern === 'object'
                    ? {
                          base: monaco.Uri.parse(
                              typeof pattern.baseUri === 'string'
                                  ? pattern.baseUri
                                  : pattern.baseUri.uri,
                          ).fsPath,
                          pattern: pattern.pattern,
                      }
                    : pattern,
        });
    }
    return filters;
}

export function markdown(value: string | Lsp.MarkupContent): monaco.IMarkdownString {
    return {
        value:
            typeof value === 'string'
                ? value
                : value.kind === 'plaintext'
                  ? value.value.replace(/[\\`*_{}\[\]()#+.!<>|-]/g, '\\$&')
                  : value.value,
        isTrusted: false,
    };
}

export function hoverContents(value: Lsp.Hover['contents']): monaco.IMarkdownString[] {
    const entries = Array.isArray(value) ? value : [value];
    return entries.map((entry) => {
        if (typeof entry === 'string' || 'kind' in entry) {
            return markdown(entry);
        }
        return { value: `\`\`\`${entry.language}\n${entry.value}\n\`\`\``, isTrusted: false };
    });
}

const completionKinds = [
    monaco.languages.CompletionItemKind.Text,
    monaco.languages.CompletionItemKind.Method,
    monaco.languages.CompletionItemKind.Function,
    monaco.languages.CompletionItemKind.Constructor,
    monaco.languages.CompletionItemKind.Field,
    monaco.languages.CompletionItemKind.Variable,
    monaco.languages.CompletionItemKind.Class,
    monaco.languages.CompletionItemKind.Interface,
    monaco.languages.CompletionItemKind.Module,
    monaco.languages.CompletionItemKind.Property,
    monaco.languages.CompletionItemKind.Unit,
    monaco.languages.CompletionItemKind.Value,
    monaco.languages.CompletionItemKind.Enum,
    monaco.languages.CompletionItemKind.Keyword,
    monaco.languages.CompletionItemKind.Snippet,
    monaco.languages.CompletionItemKind.Color,
    monaco.languages.CompletionItemKind.File,
    monaco.languages.CompletionItemKind.Reference,
    monaco.languages.CompletionItemKind.Folder,
    monaco.languages.CompletionItemKind.EnumMember,
    monaco.languages.CompletionItemKind.Constant,
    monaco.languages.CompletionItemKind.Struct,
    monaco.languages.CompletionItemKind.Event,
    monaco.languages.CompletionItemKind.Operator,
    monaco.languages.CompletionItemKind.TypeParameter,
];

export interface LspCompletion extends monaco.languages.CompletionItem {
    lspItem: Lsp.CompletionItem;
    version: number;
}

export function completion(
    item: Lsp.CompletionItem,
    model: monaco.editor.ITextModel,
    at: monaco.Position,
): LspCompletion {
    const word = model.getWordUntilPosition(at);
    const edit = item.textEdit;
    return {
        label: item.labelDetails
            ? {
                  label: item.label,
                  detail: item.labelDetails.detail,
                  description: item.labelDetails.description,
              }
            : item.label,
        kind: completionKinds[(item.kind ?? 1) - 1] ?? monaco.languages.CompletionItemKind.Text,
        insertText: edit?.newText ?? item.insertText ?? item.label,
        range: edit
            ? 'range' in edit
                ? range(edit.range)
                : { insert: range(edit.insert), replace: range(edit.replace) }
            : new monaco.Range(at.lineNumber, word.startColumn, at.lineNumber, word.endColumn),
        insertTextRules:
            (item.insertTextFormat === 2
                ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                : 0) |
            (item.insertTextMode === 1
                ? monaco.languages.CompletionItemInsertTextRule.KeepWhitespace
                : 0),
        detail: item.detail,
        documentation: item.documentation ? markdown(item.documentation) : undefined,
        sortText: item.sortText,
        filterText: item.filterText,
        preselect: item.preselect,
        commitCharacters: item.commitCharacters,
        tags:
            item.tags?.includes(1) || item.deprecated
                ? [monaco.languages.CompletionItemTag.Deprecated]
                : undefined,
        additionalTextEdits: item.additionalTextEdits?.map((edit) => ({
            range: range(edit.range),
            text: edit.newText,
        })),
        lspItem: item,
        version: model.getVersionId(),
    };
}

export function marker(diagnostic: Lsp.Diagnostic): monaco.editor.IMarkerData {
    const severity = [
        monaco.MarkerSeverity.Error,
        monaco.MarkerSeverity.Warning,
        monaco.MarkerSeverity.Info,
        monaco.MarkerSeverity.Hint,
    ][(diagnostic.severity ?? 1) - 1];
    return {
        ...range(diagnostic.range),
        severity: severity ?? monaco.MarkerSeverity.Error,
        message:
            typeof diagnostic.message === 'string' ? diagnostic.message : diagnostic.message.value,
        source: diagnostic.source,
        code: diagnostic.code === undefined ? undefined : String(diagnostic.code),
        tags: diagnostic.tags?.map((tag) =>
            tag === 1 ? monaco.MarkerTag.Unnecessary : monaco.MarkerTag.Deprecated,
        ),
        relatedInformation: diagnostic.relatedInformation?.map((info) => ({
            ...range(info.location.range),
            resource: monaco.Uri.parse(info.location.uri),
            message: info.message,
        })),
    };
}
