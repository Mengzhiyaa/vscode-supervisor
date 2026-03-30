import { mount } from "svelte";
import ConsoleCore from "./ConsoleCore.svelte";
import "./styles.css";

const app = mount(ConsoleCore, {
    target: document.getElementById("app")!,
});

export default app;
