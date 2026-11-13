import { build } from "esbuild";
import { access, copyFile, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(rootDir, "dist");
const manifestPath = path.join(rootDir, "manifest.json");
const workerEntry = path.join(rootDir, "src/background/service-worker.ts");
const contentEntry = path.join(rootDir, "src/content/observer.ts");

function fail(message) {
  throw new Error(`[build] ${message}`);
}

const manifestText = await readFile(manifestPath, "utf8");
let manifest;

try {
  manifest = JSON.parse(manifestText);
} catch (error) {
  fail(`manifest.json 不是合法 JSON：${error instanceof Error ? error.message : String(error)}`);
}

if (manifest.manifest_version !== 3) {
  fail("manifest.json 必须声明 manifest_version 为 3。");
}

const serviceWorker = manifest.background?.service_worker;

if (typeof serviceWorker !== "string" || serviceWorker.length === 0) {
  fail("manifest.json 缺少 background.service_worker。");
}

const sidePanelPath = manifest.side_panel?.default_path;

if (typeof sidePanelPath !== "string" || sidePanelPath.length === 0) {
  fail("manifest.json 缺少 side_panel.default_path。");
}

if (path.isAbsolute(sidePanelPath) || sidePanelPath.includes("..")) {
  fail("side_panel.default_path 必须是扩展目录内的相对路径。");
}

const contentScriptPath = manifest.content_scripts?.[0]?.js?.[0];

if (typeof contentScriptPath !== "string" || contentScriptPath.length === 0) {
  fail("manifest.json 缺少内容脚本入口。");
}

if (path.isAbsolute(contentScriptPath) || contentScriptPath.includes("..")) {
  fail("内容脚本路径必须是扩展目录内的相对路径。");
}

const sidePanelSourceHtml = path.join(rootDir, "src", sidePanelPath);
const sidePanelSourceDir = path.dirname(sidePanelSourceHtml);
const sidePanelEntry = path.join(sidePanelSourceDir, "index.ts");
const sidePanelStylesheet = path.join(sidePanelSourceDir, "style.css");
const sidePanelOutputHtml = path.join(distDir, sidePanelPath);
const sidePanelOutputDir = path.dirname(sidePanelOutputHtml);
const sidePanelOutputJs = path.join(sidePanelOutputDir, "index.js");
const sidePanelOutputCss = path.join(sidePanelOutputDir, "style.css");
const contentScriptOutput = path.join(distDir, contentScriptPath);

await Promise.all([
  access(workerEntry),
  access(contentEntry),
  access(sidePanelSourceHtml),
  access(sidePanelEntry),
  access(sidePanelStylesheet)
]);

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

await build({
  entryPoints: [workerEntry],
  outfile: path.join(distDir, serviceWorker),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["chrome116"],
  charset: "utf8",
  sourcemap: true,
  legalComments: "none",
  logLevel: "info"
});

await build({
  entryPoints: [contentEntry],
  outfile: contentScriptOutput,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome116"],
  charset: "utf8",
  sourcemap: true,
  legalComments: "none",
  logLevel: "info"
});

await build({
  entryPoints: [sidePanelEntry],
  outfile: sidePanelOutputJs,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["chrome116"],
  charset: "utf8",
  sourcemap: true,
  legalComments: "none",
  logLevel: "info"
});

await mkdir(sidePanelOutputDir, { recursive: true });
await copyFile(sidePanelSourceHtml, sidePanelOutputHtml);
await copyFile(sidePanelStylesheet, sidePanelOutputCss);
await copyFile(manifestPath, path.join(distDir, "manifest.json"));

await Promise.all([
  access(path.join(distDir, serviceWorker)),
  access(contentScriptOutput),
  access(sidePanelOutputHtml),
  access(sidePanelOutputJs),
  access(sidePanelOutputCss)
]);

console.info("[build] 构建完成，扩展目录：dist/");
console.info(`[build] Service Worker：${serviceWorker}`);
console.info(`[build] 内容脚本：${contentScriptPath}`);
console.info(`[build] Side Panel：${sidePanelPath}`);
