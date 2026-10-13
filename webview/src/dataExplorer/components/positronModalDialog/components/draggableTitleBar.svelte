<script lang="ts">
    import { onDestroy } from "svelte";

    interface Props {
        title: string;
        onStartDrag?: () => void;
        onDrag?: (x: number, y: number) => void;
        onStopDrag?: (x: number, y: number) => void;
    }

    let { title, onStartDrag, onDrag, onStopDrag }: Props = $props();
    let disposeDrag: (() => void) | undefined;

    onDestroy(() => disposeDrag?.());

    function handlePointerDown(event: PointerEvent) {
        if (event.button !== 0) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        disposeDrag?.();
        const startX = event.clientX;
        const startY = event.clientY;
        const pointerId = event.pointerId;
        const target = event.currentTarget as HTMLElement;
        let deltaX = 0;
        let deltaY = 0;

        onStartDrag?.();

        const body = document.body;

        const handlePointerMove = (moveEvent: PointerEvent) => {
            if (moveEvent.pointerId !== pointerId) {
                return;
            }
            moveEvent.preventDefault();
            moveEvent.stopPropagation();
            deltaX = moveEvent.clientX - startX;
            deltaY = moveEvent.clientY - startY;
            onDrag?.(deltaX, deltaY);
        };

        const handlePointerUp = (upEvent: PointerEvent) => {
            if (upEvent.pointerId !== pointerId) {
                return;
            }
            upEvent.preventDefault();
            upEvent.stopPropagation();
            deltaX = upEvent.clientX - startX;
            deltaY = upEvent.clientY - startY;
            disposeDrag?.();
        };

        const cancelDrag = () => disposeDrag?.();
        const handlePointerCancel = (cancelEvent: PointerEvent) => {
            if (cancelEvent.pointerId === pointerId) {
                cancelDrag();
            }
        };
        disposeDrag = () => {
            disposeDrag = undefined;
            body.removeEventListener("pointermove", handlePointerMove, false);
            body.removeEventListener("pointerup", handlePointerUp, false);
            body.removeEventListener("pointercancel", handlePointerCancel);
            target.removeEventListener("lostpointercapture", handlePointerCancel);
            window.removeEventListener("blur", cancelDrag);
            if (target.hasPointerCapture(pointerId)) {
                target.releasePointerCapture(pointerId);
            }
            onStopDrag?.(deltaX, deltaY);
        };

        target.setPointerCapture(pointerId);
        body.addEventListener("pointermove", handlePointerMove, false);
        body.addEventListener("pointerup", handlePointerUp, false);
        body.addEventListener("pointercancel", handlePointerCancel);
        target.addEventListener("lostpointercapture", handlePointerCancel);
        window.addEventListener("blur", cancelDrag);
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
        touch-action: none;
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
