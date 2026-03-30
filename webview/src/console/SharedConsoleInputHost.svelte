<script lang="ts">
    import { mount, unmount } from "svelte";
    import type { ConsoleState, ConsoleSettings } from "../types/console";
    import ConsoleInput from "./ConsoleInput.svelte";
    import type { MessageConnection } from "vscode-jsonrpc/browser";
    import type { ConsoleThemeData } from "$lib/monaco/languageSupport";
    import type { ConsoleInstanceModel } from "./models/consoleInstance";
    import type {
        ConsoleInputCommand,
        KnownSessionInfo,
    } from "./services/sessionModelManager";

    interface ConsoleInputCommandEnvelope {
        sessionId: string;
        command: ConsoleInputCommand;
        nonce: number;
    }

    interface ConsoleInputMountProps {
        width: number;
        hidden: boolean;
        active: boolean;
        scrollLocked: boolean;
        sessionId: string;
        languageId: string;
        state: ConsoleState;
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
        languageAssetsVersion: number;
        knownSessions: KnownSessionInfo[];
        connection: MessageConnection | undefined;
        inputCommand: ConsoleInputCommandEnvelope | undefined;
        themeData: ConsoleThemeData | undefined;
        consoleSettings: ConsoleSettings;
    }

    let {
        activeConsoleInstance,
        width = 0,
        anchorVersion = 0,
        languageAssetsVersion = 0,
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
        knownSessions,
        getAnchor,
    }: {
        activeConsoleInstance: ConsoleInstanceModel | undefined;
        width: number;
        anchorVersion?: number;
        languageAssetsVersion?: number;
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
        knownSessions: KnownSessionInfo[];
        getAnchor: (sessionId: string) => HTMLDivElement | undefined;
    } = $props();

    const activeConsoleInstanceId = $derived(activeConsoleInstance?.sessionId);

    interface MountedInputInstance {
        component: object;
        hostContainer: HTMLDivElement;
        anchor: HTMLDivElement;
    }

    let mountedInput: MountedInputInstance | undefined;
    let mountedProps = $state<ConsoleInputMountProps | undefined>(undefined);

    function createMountProps(
        activeConsoleInstance: ConsoleInstanceModel,
    ): ConsoleInputMountProps {
        return {
            width,
            hidden:
                activeConsoleInstance.promptActive ||
                !activeConsoleInstance.runtimeAttached,
            active: true,
            scrollLocked: activeConsoleInstance.scrollLocked,
            sessionId: activeConsoleInstance.sessionId,
            languageId: activeConsoleInstance.languageId,
            state: activeConsoleInstance.state,
            inputPrompt: activeConsoleInstance.inputPrompt,
            continuationPrompt: activeConsoleInstance.continuationPrompt,
            onExecute,
            onInterrupt,
            onActivate,
            onSelectAll,
            onCodeExecuted,
            onOpenSearch,
            onOpenInEditor,
            onClearConsole,
            onCharWidthChanged,
            languageAssetsVersion,
            knownSessions,
            connection,
            inputCommand,
            themeData,
            consoleSettings,
        };
    }

    function syncMountedProps(
        activeConsoleInstance: ConsoleInstanceModel,
    ): void {
        if (!mountedProps) {
            return;
        }

        mountedProps.width = width;
        mountedProps.hidden =
            activeConsoleInstance.promptActive ||
            !activeConsoleInstance.runtimeAttached;
        mountedProps.active = true;
        mountedProps.scrollLocked = activeConsoleInstance.scrollLocked;
        mountedProps.sessionId = activeConsoleInstance.sessionId;
        mountedProps.languageId = activeConsoleInstance.languageId;
        mountedProps.state = activeConsoleInstance.state;
        mountedProps.inputPrompt = activeConsoleInstance.inputPrompt;
        mountedProps.continuationPrompt =
            activeConsoleInstance.continuationPrompt;
        mountedProps.languageAssetsVersion = languageAssetsVersion;
        mountedProps.knownSessions = knownSessions;
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
        if (mountedInput || !activeConsoleInstance) {
            return;
        }

        mountedProps = createMountProps(activeConsoleInstance);

        const hostContainer = document.createElement("div");
        hostContainer.style.overflowAnchor = "none";
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
        if (!activeConsoleInstanceId || !activeConsoleInstance) {
            return;
        }

        const anchor = getAnchor(activeConsoleInstanceId);
        if (!anchor) {
            return;
        }

        ensureInputMounted(anchor);
        attachToAnchor(anchor);
        syncMountedProps(activeConsoleInstance);
    }

    $effect(() => {
        anchorVersion;
        mountInputForActiveSession();
    });

    $effect(() => {
        activeConsoleInstanceId;
        activeConsoleInstance;
        mountInputForActiveSession();
    });

    $effect(() => {
        if (!mountedInput) {
            return;
        }

        if (!activeConsoleInstance || !activeConsoleInstanceId) {
            hideMountedInput();
            return;
        }

        syncMountedProps(activeConsoleInstance);
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
