import * as vscode from 'vscode';

export type WebviewLocalizationMessages = Readonly<Record<string, string>>;

/**
 * Shared localization payload for extension-owned Webviews. Components use
 * stable semantic keys while vscode.l10n remains the single translation
 * authority in the extension host.
 */
export function createWebviewLocalizationMessages(): WebviewLocalizationMessages {
    return {
        'common.cancel': vscode.l10n.t('Cancel'),
        'common.close': vscode.l10n.t('Close'),
        'common.loading': vscode.l10n.t('Loading'),
        'common.openInBrowser': vscode.l10n.t('Open in Browser'),
        'common.openInEditorTab': vscode.l10n.t('Open in Editor Tab'),
        'common.openInNewWindow': vscode.l10n.t('Open in New Window'),
        'common.selectWhereToOpen': vscode.l10n.t('Select where to open'),
        'console.hideTraceback': vscode.l10n.t('Hide Traceback'),
        'console.showTraceback': vscode.l10n.t('Show Traceback'),
        'console.suggestionUnavailable': vscode.l10n.t('Suggestion unavailable after restore'),
        'dataExplorer.openInDataExplorer': vscode.l10n.t("Open '{0}' in Data Explorer"),
        'memory.computing': vscode.l10n.t('Computing memory usage...'),
        'memory.extensionHostAndKernels': vscode.l10n.t('Extension Host + kernels'),
        'memory.free': vscode.l10n.t('Free'),
        'memory.memoryUsage': vscode.l10n.t('Memory usage'),
        'memory.other': vscode.l10n.t('Other'),
        'memory.overhead': vscode.l10n.t('Overhead'),
        'memory.platform': vscode.l10n.t('Platform'),
        'memory.sessions': vscode.l10n.t('Sessions'),
        'memory.summary': vscode.l10n.t('Summary'),
        'memory.used': vscode.l10n.t('{0} used'),
        'plots.copyPlot': vscode.l10n.t('Copy plot to clipboard'),
        'plots.clearAll': vscode.l10n.t('Clear all plots'),
        'plots.next': vscode.l10n.t('Show next plot'),
        'plots.openEditorTab': vscode.l10n.t('Open in editor tab'),
        'plots.openNewWindow': vscode.l10n.t('Open in new window'),
        'plots.previous': vscode.l10n.t('Show previous plot'),
        'plots.save': vscode.l10n.t('Save plot'),
        'plots.openInEditor': vscode.l10n.t('Open in editor'),
        'plots.openInEditorSide': vscode.l10n.t('Open in editor tab to the Side'),
        'plots.selectWhereToOpen': vscode.l10n.t('Select where to open plot'),
        'viewer.actions': vscode.l10n.t('Viewer actions'),
        'viewer.clearContent': vscode.l10n.t('Clear the content'),
        'viewer.clearUrl': vscode.l10n.t('Clear the current URL'),
        'viewer.currentUrl': vscode.l10n.t('The current URL'),
        'viewer.interrupt': vscode.l10n.t('Interrupt execution'),
        'viewer.loading': vscode.l10n.t('Loading preview'),
        'viewer.navigateBack': vscode.l10n.t('Navigate back to the previous URL'),
        'viewer.navigateForward': vscode.l10n.t('Navigate forward to the next URL'),
        'viewer.navigateUrl': vscode.l10n.t('Navigate to URL'),
        'viewer.noPreview': vscode.l10n.t('No preview to display'),
        'viewer.noPreviewHint': vscode.l10n.t('Run code that produces HTML output to see it here'),
        'viewer.reloadContent': vscode.l10n.t('Reload the content'),
        'viewer.reloadUrl': vscode.l10n.t('Reload the current URL'),
        'viewer.tryAgain': vscode.l10n.t('Try Again'),
        'viewer.unableToLoad': vscode.l10n.t('Unable to load preview'),
        'viewer.unavailableHint': vscode.l10n.t('The content may no longer be available.'),
    };
}

export function serializeWebviewLocalizationMessages(): string {
    return JSON.stringify(createWebviewLocalizationMessages()).replace(/</g, '\\u003c');
}
