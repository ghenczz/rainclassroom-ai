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
  path.join(os.tmpdir(), "rainclassroom-deepseek-test-")
);
const outfile = path.join(tempDir, "deepseek.mjs");

await build({
  entryPoints: [path.join(projectRoot, "src/services/deepseek.ts")],
  outfile,
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: ["es2022"],
  logLevel: "silent"
});

const { analyzeQuestionWithDeepSeek, buildChatCompletionsUrl } =
  await import(pathToFileURL(outfile).href);

test.after(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

const settings = {
  baseUrl: "https://api.deepseek.com",
  model: "test-model",
  apiKey: "test-secret-key"
};

const payload = {
  courseName: "测试课程",
  taskTitle: "测试作业",
  question: {
    kind: "single-choice",
    kindLabel: "单选题",
    index: 1,
    body: "以下哪个选项正确？",
    options: [
      { key: "A", text: "错误答案" },
      { key: "B", text: "正确答案" }
    ]
  }
};

function analysisContent(overrides = {}) {
  return JSON.stringify({
    questionType: "single-choice",
    candidateAnswers: ["B"],
    analysis: "根据题干条件可以确定 B 项。",
    confidence: 0.9,
    uncertain: false,
    uncertaintyReason: null,
    ...overrides
  });
}

function mockResponse({ content, status = 200, ok = true }) {
  return {
    ok,
    status,
    async json() {
      return {
        model: "test-model-returned",
        choices: [{ message: { content } }]
      };
    },
    async text() {
      return content;
    }
  };
}

test("API 地址会补全 chat/completions 路径", () => {
  assert.equal(
    buildChatCompletionsUrl("https://api.deepseek.com"),
    "https://api.deepseek.com/chat/completions"
  );
  assert.equal(
    buildChatCompletionsUrl("https://api.deepseek.com/v1/"),
    "https://api.deepseek.com/v1/chat/completions"
  );
  assert.equal(
    buildChatCompletionsUrl("http://localhost:8080"),
    "http://localhost:8080/chat/completions"
  );
  assert.throws(
    () => buildChatCompletionsUrl("http://example.com"),
    /HTTPS/
  );
});

test("解析有效的结构化分析结果", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    return mockResponse({ content: analysisContent() });
  };

  try {
    const result = await analyzeQuestionWithDeepSeek(settings, payload);

    assert.equal(result.model, "test-model-returned");
    assert.equal(result.analysis.questionType, "single-choice");
    assert.deepEqual(result.analysis.candidateAnswers, ["B"]);
    assert.equal(result.analysis.confidence, 0.9);
    assert.equal(result.analysis.uncertain, false);
    assert.equal(requests.length, 1);
    assert.equal(
      requests[0].url,
      "https://api.deepseek.com/chat/completions"
    );
    assert.equal(
      requests[0].init.headers.Authorization,
      "Bearer test-secret-key"
    );

    const body = JSON.parse(requests[0].init.body);
    assert.equal(body.model, "test-model");
    assert.equal(body.response_format.type, "json_object");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("response_format 不受支持时自动重试", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  let callCount = 0;

  globalThis.fetch = async (url, init) => {
    callCount += 1;
    requests.push({ url, init });

    if (callCount === 1) {
      return {
        ok: false,
        status: 400,
        async text() {
          return "response_format json_object is not supported";
        },
        async json() {
          return {};
        }
      };
    }

    return mockResponse({ content: analysisContent() });
  };

  try {
    const result = await analyzeQuestionWithDeepSeek(settings, payload);

    assert.equal(result.analysis.candidateAnswers[0], "B");
    assert.equal(callCount, 2);
    const secondBody = JSON.parse(requests[1].init.body);
    assert.equal("response_format" in secondBody, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("模型返回非法答案时标记不确定", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    mockResponse({
      content: analysisContent({ candidateAnswers: ["E"] })
    });

  try {
    const result = await analyzeQuestionWithDeepSeek(settings, payload);

    assert.equal(result.analysis.uncertain, true);
    assert.match(
      result.analysis.uncertaintyReason ?? "",
      /不在选项中/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("置信度低于 0.75 时标记不确定", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    mockResponse({
      content: analysisContent({ confidence: 0.6, uncertain: false })
    });

  try {
    const result = await analyzeQuestionWithDeepSeek(settings, payload);

    assert.equal(result.analysis.uncertain, true);
    assert.match(
      result.analysis.uncertaintyReason ?? "",
      /置信度较低/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("模型返回非法 JSON 时拒绝结果", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    mockResponse({ content: "这不是 JSON" });

  try {
    await assert.rejects(
      analyzeQuestionWithDeepSeek(settings, payload),
      /JSON/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
