import { spawn, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(rootDir, "dist");
const manifestPath = path.join(distDir, "manifest.json");
const edgeCandidates = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
];
const edgePath = edgeCandidates.find((candidate) => existsSync(candidate));

if (!edgePath) {
  console.error("[smoke] 未找到 Microsoft Edge。");
  process.exit(2);
}

if (!existsSync(manifestPath)) {
  console.error("[smoke] 未找到 dist/manifest.json，请先运行 npm run build。");
  process.exit(2);
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const profileDir = await mkdtemp(
  path.join(os.tmpdir(), "rainclassroom-ai-edge-")
);
const portFile = path.join(profileDir, "DevToolsActivePort");

const edge = spawn(
  edgePath,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDir}`,
    `--disable-extensions-except=${distDir}`,
    `--load-extension=${distDir}`,
    "about:blank"
  ],
  {
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true
  }
);

let stderr = "";
edge.stderr.on("data", (chunk) => {
  stderr = `${stderr}${chunk.toString()}`.slice(-8000);
});

const exited = new Promise((resolve) => {
  edge.once("exit", (code, signal) => resolve({ code, signal }));
});

async function waitForPort() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (existsSync(portFile)) {
      const content = await readFile(portFile, "utf8");
      const port = Number.parseInt(content.split(/\r?\n/)[0] ?? "", 10);

      if (Number.isInteger(port) && port > 0) {
        return port;
      }
    }

    if (edge.exitCode !== null) {
      throw new Error(`Edge 提前退出，退出码 ${edge.exitCode}`);
    }

    await delay(200);
  }

  throw new Error("等待 Edge 调试端口超时。");
}

async function findServiceWorker(port) {
  let lastTargets = [];

  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      lastTargets = targets;

      const worker = targets.find(
        (target) =>
          target.type === "service_worker" &&
          typeof target.url === "string" &&
          target.url.includes("chrome-extension://") &&
          target.url.endsWith("/background/service-worker.js")
      );

      if (worker) {
        return { worker, targets };
      }
    } catch {
      // 浏览器尚未就绪，继续重试。
    }

    await delay(250);
  }

  return { worker: null, targets: lastTargets };
}

function connectCdp(webSocketUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const pending = new Map();
    let nextId = 0;

    socket.addEventListener("open", () => {
      resolve({
        send(method, params = {}) {
          return new Promise((commandResolve, commandReject) => {
            nextId += 1;
            const id = nextId;
            pending.set(id, { resolve: commandResolve, reject: commandReject });
            socket.send(JSON.stringify({ id, method, params }));
          });
        },
        close() {
          socket.close();
        }
      });
    });

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      const entry = pending.get(message.id);

      if (!entry) {
        return;
      }

      pending.delete(message.id);

      if (message.error) {
        entry.reject(
          new Error(message.error.message || "DevTools 命令执行失败。")
        );
      } else {
        entry.resolve(message.result);
      }
    });

    socket.addEventListener("error", () => {
      reject(new Error("无法连接 DevTools WebSocket。"));
    });
  });
}

async function evaluate(client, expression, awaitPromise = false) {
  const response = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true
  });

  if (response.exceptionDetails) {
    throw new Error(
      response.exceptionDetails.exception?.description ||
        response.exceptionDetails.text ||
        "页面脚本执行失败。"
    );
  }

  return response.result?.value;
}

async function inspectSidePanel(port, extensionId) {
  const panelUrl = `chrome-extension://${extensionId}/sidepanel/index.html`;
  const response = await fetch(
    `http://127.0.0.1:${port}/json/new?${encodeURIComponent(panelUrl)}`,
    { method: "PUT" }
  );

  if (!response.ok) {
    throw new Error(`无法打开 Side Panel 页面：HTTP ${response.status}`);
  }

  const target = await response.json();
  const client = await connectCdp(target.webSocketDebuggerUrl);

  try {
    let panelState = null;

    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        panelState = await evaluate(
          client,
          `({
            url: location.href,
            readyState: document.readyState,
            title: document.title,
            navCount: document.querySelectorAll(".rail-item[data-view]").length,
            activeView: document.querySelector(".rail-item.is-active")?.dataset.view ?? null,
            heading: document.querySelector("#view-title")?.textContent?.trim() ?? null,
            hasContent: (document.querySelector("#content")?.textContent?.trim().length ?? 0) > 0,
            extensionVersion: chrome.runtime.getManifest().version
          })`
        );

        if (panelState?.readyState === "complete" && panelState.navCount === 7) {
          break;
        }
      } catch {
        // 页面尚未完成初始化，继续重试。
      }

      await delay(200);
    }

    if (!panelState || panelState.navCount !== 7) {
      throw new Error("Side Panel 未完成渲染。");
    }

    if (panelState.extensionVersion !== manifest.version) {
      throw new Error(
        `Side Panel 版本不匹配：${panelState.extensionVersion} != ${manifest.version}`
      );
    }

    const settingsState = await evaluate(
      client,
      `new Promise((resolve) => {
        const button = document.querySelector('[data-view="settings"]');
        if (button) {
          button.click();
        }

        setTimeout(() => {
          const form = document.querySelector("#settings-form");
          const baseUrl = document.querySelector("#api-base-url");
          resolve({
            activeView: document.querySelector(".rail-item.is-active")?.dataset.view ?? null,
            heading: document.querySelector("#view-title")?.textContent?.trim() ?? null,
            hasForm: Boolean(form),
            baseUrl: baseUrl?.value ?? null,
            hasKeyInput: Boolean(document.querySelector("#api-key")),
            hasAutoAnalyze: Boolean(document.querySelector("#api-auto-analyze")),
            autoAnalyzeChecked:
              document.querySelector("#api-auto-analyze")?.checked ?? null
          });
        }, 400);
      })`,
      true
    );

    const settingsRoundTrip = await evaluate(
      client,
      `new Promise((resolve) => {
        const form = document.querySelector("#settings-form");
        const model = document.querySelector("#api-model");
        const key = document.querySelector("#api-key");
        const storageKey = "rainclassroom-ai:api-settings";

        if (!form || !model || !key) {
          resolve({ error: "缺少设置表单" });
          return;
        }

        model.value = "smoke-test-model";
        key.value = "smoke-test-key";
        form.requestSubmit();

        setTimeout(async () => {
          const savedStore = await chrome.storage.local.get(storageKey);
          const saved = savedStore[storageKey];
          const afterSave = {
            hasModel: saved?.model === "smoke-test-model",
            hasKey: saved?.apiKey === "smoke-test-key",
            hasAutoAnalyze: saved?.autoAnalyze === true,
            message: document.querySelector("#settings-message")?.textContent?.trim() ?? "",
            apiLabel: document.querySelector("#api-label")?.textContent?.trim() ?? ""
          };

          const clearButton = document.querySelector("#clear-api-key");
          if (clearButton) {
            clearButton.click();
          }

          setTimeout(async () => {
            const clearedStore = await chrome.storage.local.get(storageKey);
            const cleared = clearedStore[storageKey];
            resolve({
              afterSave,
              afterClear: {
                keyCleared: cleared?.apiKey === "",
                message: document.querySelector("#settings-message")?.textContent?.trim() ?? "",
                apiLabel: document.querySelector("#api-label")?.textContent?.trim() ?? ""
              }
            });
          }, 500);
        }, 600);
      })`,
      true
    );

    return { panelUrl, panelState, settingsState, settingsRoundTrip };
  } finally {
    client.close();
  }
}

