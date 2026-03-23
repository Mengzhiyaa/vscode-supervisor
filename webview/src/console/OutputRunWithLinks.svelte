<!--
    OutputRunWithLinks.svelte
    
    Renders text with automatic hyperlink detection.
    Mirrors: positron/.../components/outputRunWithLinks.tsx
-->
<script lang="ts">
    import { getRpcConnection } from "../lib/rpc/client";

    interface Props {
        text: string;
    }

    let { text }: Props = $props();

    /**
     * Detects hyperlinks in text using regex.
     * Based on Positron's linkDetector.ts
     */
    function detectHyperlinks(text: string): string[] {
        const matches = text.match(/\bhttps?:\/\/[^'">)}\s]+/g);
        return matches ? matches : [];
    }

    /**
     * Splits text into parts with links identified.
     */
    function parseTextWithLinks(
        text: string,
    ): Array<{ type: "text" | "link"; content: string }> {
        const links = detectHyperlinks(text);
        if (links.length === 0) {
            return [{ type: "text", content: text }];
        }

        const parts: Array<{ type: "text" | "link"; content: string }> = [];
        let remaining = text;

        for (const link of links) {
            const index = remaining.indexOf(link);
            if (index > 0) {
                parts.push({
                    type: "text",
                    content: remaining.substring(0, index),
                });
            }
            parts.push({ type: "link", content: link });
            remaining = remaining.substring(index + link.length);
        }

        if (remaining.length > 0) {
            parts.push({ type: "text", content: remaining });
        }

        return parts;
    }

    /**
     * Handle link click - open in browser
     */
    function handleLinkClick(event: MouseEvent, url: string) {
        event.preventDefault();
        getRpcConnection().sendNotification("console/openExternal", { url });
    }

    const parts = $derived(parseTextWithLinks(text));
</script>

{#each parts as part}
    {#if part.type === "link"}
        <a
            href={part.content}
            class="output-hyperlink"
            onclick={(e) => handleLinkClick(e, part.content)}
        >
            {part.content}
        </a>
    {:else}
        <span>{part.content}</span>
    {/if}
{/each}

<style>
    .output-hyperlink {
        color: var(--vscode-textLink-foreground);
        text-decoration: underline;
        cursor: pointer;
    }

    .output-hyperlink:hover {
        color: var(--vscode-textLink-activeForeground);
    }
</style>
