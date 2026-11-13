import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const tempDir = await mkdtemp(
  path.join(os.tmpdir(), "rainclassroom-question-test-")
);
const outfile = path.join(tempDir, "question.mjs");

await build({
  entryPoints: [path.join(projectRoot, "src/content/question.ts")],
  outfile,
  bundle: true,
  format: "esm",
  platform: "node",
  target: ["es2022"],
  logLevel: "silent"
});

const { inferJudgmentText } = await import(pathToFileURL(outfile).href);

test.after(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

test("判断题 true/false 选项映射为正确与错误", () => {
  assert.equal(inferJudgmentText("true", ""), "正确");
  assert.equal(inferJudgmentText("false", ""), "错误");
  assert.equal(inferJudgmentText("TRUE", ""), "正确");
  assert.equal(inferJudgmentText("0", ""), "错误");
  assert.equal(inferJudgmentText("", ""), "");
});

test("判断题图标选项映射为正确与错误", () => {
  assert.equal(
    inferJudgmentText("", "#icon--tiankongtizhengque"),
    "正确"
  );
  assert.equal(
    inferJudgmentText("", "#icon--tiankongticuowu"),
    "错误"
  );
});
