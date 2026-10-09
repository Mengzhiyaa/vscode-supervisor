import "./console-test.js";
import "../src/shared/common.css";
import "../src/console/main.ts";

if (typeof window !== "undefined") {
  window.__consoleHmr = window.__consoleTest;
}

if (import.meta.hot) {
  import.meta.hot.accept();
}
