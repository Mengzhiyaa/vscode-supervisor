<script lang="ts">
    interface Props {
        title: string;
        onStartDrag?: () => void;
        onDrag?: (x: number, y: number) => void;
        onStopDrag?: (x: number, y: number) => void;
    }

    let { title, onStartDrag, onDrag, onStopDrag }: Props = $props();

    function handlePointerDown(event: PointerEvent) {
        if (event.button !== 0) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        const startX = event.clientX;
        const startY = event.clientY;

        onStartDrag?.();

        const body = document.body;

        const handlePointerMove = (moveEvent: PointerEvent) => {
            moveEvent.preventDefault();
            moveEvent.stopPropagation();
            onDrag?.(moveEvent.clientX - startX, moveEvent.clientY - startY);
        };

        const handlePointerUp = (upEvent: PointerEvent) => {
            upEvent.preventDefault();
            upEvent.stopPropagation();

            body.removeEventListener("pointermove", handlePointerMove, false);
            body.removeEventListener("pointerup", handlePointerUp, false);
            onStopDrag?.(upEvent.clientX - startX, upEvent.clientY - startY);
        };

        body.addEventListener("pointermove", handlePointerMove, false);
        body.addEventListener("pointerup", handlePointerUp, false);
    }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="draggable-title-bar" onpointerdown={handlePointerDown}>
    <div class="draggable-title-bar-title">{title}</div>
</div>

<style>
    .draggable-title-bar {
        position: absolute;
        inset: 0 0 auto 0;
        height: 32px;
        display: flex;
        cursor: move;
        padding: 0 16px;
        align-items: center;
        color: var(--vscode-positronModalDialog-foreground);
        background: var(--vscode-positronModalDialog-titleBarBackground);
    }

    .draggable-title-bar-title {
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        color: var(--vscode-positronModalDialog-titleBarForeground);
    }
</style>
