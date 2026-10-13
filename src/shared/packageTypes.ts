/**
 * Package data transferred between Host and Webview.
 * These declarations intentionally remain independent of src/api.ts. When changing
 * fields sent over the bridge, update both definitions while preserving compatibility.
 */
export interface LanguageRuntimePackage {
    id: string;
    name: string;
    displayName: string;
    version: string;
    license?: string;
    latestVersion?: string;
    publishedDate?: string;
    attached?: boolean;
    outdated?: boolean;
    description?: string;
    title?: string;
    author?: string;
    maintainer?: string;
    url?: string;
    source?: string;
    vulnerabilities?: PackageVulnerability[];
}

export interface PackageVulnerability {
    readonly id: string;
    readonly osvId: string;
    readonly score?: number;
    readonly scoreVersion?: 'v3' | 'v4';
    readonly summary?: string;
    readonly fixedIn?: string;
    readonly published?: string;
    readonly url?: string;
}

export interface PackageSpec {
    name: string;
    version?: string;
}

export type PackagesItemSize = 'card' | 'row';
