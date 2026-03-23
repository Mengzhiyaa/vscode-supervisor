<!--
  PlotCodeMenuButton.svelte
  1:1 Positron replication - Menu button for plot code actions
-->
<script lang="ts">
    import ActionBarMenuButton from "../shared/ActionBarMenuButton.svelte";

    interface Props {
        plotCode?: string;
        executionId?: string;
        sessionId?: string;
        languageId?: string;
        hasOriginFile?: boolean;
        oncopyCode?: (code: string) => void;
        onrevealInConsole?: (data: {
            sessionId: string;
            executionId: string;
        }) => void;
        onrunCodeAgain?: (data: {
            code: string;
            sessionId: string;
            languageId: string;
        }) => void;
        onopenSourceFile?: () => void;
    }

    let {
        plotCode,
        executionId,
        sessionId,
        languageId,
        hasOriginFile = false,
        oncopyCode,
        onrevealInConsole,
        onrunCodeAgain,
        onopenSourceFile,
    }: Props = $props();

    const tooltip = "Plot code actions";
    const labels = {
        copyCode: "Copy Code",
        revealInConsole: "Reveal Code in Console",
        runCodeAgain: "Run Code Again",
        openSourceFile: "Open Source File",
    };

    const hasCopyCode = $derived(!!plotCode);
    const hasRevealInConsole = $derived(!!executionId && !!sessionId);
    const hasRunCodeAgain = $derived(!!plotCode && !!sessionId && !!languageId);
</script>

<ActionBarMenuButton
    icon="code"
    tooltip={plotCode || tooltip}
    ariaLabel={tooltip}
    actions={() => [
        {
            id: "copy-code",
            label: labels.copyCode,
            icon: "copy",
            disabled: !hasCopyCode,
            onSelected: () => {
                if (plotCode) {
                    oncopyCode?.(plotCode);
                }
            },
        },
        {
            id: "reveal-in-console",
            label: labels.revealInConsole,
            icon: "go-to-file",
            disabled: !hasRevealInConsole,
            onSelected: () => {
                if (executionId && sessionId) {
                    onrevealInConsole?.({ sessionId, executionId });
                }
            },
        },
        {
            id: "run-code-again",
            label: labels.runCodeAgain,
            icon: "run",
            disabled: !hasRunCodeAgain,
            onSelected: () => {
                if (plotCode && sessionId && languageId) {
                    onrunCodeAgain?.({ code: plotCode, sessionId, languageId });
                }
            },
        },
        {
            id: "open-source-file",
            label: labels.openSourceFile,
            icon: "go-to-file",
            disabled: !hasOriginFile,
            onSelected: () => {
                onopenSourceFile?.();
            },
        },
    ]}
/>
