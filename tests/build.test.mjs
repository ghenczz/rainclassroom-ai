import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const distDir = path.join(projectRoot, "dist");
const sourceManifestPath = path.join(projectRoot, "manifest.json");
const distManifestPath = path.join(distDir, "manifest.json");
const sourceManifest = JSON.parse(await readFile(sourceManifestPath, "utf8"));
const distManifest = JSON.parse(await readFile(distManifestPath, "utf8"));
const contentScriptPath = path.join(
  distDir,
  distManifest.content_scripts[0].js[0]
);
const sidePanelScriptPath = path.join(
  distDir,
  path.dirname(distManifest.side_panel.default_path),
  "index.js"
);

test("dist 中包含 manifest 且与源文件一致", () => {
  assert.deepEqual(distManifest, sourceManifest);
});

test("manifest 声明的 Service Worker 已生成", async () => {
  const workerPath = path.join(
    distDir,
    distManifest.background.service_worker
  );

  await access(workerPath);
  const source = await readFile(workerPath, "utf8");
  assert.ok(source.length > 0);
  assert.match(source, /onInstalled/);
  assert.match(source, /onStartup/);
  assert.match(source, /sidePanel/);
  assert.match(source, /page-context-detected/);
  assert.match(source, /video-state-detected/);
  assert.match(source, /question-state-detected/);
  assert.match(source, /get-font-mapping/);
  assert.match(source, /analyze-question/);
});

test("内容脚本已生成并包含真实页面选择器", async () => {
  await access(contentScriptPath);
  const source = await readFile(contentScriptPath, "utf8");

  assert.ok(source.length > 0);
  assert.match(source, /changjiang\.yuketang\.cn/);
  assert.match(source, /learning-space-header__primary/);
  assert.match(source, /learning-space-header__secondary/);
  assert.match(source, /unit-title/);
  assert.match(source, /learning-space-video/);
  assert.match(source, /iframeExerciseId/);
  assert.match(source, /page-context-detected/);
  assert.match(source, /xt_video_player/);
  assert.match(source, /textTracks/);
  assert.match(source, /video-state-detected/);
  assert.match(source, /rainclassroom-ai:video-progress:/);
  assert.match(source, /question-state-detected/);
  assert.match(source, /get-font-mapping/);
});

test("Side Panel 页面及静态资源已生成", async () => {
  const panelPath = path.join(
    distDir,
    distManifest.side_panel.default_path
  );
  const panelDir = path.dirname(panelPath);
  const panelHtml = await readFile(panelPath, "utf8");

  await Promise.all([
    access(path.join(panelDir, "index.js")),
    access(path.join(panelDir, "style.css"))
  ]);

  assert.match(panelHtml, /<script type="module" src="\.\/index\.js"><\/script>/);
  assert.match(panelHtml, /<link rel="stylesheet" href="\.\/style\.css"/);
  assert.equal((panelHtml.match(/data-view="/g) ?? []).length, 7);
  assert.match(panelHtml, /id="content"/);

  assert.doesNotMatch(panelHtml, /<script[^>]+src="https?:\/\//i);
  assert.doesNotMatch(panelHtml, /<link[^>]+href="https?:\/\//i);
});

test("Side Panel 脚本包含核心界面与课程识别展示", async () => {
  const source = await readFile(sidePanelScriptPath, "utf8");

  assert.match(source, /尚未识别到课程/);
  assert.match(source, /当前任务/);
  assert.match(source, /最近识别/);
  assert.match(source, /页面可访问字幕/);
  assert.match(source, /本视频未提供页面可访问字幕/);
  assert.match(source, /video-progress-fill/);
  assert.match(source, /尚未完成 DeepSeek 配置/);
  assert.match(source, /analyze-question/);
  assert.match(source, /settings-form/);
  assert.match(source, /api-key/);
  assert.match(source, /DeepSeek API/);
});

test("Side Panel 支持自动分析新题目", async () => {
  const source = await readFile(sidePanelScriptPath, "utf8");

  assert.match(source, /自动分析新题目/);
  assert.match(source, /api-auto-analyze/);
  assert.match(source, /autoAnalyze/);
  assert.match(source, /首次自动分析/);
  assert.match(source, /自动分析等待授权/);
  assert.match(source, /permissions\.contains/);
});

test("构建产物不包含明显硬编码密钥", async () => {
  const scriptPaths = [
    path.join(distDir, distManifest.background.service_worker),
    contentScriptPath,
    sidePanelScriptPath
  ];

  for (const scriptPath of scriptPaths) {
    const source = await readFile(scriptPath, "utf8");
    assert.doesNotMatch(source, /\bsk-[A-Za-z0-9_-]{16,}\b/);
    assert.doesNotMatch(source, /api[_-]?key\s*[:=]\s*["'][^"']+["']/i);
  }
});
