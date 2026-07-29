import { mount } from "svelte";
import { installWebviewContextMenuGuard } from "$lib/webviewContextMenu";
import App from "./App.svelte";
import "./styles.css";

installWebviewContextMenuGuard();

const app = mount(App, {
    target: document.getElementById("app")!,
});

export default app;
