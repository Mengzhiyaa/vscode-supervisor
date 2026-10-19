import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

/** Extract static payload keys whose values call vscode.l10n.t(). */
export function collectHostLocalizationKeys(sourceText) {
    const sourceFile = ts.createSourceFile(
        'webviewLocalization.ts',
        sourceText,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
    );
    const keys = new Set();

    function visit(node) {
        if (
            ts.isPropertyAssignment(node) &&
            (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
            ts.isCallExpression(node.initializer)
        ) {
            const callee = node.initializer.expression;
            if (
                ts.isPropertyAccessExpression(callee) &&
                callee.name.text === 't' &&
                ts.isPropertyAccessExpression(callee.expression) &&
                callee.expression.name.text === 'l10n' &&
                ts.isIdentifier(callee.expression.expression) &&
                callee.expression.expression.text === 'vscode'
            ) {
                keys.add(node.name.text);
            }
        }
        ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    return keys;
}
