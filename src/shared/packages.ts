import type { LanguageRuntimePackage } from './packageTypes';

export type PackageDetailAction = 'install' | 'update' | 'uninstall' | 'help';

/** Snapshot of a package editor, pinned to the session that opened it. */
export interface PackageDetailState {
    revision: number;
    packageName: string;
    languageId: string;
    runtimeName: string;
    // Positron providers use sourceRepository; the standalone API also supports source.
    package?: Partial<LanguageRuntimePackage> & { sourceRepository?: string };
    installed: boolean;
    sessionAlive: boolean;
    isActive: boolean;
    busy: boolean;
    loading: boolean;
    error?: string;
}
