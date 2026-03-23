/* global window, document */
(() => {
  const defaultSessionId = "session-1";
  const defaultSession = {
    id: defaultSessionId,
    name: "Browser Console",
    runtimeName: "R",
    state: "ready",
  };

  let sessions = [{ ...defaultSession }];
  let activeSessionId = defaultSessionId;
  let execCounter = 0;
  let wordWrap = true;
  let trace = false;
  let lastExecutionId;

  const logBuffer = [];
  let isRunning = false;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getStatusEl() {
    return document.getElementById("status");
  }

  function getLoopStatusEl() {
    return document.getElementById("loop-status");
  }

  function getAnsiStatusEl() {
    return document.getElementById("ansi-status");
  }

  function getLogEl() {
    return document.getElementById("test-log");
  }

  function getScenarioSelectEl() {
    return document.getElementById("scenarioSelect");
  }

  function setStatus(text, kind) {
    const el = getStatusEl();
    if (!el) return;
    el.textContent = text;
    el.dataset.kind = kind || "info";
  }

  function setLoopStatus(text) {
    const el = getLoopStatusEl();
    if (!el) return;
    el.textContent = text;
  }

  function setAnsiStatus(text) {
    const el = getAnsiStatusEl();
    if (!el) return;
    el.textContent = text;
  }

  function clearLog() {
    const el = getLogEl();
    if (el) {
      el.innerHTML = "";
    }
    logBuffer.length = 0;
  }

  function logLine(text, kind = "info") {
    const el = getLogEl();
    const line = document.createElement("div");
    line.className = `log-line ${kind}`;
    line.textContent = text;
    logBuffer.push({ text, kind });
    if (el) {
      el.appendChild(line);
      el.scrollTop = el.scrollHeight;
    }
  }

  function nextExecutionId() {
    execCounter += 1;
    return `exec-${Date.now()}-${execCounter}`;
  }

  function sendNotification(method, params) {
    window.postMessage({ jsonrpc: "2.0", method, params }, "*");
  }

  function sendResponse(id, result, error) {
    const message = { jsonrpc: "2.0", id };
    if (error) {
      message.error = error;
    } else {
      message.result = result;
    }
    window.postMessage(message, "*");
  }

  function logRequest(msg) {
    const method = msg?.method || "unknown";
    // eslint-disable-next-line no-console
    console.log("[mock] request", method, msg);
  }

  const mockExtension = {
    onWebviewMessage(msg) {
      if (!msg || msg.jsonrpc !== "2.0") {
        return;
      }

      if (msg.method && typeof msg.id !== "undefined") {
        this.handleRequest(msg);
        return;
      }

      if (msg.method) {
        this.handleNotification(msg);
      }
    },

    handleRequest(msg) {
      logRequest(msg);
      const { method, params, id } = msg;

      switch (method) {
        case "session/list": {
          sendResponse(id, {
            sessions,
            activeSessionId,
          });
          return;
        }

        case "console/execute": {
          const executionId = params?.executionId || nextExecutionId();
          sendResponse(id, { executionId });

          // Simulate kernel echo and output
          setTimeout(() => {
            sendNotification("console/input", {
              executionId,
              code: params?.code || "",
              inputPrompt: "> ",
              continuationPrompt: "+ ",
              state: "executing",
              sessionId: params?.sessionId || defaultSessionId,
            });
            sendNotification("console/output", {
              type: "stdout",
              content: "[mock] output from console/execute\n",
              executionId,
              sessionId: params?.sessionId || defaultSessionId,
            });
            sendNotification("console/stateChange", {
              state: "ready",
              sessionId: params?.sessionId || defaultSessionId,
            });
          }, 50);
          return;
        }

        case "console/interrupt":
        case "console/clearConsole":
        case "console/toggleWordWrap":
        case "console/toggleTrace":
        case "session/switch":
        case "session/stop":
        case "session/rename":
        case "session/restart":
        case "console/complete":
        case "console/isComplete":
        case "console/lspCompletion":
        case "console/lspHover":
        case "console/lspSignatureHelp":
        case "console/replyPrompt": {
          sendResponse(id, {});
          return;
        }

        default: {
          sendResponse(id, {});
        }
      }
    },

    handleNotification(msg) {
      // eslint-disable-next-line no-console
      console.log("[mock] notification", msg.method, msg.params);

      if (msg.method === "session/switch" && msg.params?.sessionId) {
        activeSessionId = msg.params.sessionId;
        sendNotification("console/activeInstanceChanged", {
          sessionId: activeSessionId,
        });
      }
    },
  };

  const mockState = { value: undefined };
  const vscodeApi = {
    postMessage(message) {
      mockExtension.onWebviewMessage(message);
    },
    getState() {
      return mockState.value;
    },
    setState(state) {
      mockState.value = state;
    },
  };

  window.acquireVsCodeApi = () => vscodeApi;

  function startSession(session) {
    const existing = sessions.find((s) => s.id === session.id);
    if (!existing) {
      sessions = [...sessions, session];
    } else {
      sessions = sessions.map((s) => (s.id === session.id ? session : s));
    }

    sendNotification("console/instanceStarted", {
      instance: {
        sessionId: session.id,
        sessionName: session.name,
        runtimeName: session.runtimeName,
        state: session.state,
      },
    });
  }

  function initSession() {
    const session = sessions[0] || defaultSession;
    startSession(session);
    activeSessionId = session.id;
    sendNotification("console/activeInstanceChanged", {
      sessionId: session.id,
    });
    sendNotification("console/promptState", {
      sessionId: session.id,
      inputPrompt: "> ",
      continuationPrompt: "+ ",
    });
    sendNotification("console/workingDirectory", {
      sessionId: session.id,
      directory: "/tmp",
    });
    sendNotification("console/stateChange", {
      sessionId: session.id,
      state: session.state,
    });
  }

  function resetSessions() {
    sessions.forEach((session) => {
      sendNotification("console/instanceDeleted", {
        sessionId: session.id,
      });
    });
    sessions = [{ ...defaultSession }];
    activeSessionId = defaultSessionId;
    initSession();
    setLoopStatus("Loop: idle");
    setAnsiStatus("ANSI: n/a");
    sendNotification("console/clear", {
      sessionId: defaultSessionId,
      reason: "test-reset",
    });
  }

  function sendInput(code, executionId) {
    sendNotification("console/input", {
      executionId,
      code,
      inputPrompt: "> ",
      continuationPrompt: "+ ",
      state: "executing",
      sessionId: defaultSessionId,
    });
  }

  function sendStream(content, executionId, type) {
    sendNotification("console/output", {
      type: type || "stdout",
      content,
      executionId,
      sessionId: defaultSessionId,
    });
  }

  function sendBasicOutput() {
    const executionId = nextExecutionId();
    sendInput('print("hello")', executionId);
    sendStream("hello from stdout\n", executionId, "stdout");
  }

  function sendSplitStream() {
    const executionId = nextExecutionId();
    sendInput("print(mtcars)", executionId);
    sendStream("Dodge Challenger    15.5   8 318.0", executionId, "stream");
    setTimeout(() => {
      sendStream(" 150 2.76 3.520 16.87  0  0    3    2\n", executionId, "stream");
    }, 80);
  }

  async function sendCarriageReturnColor() {
    const executionId = nextExecutionId();
    lastExecutionId = executionId;
    sendInput("progress <- 0", executionId);

    const temps = [18, 21, 25, 29, 27, 23, 19, 15];
    for (let index = 0; index < temps.length; index += 1) {
      const temp = temps[index];
      let color = 36; // cyan
      if (temp >= 28) {
        color = 31; // red
      } else if (temp >= 24) {
        color = 33; // yellow
      } else if (temp >= 20) {
        color = 32; // green
      }

      setLoopStatus(`Loop: ${index + 1}/${temps.length} (temp=${temp})`);
      setAnsiStatus(`ANSI: ${color}`);

      const text = `Temp: ${temp}C`;
      sendStream(`\r\x1b[${color}m${text}\x1b[0m\x1b[K`, executionId, "stream");
      await sleep(60);
    }

    sendStream("\n", executionId, "stream");
    setLoopStatus("Loop: done");
    setAnsiStatus("ANSI: reset");
  }

  function sendStderr() {
    const executionId = nextExecutionId();
    sendInput('warning("oops")', executionId);
    sendStream("Warning: something happened\n", executionId, "stderr");
  }

  function sendErrorMessage() {
    const executionId = nextExecutionId();
    sendInput('stop("boom")', executionId);
    sendNotification("console/errorMessage", {
      executionId,
      name: "Error",
      message: "boom",
      traceback: ["trace line 1", "trace line 2"],
      sessionId: defaultSessionId,
    });
  }

  function sendHtmlOutput() {
    const executionId = nextExecutionId();
    sendInput("summary(cars)", executionId);
    sendNotification("console/displayData", {
      mimeType: "text/html",
      data: "<b>HTML output</b><br/><em>Rendered from test harness</em>",
      executionId,
      sessionId: defaultSessionId,
    });
  }

  function sendImageOutput() {
    const executionId = nextExecutionId();
    sendInput("plot(1:10)", executionId);
    // 1x1 transparent PNG
    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==";
    sendNotification("console/displayData", {
      mimeType: "image/png",
      data: pngBase64,
      executionId,
      outputId: `plot-${executionId}`,
      sessionId: defaultSessionId,
    });
  }

  function sendPrompt() {
    const executionId = nextExecutionId();
    sendInput("readline()", executionId);
    sendNotification("console/prompt", {
      id: `prompt-${executionId}`,
      parentId: executionId,
      prompt: "Enter value: ",
      password: false,
      sessionId: defaultSessionId,
    });
  }

  function clearOutput() {
    sendNotification("console/clear", {
      sessionId: defaultSessionId,
      reason: "user",
    });
  }

  function toggleWordWrap() {
    wordWrap = !wordWrap;
    sendNotification("console/wordWrapChanged", {
      sessionId: defaultSessionId,
      wordWrap,
    });
  }

  function toggleTrace() {
    trace = !trace;
    sendNotification("console/traceChanged", {
      sessionId: defaultSessionId,
      trace,
    });
  }

  function sendCustom() {
    const input = document.getElementById("customText");
    const text = input && input.value ? input.value : "custom output";
    const executionId = nextExecutionId();
    sendInput('cat("custom")', executionId);
    sendStream(`${text}\n`, executionId, "stdout");
  }

  async function waitFor(check, options = {}) {
    const { timeout = 2000, interval = 50, description = "condition" } = options;
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (check()) {
        return;
      }
      await sleep(interval);
    }
    throw new Error(`Timeout waiting for ${description}`);
  }

  async function ensureAppReady() {
    await waitFor(() => document.querySelector(".console-core"), {
      timeout: 5000,
      description: "console app mount",
    });
  }

  function getConsoleRoot(sessionId = defaultSessionId) {
    return document.querySelector(`[data-testid="console-${sessionId}"]`);
  }

  async function assertConsoleTextContains(text, sessionId = defaultSessionId) {
    await waitFor(() => {
      const root = getConsoleRoot(sessionId);
      return root && root.textContent && root.textContent.includes(text);
    }, {
      description: `console text includes \"${text}\"`,
    });
  }

  async function assertLastExecutionHasAnsiColor() {
    await waitFor(() => {
      if (!lastExecutionId) return false;
      const root = document.querySelector(`[data-execution-id="${lastExecutionId}"]`);
      if (!root) return false;
      return !!root.querySelector(
        '.console-output-lines .output-run[style*="color: var(--vscode-terminal-ansi"]'
      );
    }, {
      description: "console output has ANSI color run",
    });
  }

  async function assertSelectorTextContains(selector, text) {
    await waitFor(() => {
      const el = document.querySelector(selector);
      return el && el.textContent && el.textContent.includes(text);
    }, {
      description: `text \"${text}\" in ${selector}`,
    });
  }

  async function assertExists(selector) {
    await waitFor(() => document.querySelector(selector), {
      description: `selector ${selector}`,
    });
  }

  async function assertCount(selector, expected, options = {}) {
    const { atLeast = false } = options;
    await waitFor(() => {
      const count = document.querySelectorAll(selector).length;
      return atLeast ? count >= expected : count === expected;
    }, {
      description: `${selector} count ${atLeast ? ">=" : "=="} ${expected}`,
    });
  }

  function step(label, action) {
    return { label, action };
  }

  const scenarios = [
    {
      id: "smoke-init",
      label: "Smoke: init session",
      steps: [
        step("reset session", resetSessions),
        step("assert console mounted", () =>
          assertExists(`[data-testid="console-${defaultSessionId}"]`)),
      ],
    },
    {
      id: "basic-output",
      label: "Output: stdout",
      steps: [
        step("reset session", resetSessions),
        step("send stdout", sendBasicOutput),
        step("assert stdout", () =>
          assertConsoleTextContains("hello from stdout")),
      ],
    },
    {
      id: "split-stream",
      label: "Output: split stream",
      steps: [
        step("reset session", resetSessions),
        step("send split output", sendSplitStream),
        step("assert first chunk", () =>
          assertConsoleTextContains("Dodge Challenger")),
        step("assert second chunk", () =>
          assertConsoleTextContains("2.76 3.520")),
      ],
    },
    {
      id: "stderr",
      label: "Output: stderr",
      steps: [
        step("reset session", resetSessions),
        step("send stderr", sendStderr),
        step("assert stderr", () =>
          assertConsoleTextContains("Warning: something happened")),
      ],
    },
    {
      id: "carriage-return-color",
      label: "Output: CR + ANSI colors",
      steps: [
        step("reset session", resetSessions),
        step("send carriage return + color", sendCarriageReturnColor),
        step("assert final temp", () =>
          assertConsoleTextContains("Temp: 15C")),
        step("assert ansi color span", assertLastExecutionHasAnsiColor),
      ],
    },
    {
      id: "error-message",
      label: "Output: error message",
      steps: [
        step("reset session", resetSessions),
        step("send error", sendErrorMessage),
        step("assert error message", () =>
          assertSelectorTextContains(".activity-error-message", "boom")),
      ],
    },
    {
      id: "html-output",
      label: "Output: HTML",
      steps: [
        step("reset session", resetSessions),
        step("send html", sendHtmlOutput),
        step("assert html", () =>
          assertSelectorTextContains(".activity-output-html", "HTML output")),
      ],
    },
    {
      id: "image-output",
      label: "Output: image",
      steps: [
        step("reset session", resetSessions),
        step("send image", sendImageOutput),
        step("assert image", () =>
          assertExists(".activity-output-plot img.plot-image")),
      ],
    },
    {
      id: "prompt",
      label: "Prompt: input",
      steps: [
        step("reset session", resetSessions),
        step("send prompt", sendPrompt),
        step("assert prompt input", () =>
          assertExists(".activity-prompt .prompt-input")),
      ],
    },
    {
      id: "multi-session-tabs",
      label: "Session: multiple tabs",
      steps: [
        step("reset session", resetSessions),
        step("start second session", () =>
          startSession({
            id: "session-2",
            name: "Second Session",
            runtimeName: "R",
            state: "ready",
          })),
        step("assert two tabs", () =>
          assertCount('[data-testid^="console-tab-"]', 2, { atLeast: true })),
      ],
    },
  ];

  async function runScenarioById(id) {
    const scenario = scenarios.find((item) => item.id === id);
    if (!scenario) {
      logLine(`Unknown scenario: ${id}`, "fail");
      return;
    }
    if (isRunning) {
      logLine("Runner already active", "fail");
      return;
    }

    isRunning = true;
    setStatus(`Running: ${scenario.label}`, "info");
    logLine(`\nScenario: ${scenario.label}`, "info");

    try {
      await ensureAppReady();
      for (const stepDef of scenario.steps) {
        logLine(`- ${stepDef.label}`, "info");
        await stepDef.action();
      }
      logLine(`PASS: ${scenario.label}`, "pass");
      setStatus(`PASS: ${scenario.label}`, "pass");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logLine(`FAIL: ${scenario.label} (${message})`, "fail");
      setStatus(`FAIL: ${scenario.label}`, "fail");
      throw error;
    } finally {
      isRunning = false;
    }
  }

  async function runAllScenarios() {
    let failures = 0;
    for (const scenario of scenarios) {
      try {
        await runScenarioById(scenario.id);
      } catch (error) {
        failures += 1;
      }
    }
    if (failures > 0) {
      setStatus(`Finished: ${failures} failure(s)`, "fail");
    } else {
      setStatus("Finished: all scenarios passed", "pass");
    }
  }

  function populateScenarioSelect() {
    const select = getScenarioSelectEl();
    if (!select) return;
    select.innerHTML = "";
    scenarios.forEach((scenario) => {
      const option = document.createElement("option");
      option.value = scenario.id;
      option.textContent = scenario.label;
      select.appendChild(option);
    });
  }

  function autoRunFromQuery() {
    const params = new URLSearchParams(window.location.search);
    const scenarioId = params.get("scenario");
    const shouldRunAll = params.get("all") === "1";
    const shouldAutorun = params.get("autorun") === "1" || params.has("autorun");

    if (!shouldAutorun && !shouldRunAll) {
      return;
    }

    if (shouldRunAll) {
      void runAllScenarios();
      return;
    }

    if (scenarioId) {
      const select = getScenarioSelectEl();
      if (select) {
        select.value = scenarioId;
      }
      void runScenarioById(scenarioId);
      return;
    }

    const firstScenario = scenarios[0];
    if (firstScenario) {
      void runScenarioById(firstScenario.id);
    }
  }

  function wireToolbar() {
    const toolbar = document.getElementById("toolbar");
    if (!toolbar) return;

    toolbar.addEventListener("click", (event) => {
      const target = event.target;
      if (!target || !target.dataset || !target.dataset.action) return;

      switch (target.dataset.action) {
        case "init":
          initSession();
          break;
        case "basic":
          sendBasicOutput();
          break;
        case "split":
          sendSplitStream();
          break;
        case "cr-color":
          void sendCarriageReturnColor();
          break;
        case "stderr":
          sendStderr();
          break;
        case "error":
          sendErrorMessage();
          break;
        case "html":
          sendHtmlOutput();
          break;
        case "image":
          sendImageOutput();
          break;
        case "prompt":
          sendPrompt();
          break;
        case "clear":
          clearOutput();
          break;
        case "wrap":
          toggleWordWrap();
          break;
        case "trace":
          toggleTrace();
          break;
        case "custom":
          sendCustom();
          break;
        case "run-scenario": {
          const select = getScenarioSelectEl();
          if (select && select.value) {
            void runScenarioById(select.value);
          }
          break;
        }
        case "run-all":
          void runAllScenarios();
          break;
        case "reset":
          resetSessions();
          break;
        case "clear-log":
          clearLog();
          break;
        default:
          break;
      }
    });
  }

  window.__consoleTest = {
    runScenario: runScenarioById,
    runAll: runAllScenarios,
    reset: resetSessions,
    scenarios: scenarios.map((scenario) => scenario.id),
    getLog: () => [...logBuffer],
  };

  window.addEventListener("load", () => {
    wireToolbar();
    populateScenarioSelect();
    initSession();
    autoRunFromQuery();
  });
})();
