import * as vscode from 'vscode';
import type {
    IDataImporter,
    IDataImporterMetadata,
    IDataImportRequest,
    IDataImportResult,
} from '../../api';

function normalizeExtension(extension: string): string {
    return extension.replace(/^\./, '').toLowerCase();
}

/** Language extensions own import syntax; the Supervisor owns discovery and selection. */
export class DataImporterRegistry implements vscode.Disposable {
    private readonly _importers = new Map<string, IDataImporter>();
    private _disposed = false;

    register(importer: IDataImporter): vscode.Disposable {
        if (this._disposed) {
            throw new vscode.CancellationError();
        }
        if (!importer.id.trim() || this._importers.has(importer.id)) {
            throw new Error(
                `Data importer '${importer.id}' is already registered or has an empty id.`,
            );
        }
        this._importers.set(importer.id, importer);
        return new vscode.Disposable(() => {
            if (this._importers.get(importer.id) === importer) {
                this._importers.delete(importer.id);
            }
        });
    }

    private async _activateContributors(): Promise<void> {
        await Promise.all(
            vscode.extensions.all
                .filter((extension) => {
                    const entries =
                        extension.packageJSON.supervisor?.dataImporters ??
                        extension.packageJSON.positron?.dataImporters;
                    const events = extension.packageJSON.activationEvents as string[] | undefined;
                    return (
                        (Array.isArray(entries) && entries.length > 0) ||
                        events?.includes('onPositronDataExplorerImport') ||
                        events?.includes('onSupervisorDataExplorerImport')
                    );
                })
                .map((extension) => extension.activate()),
        );
        if (this._disposed) {
            throw new vscode.CancellationError();
        }
    }

    async getImporters(extension: string): Promise<readonly IDataImporterMetadata[]> {
        await this._activateContributors();
        const normalized = normalizeExtension(extension);
        return [...this._importers.values()]
            .filter((importer) =>
                importer.fileExtensions.some(
                    (candidate) => normalizeExtension(candidate) === normalized,
                ),
            )
            .sort((left, right) => left.displayName.localeCompare(right.displayName))
            .map(({ id, languageId, displayName, fileExtensions, reservedNames }) => ({
                id,
                languageId,
                displayName,
                fileExtensions: [...fileExtensions],
                reservedNames,
            }));
    }

    async generateCode(
        id: string,
        request: IDataImportRequest,
    ): Promise<IDataImportResult | undefined> {
        await this._activateContributors();
        const importer = this._importers.get(id);
        if (!importer) {
            throw new Error(`Data importer '${id}' is not registered.`);
        }
        const result = await importer.generateCode(request);
        if (this._disposed || this._importers.get(id) !== importer) {
            throw new vscode.CancellationError();
        }
        return result;
    }

    dispose(): void {
        this._disposed = true;
        this._importers.clear();
    }
}
