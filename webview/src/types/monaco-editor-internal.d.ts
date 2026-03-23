declare module "monaco-editor/esm/vs/editor/common/languages.js" {
    export const TokenizationRegistry: {
        getOrCreate(languageId: string): Promise<
            | {
                  getInitialState(): unknown;
                  tokenizeEncoded(
                      line: string,
                      hasEOL: boolean,
                      state: unknown,
                  ): { tokens: Uint32Array; endState: unknown };
              }
            | undefined
        >;
    };
}

declare module "monaco-editor/esm/vs/editor/common/languages/language.js" {
    export const ILanguageService: unknown;
}

declare module "monaco-editor/esm/vs/editor/common/tokens/lineTokens.js" {
    export class LineTokens {
        constructor(tokens: Uint32Array, line: string, languageIdCodec: unknown);
        inflate(): unknown;
        static convertToEndOffset(tokens: Uint32Array, lineLength: number): void;
    }
}

declare module "monaco-editor/esm/vs/editor/common/viewLayout/viewLineRenderer.js" {
    export class RenderLineInput {
        constructor(...args: unknown[]);
    }

    export function renderViewLine2(input: unknown): { html: string };
}

declare module "monaco-editor/esm/vs/editor/common/viewModel.js" {
    export const ViewLineRenderingData: {
        isBasicASCII(line: string, checkForBasicASCII: boolean): boolean;
        containsRTL(
            line: string,
            isBasicASCII: boolean,
            checkForRTL: boolean,
        ): boolean;
    };
}

declare module "monaco-editor/esm/vs/editor/standalone/browser/standaloneServices.js" {
    export const StandaloneServices: {
        get(serviceId: unknown): any;
    };
}