let success = false;

try {
  const port = await waitForPort();
  const { worker, targets } = await findServiceWorker(port);

  if (!worker) {
    console.error("[smoke] 未找到扩展 Service Worker。");
    console.error(
      `[smoke] 当前调试目标：${targets.map((target) => `${target.type} ${target.url}`).join(" | ") || "无"}`
    );
    throw new Error("扩展 Service Worker 未运行。");
  }

  const extensionId = new URL(worker.url).hostname;
  console.info(`[smoke] Edge ${edgePath}`);
  console.info(`[smoke] 扩展 Service Worker 已运行：${worker.url}`);

  const panel = await inspectSidePanel(port, extensionId);

  if (
    panel.settingsState.activeView !== "settings" ||
    panel.settingsState.heading !== "API 设置" ||
    !panel.settingsState.hasForm ||
    !panel.settingsState.hasKeyInput ||
    !panel.settingsState.hasAutoAnalyze ||
    panel.settingsState.autoAnalyzeChecked !== true ||
    panel.settingsState.baseUrl !== "https://api.deepseek.com"
  ) {
    throw new Error(
      `Side Panel 设置页状态异常：${JSON.stringify(panel.settingsState)}`
    );
  }

  if (
    panel.settingsRoundTrip.error ||
    !panel.settingsRoundTrip.afterSave?.hasModel ||
    !panel.settingsRoundTrip.afterSave?.hasKey ||
    !panel.settingsRoundTrip.afterSave?.hasAutoAnalyze ||
    !panel.settingsRoundTrip.afterClear?.keyCleared
  ) {
    throw new Error(
      `API 设置保存/清除异常：${JSON.stringify(panel.settingsRoundTrip)}`
    );
  }

  success = true;
  console.info(
    `[smoke] Side Panel 已加载：${panel.panelUrl}（${panel.panelState.title}，7 个导航入口）`
  );
  console.info(
    `[smoke] 界面导航与 API 设置页正常：${panel.settingsState.heading}`
  );
  console.info("[smoke] API 设置保存与清除流程正常");
} catch (error) {
  console.error(
    `[smoke] 冒烟测试失败：${error instanceof Error ? error.message : String(error)}`
  );
} finally {
  if (edge.exitCode === null) {
    await new Promise((resolve) => {
      execFile(
        "taskkill",
        ["/PID", String(edge.pid), "/T", "/F"],
        { windowsHide: true },
        () => resolve()
      );
    });
  }

  await Promise.race([exited, delay(3000)]);

  try {
    await rm(profileDir, { recursive: true, force: true });
  } catch {
    // Edge 临时文件偶发占用时忽略清理失败。
  }
}

if (!success && stderr.trim().length > 0) {
  console.error("[smoke] Edge stderr（末尾）：");
  console.error(stderr.trim().split(/\r?\n/).slice(-20).join("\n"));
}

process.exitCode = success ? 0 : 1;
