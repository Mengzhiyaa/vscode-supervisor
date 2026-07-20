import * as vscode from 'vscode';

/** Canonical configuration keys used by the plots service and its UI. */
export const PlotsConfiguration = {
    defaultSizingPolicy: 'plots.defaultSizingPolicy',
    historyPolicy: 'plots.historyPolicy',
    darkFilter: 'plots.darkFilter',
    freezeSlowPlots: 'plots.freezeSlowPlots',
    legacyDarkFilterMode: 'plots.darkFilterMode',
} as const;

function hasExplicitValue<T>(inspection: {
    globalValue?: T;
    workspaceValue?: T;
    workspaceFolderValue?: T;
} | undefined): boolean {
    return inspection?.globalValue !== undefined ||
        inspection?.workspaceValue !== undefined ||
        inspection?.workspaceFolderValue !== undefined;
}

/**
 * Reads the canonical dark-filter setting and falls back to the pre-P0 key
 * only when the canonical key has not been explicitly configured.
 */
export function readPlotsDarkFilter(defaultValue = 'auto'): string {
    const configuration = vscode.workspace.getConfiguration();
    const canonical = configuration.inspect<string>(PlotsConfiguration.darkFilter);
    if (hasExplicitValue(canonical)) {
        return configuration.get<string>(PlotsConfiguration.darkFilter, defaultValue);
    }

    return configuration.get<string>(PlotsConfiguration.legacyDarkFilterMode, defaultValue);
}

async function migrateConfigurationTarget(
    configuration: vscode.WorkspaceConfiguration,
    target: vscode.ConfigurationTarget,
    legacyValue: string | undefined,
    canonicalValue: string | undefined,
): Promise<boolean> {
    if (legacyValue === undefined || canonicalValue !== undefined) {
        return false;
    }

    await configuration.update('darkFilter', legacyValue, target);
    return true;
}

/**
 * Migrates explicitly configured `plots.darkFilterMode` values to
 * `plots.darkFilter`. The old value is deliberately retained so downgrading
 * the extension does not lose the user's preference.
 */
export async function migrateLegacyPlotsConfiguration(
    log?: vscode.LogOutputChannel,
): Promise<void> {
    const rootConfiguration = vscode.workspace.getConfiguration();
    const legacy = rootConfiguration.inspect<string>(PlotsConfiguration.legacyDarkFilterMode);
    const canonical = rootConfiguration.inspect<string>(PlotsConfiguration.darkFilter);
    if (!legacy) {
        return;
    }

    let migrated = false;
    const plotsConfiguration = vscode.workspace.getConfiguration('plots');
    migrated = await migrateConfigurationTarget(
        plotsConfiguration,
        vscode.ConfigurationTarget.Global,
        legacy.globalValue,
        canonical?.globalValue,
    ) || migrated;
    migrated = await migrateConfigurationTarget(
        plotsConfiguration,
        vscode.ConfigurationTarget.Workspace,
        legacy.workspaceValue,
        canonical?.workspaceValue,
    ) || migrated;

    for (const folder of vscode.workspace.workspaceFolders ?? []) {
        const scopedRoot = vscode.workspace.getConfiguration(undefined, folder.uri);
        const scopedLegacy = scopedRoot.inspect<string>(PlotsConfiguration.legacyDarkFilterMode);
        const scopedCanonical = scopedRoot.inspect<string>(PlotsConfiguration.darkFilter);
        migrated = await migrateConfigurationTarget(
            vscode.workspace.getConfiguration('plots', folder.uri),
            vscode.ConfigurationTarget.WorkspaceFolder,
            scopedLegacy?.workspaceFolderValue,
            scopedCanonical?.workspaceFolderValue,
        ) || migrated;
    }

    if (migrated) {
        log?.info('[Plots] Migrated plots.darkFilterMode to plots.darkFilter.');
    }
}
