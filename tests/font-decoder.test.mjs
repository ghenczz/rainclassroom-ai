import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const tempDir = await mkdtemp(
  path.join(os.tmpdir(), "rainclassroom-font-test-")
);
const outfile = path.join(tempDir, "font-decoder.mjs");

await build({
  entryPoints: [path.join(projectRoot, "src/services/font-decoder.ts")],
  outfile,
  bundle: true,
  format: "esm",
  platform: "node",
  target: ["es2022"],
  logLevel: "silent"
});

const { validateFontUrl } = await import(pathToFileURL(outfile).href);
const referenceIndex = JSON.parse(
  await readFile(
    path.join(projectRoot, "src/services/font-reference-index.json"),
    "utf8"
  )
);

test.after(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

test("参考字形索引包含完整 CJK 字形分组", () => {
  assert.equal(referenceIndex.version, 1);
  assert.ok(Object.keys(referenceIndex.entries).length > 20_000);
});

test("只允许雨课堂官方字体静态资源地址", () => {
  const allowed =
    "https://fe-static-yuketang.yuketang.cn/fe_font/product/exam_font_9e8180041a384270bb2b2dd5deb08b89.ttf";
  const url = validateFontUrl(allowed);

  assert.equal(url.hostname, "fe-static-yuketang.yuketang.cn");
  assert.throws(
    () =>
      validateFontUrl(
        "https://evil.example.com/fe_font/product/exam_font_9e8180041a384270bb2b2dd5deb08b89.ttf"
      ),
    /允许/
  );
  assert.throws(
    () =>
      validateFontUrl(
        "https://fe-static-yuketang.yuketang.cn/fe_font/product/other.ttf"
      ),
    /路径/
  );
  assert.throws(
    () =>
      validateFontUrl(
        "http://fe-static-yuketang.yuketang.cn/fe_font/product/exam_font_9e8180041a384270bb2b2dd5deb08b89.ttf"
      ),
    /允许/
  );
  assert.throws(
    () =>
      validateFontUrl(
        "https://user:pass@fe-static-yuketang.yuketang.cn/fe_font/product/exam_font_9e8180041a384270bb2b2dd5deb08b89.ttf"
      ),
    /认证/
  );
});
