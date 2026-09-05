/** The mounted prompt owns its editor, like Positron's ActivityPrompt. */
export interface PromptInputController {
    focus(): Promise<void>;
    insertText(text: string): Promise<void>;
}

/** Scoped to one ConsoleCore; session IDs keep prompts isolated across tabs. */
export type PromptInputControllers = Map<string, PromptInputController>;

export const promptInputControllersContext = Symbol('consolePromptInputControllers');
