import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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
  path.join(os.tmpdir(), "rainclassroom-video-test-")
);
const outfile = path.join(tempDir, "video.mjs");
const progressOutfile = path.join(tempDir, "video-progress.mjs");

await Promise.all([
  build({
    entryPoints: [path.join(projectRoot, "src/content/video.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: ["es2022"],
    logLevel: "silent"
  }),
  build({
    entryPoints: [path.join(projectRoot, "src/services/video-progress.ts")],
    outfile: progressOutfile,
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: ["es2022"],
    logLevel: "silent"
  })
]);

const { extractAccessibleSubtitles } = await import(
  pathToFileURL(outfile).href
);
const { createVideoProgressKey, saveVideoProgress } = await import(
  pathToFileURL(progressOutfile).href
);

test.after(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

test("优先选择中文字幕并清理 cue 文本", () => {
  const result = extractAccessibleSubtitles([
    {
      kind: "metadata",
      label: "",
      language: "",
      mode: "disabled",
      cues: []
    },
    {
      kind: "subtitles",
      label: "English",
      language: "en",
      mode: "showing",
      cues: [
        { startTime: 0, endTime: 2, text: "English cue" }
      ]
    },
    {
      kind: "subtitles",
      label: "中文字幕",
      language: "zh-CN",
      mode: "hidden",
      cues: [
        { startTime: 12.5, endTime: 14, text: "  <c>第二句</c>  " },
        { startTime: 10, endTime: 12, text: "第一句" },
        { startTime: 20, endTime: 21, text: "   " }
      ]
    }
  ]);

  assert.equal(result.state.trackCount, 2);
  assert.equal(result.state.cueCount, 2);
  assert.equal(result.state.source, "text-track");
  assert.equal(result.state.label, "中文字幕");
  assert.equal(result.state.language, "zh-CN");
  assert.deepEqual(Array.from(result.cues), [
    { startTime: 10, endTime: 12, text: "第一句" },
    { startTime: 12.5, endTime: 14, text: "第二句" }
  ]);
  assert.match(result.state.preview ?? "", /第一句/);
});

test("没有已加载字幕时返回 none 并保留轨道数量", () => {
  const result = extractAccessibleSubtitles([
    {
      kind: "captions",
      label: "",
      language: "",
      mode: "disabled",
      cues: null
    }
  ]);

  assert.equal(result.state.trackCount, 1);
  assert.equal(result.state.cueCount, 0);
  assert.equal(result.state.source, "none");
  assert.equal(result.state.preview, null);
  assert.equal(result.cues.length, 0);
});

test("去重相同时间与文本的字幕 cue", () => {
  const result = extractAccessibleSubtitles([
    {
      kind: "subtitles",
      label: "English",
      language: "en",
      mode: "showing",
      cues: [
        { startTime: 1, endTime: 2, text: "Same cue" },
        { startTime: 1, endTime: 2, text: "Same cue" }
      ]
    }
  ]);

  assert.equal(result.state.cueCount, 1);
  assert.equal(result.cues[0]?.text, "Same cue");
});

test("视频进度写入本地并按课程与内容 ID 分键", async () => {
  const writes = [];

  globalThis.chrome = {
    storage: {
      local: {
        set: async (value) => {
          writes.push(value);
        }
      }
    }
  };

  try {
    await saveVideoProgress({
      courseId: "course-1",
      contentId: "video-1",
      title: "测试视频",
      currentTime: 63.5,
      duration: 200,
      progress: 0.3175,
      paused: true,
      ended: false,
      playbackRate: 1,
      subtitles: {
        trackCount: 0,
        cueCount: 0,
        source: "none",
        label: null,
        language: null,
        preview: null
      },
      updatedAt: "2026-11-10T00:00:00.000Z"
    });

    assert.equal(writes.length, 1);

    const key = createVideoProgressKey("course-1", "video-1");
    assert.equal(key, "rainclassroom-ai:video-progress:course-1:video-1");
    assert.deepEqual(writes[0][key], {
      courseId: "course-1",
      contentId: "video-1",
      title: "测试视频",
      currentTime: 63.5,
      duration: 200,
      progress: 0.3175,
      completed: false,
      updatedAt: "2026-11-10T00:00:00.000Z"
    });
  } finally {
    delete globalThis.chrome;
  }
});
