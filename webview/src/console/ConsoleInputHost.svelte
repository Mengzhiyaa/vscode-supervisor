<script lang="ts">
    import { mount, unmount } from "svelte";
    import type { ConsoleState, ConsoleSettings } from "../types/console";
    import ConsoleInput from "./ConsoleInput.svelte";
    import type { MessageConnection } from "vscode-jsonrpc/browser";
    import type { ConsoleThemeData } from "$lib/monaco/languageSupport";
    import type { ConsoleInputCommand } from "./services/sessionModelManager";

    type SessionState = ConsoleState;

    interface ConsoleInputCommandEnvelope {
        sessionId: string;
        command: ConsoleInputCommand;
        nonce: number;
    }

    interface SessionInputHostState {
        sessionId: string;
        state: SessionState;
        inputPrompt: string;
        continuationPrompt: string;
    }

    interface ConsoleInputMountProps {
        width: number;
        hidden: boolean;
        active: boolean;
        sessionId: string;
        state: SessionState;
        inputPrompt: string;
        continuationPrompt: string;
        onExecute: (sessionId: string, code: string) => void;
        onInterrupt: (sessionId: string) => void;
        onActivate: (sessionId: string) => void;
        onSelectAll: () => void;
        onCodeExecuted: () => void;
        onOpenSearch?: (sessionId: string) => void;
        onOpenInEditor?: (sessionId: string, code: string) => void;
        onClearConsole?: (sessionId: string) => void;
        onCharWidthChanged?: (charWidth: number) => void;
        onWidthInCharsChanged?: (sessionId: string, widthInChars: number) => void;
        knownSessionIds: string[];
        connection: MessageConnection | undefined;
        inputCommand: ConsoleInputCommandEnvelope | undefined;
        themeData: ConsoleThemeData | undefined;
        consoleSettings: ConsoleSettings;
    }

    let {
        activeSessionId,
        active,
        width = 0,
        hidden = false,
        anchorVersion = 0,
        connection,
        inputCommand,
        themeData,
        consoleSettings,
        onExecute,
        onInterrupt,
        onActivate,
        onSelectAll,
        onCodeExecuted,
        onOpenSearch,
        onOpenInEditor,
        onClearConsole,
        onCharWidthChanged,
        onWidthInCharsChanged,
        knownSessionIds,
        getAnchor,
    }: {
        activeSessionId: string | undefined;
        active: SessionInputHostState | undefined;
        width: number;
        hidden?: boolean;
        anchorVersion?: number;
        connection: MessageConnection | undefined;
        inputCommand: ConsoleInputCommandEnvelope | undefined;
        themeData: ConsoleThemeData | undefined;
        consoleSettings: ConsoleSettings;
        onExecute: (sessionId: string, code: string) => void;
        onInterrupt: (sessionId: string) => void;
        onActivate: (sessionId: string) => void;
        onSelectAll: () => void;
        onCodeExecuted: () => void;
        onOpenSearch?: (sessionId: string) => void;
        onOpenInEditor?: (sessionId: string, code: string) => void;
        onClearConsole?: (sessionId: string) => void;
        onCharWidthChanged?: (charWidth: number) => void;
        onWidthInCharsChanged?: (sessionId: string, widthInChars: number) => void;
        knownSessionIds: string[];
        getAnchor: (sessionId: string) => HTMLDivElement | undefined;
    } = $props();

    interface MountedInputInstance {
        component: object;
        hostContainer: HTMLDivElement;
        anchor: HTMLDivElement;
    }

    let mountedInput: MountedInputInstance | undefined;
    let mountedProps = $state<ConsoleInputMountProps | undefined>(undefined);

    function createMountProps(
        activeState: SessionInputHostState,
    ): ConsoleInputMountProps {
        return {
            width,
            hidden,
            active: true,
            sessionId: activeState.sessionId,
            state: activeState.state,
            inputPrompt: activeState.inputPrompt,
            continuationPrompt: activeState.continuationPrompt,
            onExecute,
            onInterrupt,
            onActivate,
            onSelectAll,
            onCodeExecuted,
            onOpenSearch,
            onOpenInEditor,
            onClearConsole,
            onCharWidthChanged,
            onWidthInCharsChanged,
            knownSessionIds,
            connection,
            inputCommand,
            themeData,
            consoleSettings,
        };
    }

    function syncMountedProps(activeState: SessionInputHostState): void {
        if (!mountedProps) {
            return;
        }

        mountedProps.width = width;
        mountedProps.hidden = hidden;
        mountedProps.active = true;
        mountedProps.sessionId = activeState.sessionId;
        mountedProps.state = activeState.state;
        mountedProps.inputPrompt = activeState.inputPrompt;
        mountedProps.continuationPrompt = activeState.continuationPrompt;
        mountedProps.knownSessionIds = knownSessionIds;
        mountedProps.connection = connection;
        mountedProps.inputCommand = inputCommand;
        mountedProps.themeData = themeData;
        mountedProps.consoleSettings = consoleSettings;
    }

    function hideMountedInput(): void {
        if (!mountedProps) {
            return;
        }

        mountedProps.hidden = true;
        mountedProps.active = false;
    }

    function ensureInputMounted(anchor: HTMLDivElement): void {
        if (mountedInput || !active) {
            return;
        }

        mountedProps = createMountProps(active);

        const hostContainer = document.createElement("div");
        const component = mount(ConsoleInput, {
            target: hostContainer,
            props: mountedProps,
        });

        mountedInput = {
            component,
            hostContainer,
            anchor,
        };
    }

    function attachToAnchor(anchor: HTMLDivElement): void {
        if (!mountedInput) {
            return;
        }

        if (
            mountedInput.anchor === anchor &&
            mountedInput.hostContainer.parentElement === anchor
        ) {
            return;
        }

        mountedInput.anchor = anchor;
        anchor.appendChild(mountedInput.hostContainer);
    }

    function mountInputForActiveSession(): void {
        if (!activeSessionId || !active) {
            return;
        }

        const anchor = getAnchor(activeSessionId);
        if (!anchor) {
            return;
        }

        ensureInputMounted(anchor);
        attachToAnchor(anchor);
        syncMountedProps(active);
    }

    $effect(() => {
        anchorVersion;
        mountInputForActiveSession();
    });

    $effect(() => {
        activeSessionId;
        active;
        mountInputForActiveSession();
    });

    $effect(() => {
        if (!mountedInput) {
            return;
        }

        if (!active || !activeSessionId) {
            hideMountedInput();
            return;
        }

        syncMountedProps(active);
    });

    $effect(() => {
        return () => {
            if (mountedInput) {
                void unmount(mountedInput.component);
                mountedInput = undefined;
            }
            mountedProps = undefined;
        };
    });
</script>
