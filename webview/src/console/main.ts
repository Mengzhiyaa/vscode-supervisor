import { mount } from "svelte";
import { installWebviewContextMenuGuard } from "$lib/webviewContextMenu";
import ConsoleCore from "./ConsoleCore.svelte";
import "./styles.css";

installWebviewContextMenuGuard();

const app = mount(ConsoleCore, {
    target: document.getElementById("app")!,
});

export default app;
