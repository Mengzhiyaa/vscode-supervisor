<!--
    OutputRun.svelte
    
    Renders a single ANSIOutputRun with appropriate styling.
    Applies foreground color, background color, and text styles from the ANSI format.
-->
<script lang="ts">
    import OutputRunWithLinks from "./OutputRunWithLinks.svelte";
    import type {
        ANSIOutputRun,
        ANSIFormat,
        ANSIColor,
    } from "$lib/ansi/ansiOutput";

    interface Props {
        outputRun: ANSIOutputRun;
    }

    let { outputRun }: Props = $props();

    /**
     * Maps ANSI color names to CSS variable names.
     * Uses VS Code's terminal color theme variables.
     */
    const colorToCss: Record<string, string> = {
        ansiBlack: "var(--vscode-terminal-ansiBlack)",
        ansiRed: "var(--vscode-terminal-ansiRed)",
        ansiGreen: "var(--vscode-terminal-ansiGreen)",
        ansiYellow: "var(--vscode-terminal-ansiYellow)",
        ansiBlue: "var(--vscode-terminal-ansiBlue)",
        ansiMagenta: "var(--vscode-terminal-ansiMagenta)",
        ansiCyan: "var(--vscode-terminal-ansiCyan)",
        ansiWhite: "var(--vscode-terminal-ansiWhite)",
        ansiBrightBlack: "var(--vscode-terminal-ansiBrightBlack)",
        ansiBrightRed: "var(--vscode-terminal-ansiBrightRed)",
        ansiBrightGreen: "var(--vscode-terminal-ansiBrightGreen)",
        ansiBrightYellow: "var(--vscode-terminal-ansiBrightYellow)",
        ansiBrightBlue: "var(--vscode-terminal-ansiBrightBlue)",
        ansiBrightMagenta: "var(--vscode-terminal-ansiBrightMagenta)",
        ansiBrightCyan: "var(--vscode-terminal-ansiBrightCyan)",
        ansiBrightWhite: "var(--vscode-terminal-ansiBrightWhite)",
    };

    /**
     * Gets the CSS color value for an ANSI color.
     */
    function getColor(
        color: ANSIColor | string | undefined,
    ): string | undefined {
        if (!color) return undefined;
        // If it's a hex color, use directly
        if (color.startsWith("#")) return color;
        // Otherwise map to CSS variable
        return colorToCss[color] || undefined;
    }

    /**
     * Builds inline style string from format.
     */
    function buildStyle(format?: ANSIFormat): string {
        if (!format) return "";

        const styles: string[] = [];

        // Foreground color
        const fgColor = getColor(format.foregroundColor);
        if (fgColor) {
            styles.push(`color: ${fgColor}`);
        }

        // Background color
        const bgColor = getColor(format.backgroundColor);
        if (bgColor) {
            styles.push(`background-color: ${bgColor}`);
        }

        // Text styles
        if (format.styles) {
            for (const style of format.styles) {
                switch (style) {
                    case "ansiBold":
                        styles.push("font-weight: bold");
                        break;
                    case "ansiDim":
                        styles.push("opacity: 0.7");
                        break;
                    case "ansiItalic":
                        styles.push("font-style: italic");
                        break;
                    case "ansiUnderlined":
                        if (format.underlinedColor) {
                            styles.push(`text-decoration: underline`);
                            styles.push(
                                `text-decoration-color: ${format.underlinedColor}`,
                            );
                        } else {
                            styles.push("text-decoration: underline");
                        }
                        break;
                    case "ansiDoubleUnderlined":
                        styles.push("text-decoration: underline double");
                        break;
                    case "ansiCrossedOut":
                        styles.push("text-decoration: line-through");
                        break;
                    case "ansiOverlined":
                        styles.push("text-decoration: overline");
                        break;
                    case "ansiHidden":
                        styles.push("visibility: hidden");
                        break;
                    case "ansiSlowBlink":
                    case "ansiRapidBlink":
                        styles.push("animation: blink 1s step-end infinite");
                        break;
                }
            }
        }

        return styles.join("; ");
    }

    // Compute style and link mode.
    let inlineStyle = $derived(buildStyle(outputRun.format));
    let hasHyperlink = $derived(!!outputRun.hyperlink);
    let shouldDetectHttpLinks = $derived(
        !hasHyperlink && outputRun.text.indexOf("http") !== -1,
    );
</script>

{#if hasHyperlink}
    <a
        href={outputRun.hyperlink?.url}
        class="output-run output-link"
        style={inlineStyle}
        target="_blank"
        rel="noopener noreferrer"
    >
        {outputRun.text}
    </a>
{:else}
    <span class="output-run" style={inlineStyle}>
        {#if shouldDetectHttpLinks}
            <OutputRunWithLinks text={outputRun.text} />
        {:else}
            {outputRun.text}
        {/if}
    </span>
{/if}

<style>
    .output-run {
        display: inline;
        word-break: break-all;
        white-space: var(--console-output-white-space, pre);
        line-height: inherit;
    }

    .output-link {
        color: var(--vscode-textLink-foreground);
        text-decoration: underline dotted;
        cursor: pointer;
    }

    .output-link:hover {
        color: var(--vscode-textLink-activeForeground);
    }

    @keyframes blink {
        50% {
            opacity: 0;
        }
    }
</style>
