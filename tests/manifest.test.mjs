import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

const manifest = JSON.parse(
  await readFile(path.join(projectRoot, "manifest.json"), "utf8")
);
const packageJson = JSON.parse(
  await readFile(path.join(projectRoot, "package.json"), "utf8")
);

test("manifest 使用 Manifest V3", () => {
  assert.equal(manifest.manifest_version, 3);
});

test("扩展基本信息完整且版本一致", () => {
  assert.equal(manifest.name, "长江雨课堂 AI 学习助手");
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(packageJson.version, manifest.version);
  assert.equal(typeof manifest.description, "string");
  assert.ok(manifest.description.length > 0);
});

test("Service Worker 入口与加载方式正确", () => {
  assert.equal(
    manifest.background?.service_worker,
    "background/service-worker.js"
  );
  assert.equal(manifest.background?.type, "module");
});

test("Side Panel 入口已声明", () => {
  assert.equal(
    manifest.side_panel?.default_path,
    "sidepanel/index.html"
  );
  assert.ok(manifest.permissions.includes("sidePanel"));
});

test("工具栏按钮已声明", () => {
  assert.equal(typeof manifest.action, "object");
  assert.equal(typeof manifest.action?.default_title, "string");
});

test("内容脚本只匹配长江雨课堂主域", () => {
  assert.deepEqual(manifest.host_permissions.sort(), [
    "https://changjiang.yuketang.cn/*",
    "https://fe-static-yuketang.yuketang.cn/*"
  ].sort());
  assert.equal(manifest.content_scripts.length, 1);
  assert.deepEqual(manifest.content_scripts[0].matches, [
    "https://changjiang.yuketang.cn/*"
  ]);
  assert.deepEqual(manifest.content_scripts[0].js, [
    "content/observer.js"
  ]);
  assert.equal(manifest.content_scripts[0].run_at, "document_idle");
});

test("只申请必要扩展权限", () => {
  assert.deepEqual(
    [...manifest.permissions].sort(),
    ["sidePanel", "storage"]
  );
  assert.ok(!manifest.permissions.includes("tabs"));
  assert.ok(!manifest.permissions.includes("cookies"));
  assert.ok(!manifest.permissions.includes("webRequest"));
  assert.ok(!manifest.host_permissions.includes("<all_urls>"));
  assert.deepEqual(manifest.optional_host_permissions.sort(), [
    "http://127.0.0.1/*",
    "http://localhost/*",
    "https://*/*"
  ].sort());
});
