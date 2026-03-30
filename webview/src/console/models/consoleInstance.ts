import type { RuntimeResourceUsage as ResourceUsage } from "@shared/runtime";
import type { ConsoleState } from "../../types/console";
import {
    ActivityItemPrompt,
    ActivityItemPromptState,
    type RuntimeItem,
    type RuntimeItemActivity,
} from "../classes";

export interface ConsoleSessionInfo {
    id: string;
    name: string;
    runtimeName: string;
    languageId?: string;
    state: ConsoleState;
    runtimePath?: string;
    runtimeVersion?: string;
    runtimeSource?: string;
    base64EncodedIconSvg?: string;
    promptActive: boolean;
    runtimeAttached: boolean;
}

export interface ConsoleInstanceModel {
    sessionId: string;
    sessionName: string;
    runtimeName: string;
    languageId: string;
    state: ConsoleState;
    runtimePath?: string;
    runtimeVersion?: string;
    runtimeSource?: string;
    base64EncodedIconSvg?: string;
    promptActive: boolean;
    runtimeAttached: boolean;
    disconnected: boolean;
    inputPrompt: string;
    continuationPrompt: string;
    runtimeItems: RuntimeItem[];
    runtimeItemActivities: Map<string, RuntimeItemActivity>;
    runtimeItemsMarker: number;
    executeScrollMarker: number;
    wordWrap: boolean;
    trace: boolean;
    workingDirectory?: string;
    resourceUsage: ResourceUsage[];
    scrollLocked: boolean;
}

interface CreateConsoleInstanceModelOptions {
    runtimeItems: RuntimeItem[];
    runtimeItemActivities: Map<string, RuntimeItemActivity>;
    runtimeItemsMarker: number;
    executeScrollMarker: number;
    inputPrompt: string;
    continuationPrompt: string;
    wordWrap: boolean;
    trace: boolean;
    workingDirectory?: string;
    resourceUsage?: ResourceUsage[];
    scrollLocked: boolean;
    sessionDataHydrated: boolean;
}

function hasUnansweredPrompt(
    runtimeItemActivities: Map<string, RuntimeItemActivity>,
): boolean {
    for (const runtimeItemActivity of runtimeItemActivities.values()) {
        if (
            runtimeItemActivity.activityItems.some(
                (activityItem) =>
                    activityItem instanceof ActivityItemPrompt &&
                    activityItem.state === ActivityItemPromptState.Unanswered,
            )
        ) {
            return true;
        }
    }

    return false;
}

export function resolveConsoleInstancePromptActive(
    sessionPromptActive: boolean,
    runtimeItemActivities: Map<string, RuntimeItemActivity>,
    sessionDataHydrated: boolean,
): boolean {
    if (hasUnansweredPrompt(runtimeItemActivities)) {
        return true;
    }

    if (!sessionDataHydrated) {
        return sessionPromptActive;
    }

    return false;
}

export function createConsoleInstanceModel(
    session: ConsoleSessionInfo,
    options: CreateConsoleInstanceModelOptions,
): ConsoleInstanceModel {
    return {
        sessionId: session.id,
        sessionName: session.name || session.runtimeName,
        runtimeName: session.runtimeName,
        languageId: session.languageId ?? "plaintext",
        state: session.state,
        runtimePath: session.runtimePath,
        runtimeVersion: session.runtimeVersion,
        runtimeSource: session.runtimeSource,
        base64EncodedIconSvg: session.base64EncodedIconSvg,
        promptActive: resolveConsoleInstancePromptActive(
            session.promptActive,
            options.runtimeItemActivities,
            options.sessionDataHydrated,
        ),
        runtimeAttached: session.runtimeAttached,
        disconnected: session.state === "disconnected",
        inputPrompt: options.inputPrompt,
        continuationPrompt: options.continuationPrompt,
        runtimeItems: options.runtimeItems,
        runtimeItemActivities: options.runtimeItemActivities,
        runtimeItemsMarker: options.runtimeItemsMarker,
        executeScrollMarker: options.executeScrollMarker,
        wordWrap: options.wordWrap,
        trace: options.trace,
        workingDirectory: options.workingDirectory,
        resourceUsage: options.resourceUsage ?? [],
        scrollLocked: options.scrollLocked,
    };
}
