import type {
  QuestionKind,
  QuestionOption,
  QuestionSnapshot
} from "../types/index.js";
import {
  isFontMappingResponse,
  LOG_PREFIX,
  RUNTIME_MESSAGE_TYPES
} from "../types/index.js";
import { toErrorMessage } from "../utils/helpers.js";

const QUESTION_DEBOUNCE_MS = 320;
const SETTLE_CHECK_DELAYS_MS = [500, 1500] as const;
const EXERCISE_FRAME_ID = "iframeExerciseId";
const ENCRYPTED_CLASS = "xuetangx-com-encrypted-font";
const EXAM_FONT_URL_PATTERN =
  /https:\/\/fe-static-yuketang\.yuketang\.cn\/fe_font\/product\/exam_font_[a-f0-9]{16,64}\.ttf/i;

type FontMapping = Readonly<Record<string, string>>;

export interface QuestionMonitorOptions {
  readonly onState: (question: QuestionSnapshot) => void;
}

interface DecodedText {
  readonly text: string;
  readonly missing: ReadonlySet<string>;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function decodeMappedText(
  text: string,
  mapping: Readonly<Record<string, string>>
): DecodedText {
  const missing = new Set<string>();
  const output: string[] = [];

  for (const character of Array.from(text)) {
    const mapped = mapping[character];

    if (mapped === undefined) {
      missing.add(character);
      output.push("�");
    } else {
      output.push(mapped);
    }
  }

  return { text: output.join(""), missing };
}

function decodeElementText(
  element: Element,
  mapping: Readonly<Record<string, string>> | null
): DecodedText {
  const clone = element.cloneNode(true) as Element;
  const missing = new Set<string>();
  const encryptedNodes = Array.from(
    clone.querySelectorAll<HTMLElement>(`.${ENCRYPTED_CLASS}`)
  );

  if (encryptedNodes.length > 0 && mapping === null) {
    encryptedNodes.forEach((node) => {
      for (const character of Array.from(node.textContent ?? "")) {
        missing.add(character);
      }

      node.textContent = "";
    });
  } else if (mapping) {
    for (const node of encryptedNodes) {
      const decoded = decodeMappedText(node.textContent ?? "", mapping);
      node.textContent = decoded.text;
      decoded.missing.forEach((character) => missing.add(character));
    }
  }

  return {
    text: normalizeText(clone.textContent),
    missing
  };
}

function detectQuestionKind(label: string): QuestionKind {
  if (label.includes("单选")) {
    return "single-choice";
  }

  if (label.includes("多选")) {
    return "multiple-choice";
  }

  if (label.includes("判断")) {
    return "judgment";
  }

  if (label.includes("填空")) {
    return "fill-blank";
  }

  return "unknown";
}

function cleanKindLabel(rawLabel: string): string {
  const withoutIndex = rawLabel.replace(/^\s*\d+\s*[.、]\s*/, "");
  const withoutScore = withoutIndex.replace(
    /[（(]\s*\d+(?:\.\d+)?\s*分\s*[)）]\s*$/,
    ""
  );

  return normalizeText(withoutScore) || "未知题型";
}

function extractQuestionIndex(rawLabel: string): number | null {
  const match = rawLabel.match(/^\s*(\d+)\s*[.、]/);
  return match ? Number.parseInt(match[1] ?? "", 10) : null;
}

function findExamFontUrl(doc: Document): string | null {
  const encryptedElement = doc.querySelector(`.${ENCRYPTED_CLASS}`);

  if (!encryptedElement) {
    return null;
  }

  const view = doc.defaultView;
  const computedFamily = view
    ? view
        .getComputedStyle(encryptedElement)
        .fontFamily.split(",")[0]
        ?.replace(/["']/g, "")
        .trim()
    : null;

  const fallbackCandidates: string[] = [];

  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) {
        if (rule.type !== CSSRule.FONT_FACE_RULE) {
          continue;
        }

        const fontFaceRule = rule as CSSFontFaceRule;
        const cssText = fontFaceRule.cssText;
        const urlMatch = cssText.match(EXAM_FONT_URL_PATTERN);

        if (!urlMatch?.[0]) {
          continue;
        }

        const ruleFamily = fontFaceRule.style
          .getPropertyValue("font-family")
          .replace(/["']/g, "")
          .trim();

        if (!computedFamily || ruleFamily === computedFamily) {
          return urlMatch[0];
        }

        fallbackCandidates.push(urlMatch[0]);
      }
    } catch {
      // 跨域样式表可能拒绝读取 cssRules，继续检查其他样式表。
    }
  }

  if (fallbackCandidates[0]) {
    return fallbackCandidates[0];
  }

  const fallbackMatch = doc.documentElement.innerHTML.match(
    EXAM_FONT_URL_PATTERN
  );

  return fallbackMatch?.[0] ?? null;
}

function fontHashFromUrl(fontUrl: string | null): string | null {
  if (!fontUrl) {
    return null;
  }

  return fontUrl.match(/exam_font_([a-f0-9]{16,64})\.ttf/i)?.[1] ?? null;
}

export function inferJudgmentText(
  value: string,
  iconHref: string
): string {
  const normalized = value.toLowerCase();
  const icon = iconHref.toLowerCase();

  if (
    ["true", "1", "yes", "correct", "right", "对", "正确"].includes(
      normalized
    ) ||
    /zhengque|correct|dui/.test(icon)
  ) {
    return "正确";
  }

  if (
    ["false", "0", "no", "incorrect", "wrong", "错", "错误"].includes(
      normalized
    ) ||
    /cuowu|wrong|incorrect/.test(icon)
  ) {
    return "错误";
  }

  return "";
}

function extractOptions(
  subject: Element,
  kind: QuestionKind,
  mapping: Readonly<Record<string, string>> | null,
  missingCharacters: Set<string>
): QuestionOption[] {
  const labels = Array.from(
    subject.querySelectorAll<HTMLElement>(
      "label.el-radio, label.el-checkbox"
    )
  );
  const options: QuestionOption[] = [];

  for (const [position, label] of labels.entries()) {
    const input = label.querySelector<HTMLInputElement>("input");
    const keyElement = label.querySelector<HTMLElement>(
      ".radioInput, .checkboxInput"
    );
    const textElement = label.querySelector<HTMLElement>(
      ".radioText, .checkboxText"
    );
    const rawValue = normalizeText(input?.value);
    let text = "";

    if (textElement) {
      const decoded = decodeElementText(textElement, mapping);
      decoded.missing.forEach((character) =>
        missingCharacters.add(character)
      );
      text = decoded.text;
    } else if (kind === "judgment") {
      const useElement = label.querySelector("use");
      const iconHref =
        useElement?.getAttribute("href") ??
        useElement?.getAttribute("xlink:href") ??
        "";
      text = inferJudgmentText(rawValue, iconHref);
    } else {
      const fallbackElement =
        label.querySelector<HTMLElement>(
          ".el-radio__label, .el-checkbox__label"
        ) ?? label;
      const decoded = decodeElementText(fallbackElement, mapping);
      decoded.missing.forEach((character) =>
        missingCharacters.add(character)
      );
      text = decoded.text;
    }

    if (text.length === 0) {
      continue;
    }

    const key =
      kind === "judgment"
        ? position === 0
          ? "A"
          : position === 1
            ? "B"
            : rawValue || String(position + 1)
        : rawValue ||
          normalizeText(keyElement?.textContent) ||
          String(position + 1);

    options.push({ key, text });
  }

  return options;
}

export function extractQuestionFromFrameDocument(
  doc: Document,
  mapping: FontMapping | null = null,
  mappingError: string | null = null,
  knownFontUrl: string | null = null
): QuestionSnapshot | null {
  const candidates = Array.from(
    doc.querySelectorAll<HTMLElement>(".subject-item")
  );
  const subject =
    candidates.find(
      (element) =>
        element.querySelector(".item-type") !== null &&
        element.querySelector(".problem-body") !== null
    ) ?? null;

  if (!subject) {
    return null;
  }

  const rawTypeLabel = normalizeText(
    subject.querySelector(".item-type")?.textContent
  );
  const kindLabel = cleanKindLabel(rawTypeLabel);
  const kind = detectQuestionKind(kindLabel);
  const index = extractQuestionIndex(rawTypeLabel);

  const bodyElement = subject.querySelector(".problem-body");
  const encryptedPresent =
    subject.querySelector(`.${ENCRYPTED_CLASS}`) !== null;
  const fontUrl = encryptedPresent
    ? knownFontUrl ?? findExamFontUrl(doc)
    : null;
  const fontHash = fontHashFromUrl(fontUrl);
  const missingCharacters = new Set<string>();
  let body = "";

  if (bodyElement) {
    const decodedBody = decodeElementText(bodyElement, mapping);
    body = decodedBody.text;
    decodedBody.missing.forEach((character) =>
      missingCharacters.add(character)
    );
  }

  const options = extractOptions(
    subject,
    kind,
    mapping,
    missingCharacters
  );
  const reasons: string[] = [];

  if (encryptedPresent) {
    if (!fontUrl) {
      reasons.push("未能识别题目字体配置");
    } else if (!mapping) {
      reasons.push(mappingError ?? "题目字体尚未解析");
    } else if (missingCharacters.size > 0) {
      reasons.push("字体映射不完整，无法可靠还原题目文本");
    }
  }

  if (body.length === 0) {
    reasons.push("未读取到题干");
  }

  if (kind === "fill-blank") {
    reasons.push("填空题结构尚未在真实页面验证");
  } else if (kind === "unknown") {
    reasons.push("未识别题型");
  } else if (options.length === 0) {
    reasons.push("未读取到选项");
  }

  const supported = reasons.length === 0;
  const bodyText = body.length > 0 ? body : "题目文本未能读取";
  const fingerprint = JSON.stringify([
    kind,
    kindLabel,
    index,
    bodyText,
    options,
    fontHash
  ]);

  return {
    kind,
    kindLabel,
    index,
    body: bodyText,
    options,
    blankCount: null,
    fontHash,
    supported,
    unsupportedReason: supported ? null : reasons.join("；"),
    fingerprint,
    detectedAt: new Date().toISOString()
  };
}

function getExerciseFrame(): HTMLIFrameElement | null {
  const iframe = document.getElementById(EXERCISE_FRAME_ID);
  return iframe instanceof HTMLIFrameElement ? iframe : null;
}

export class QuestionMonitor {
  private readonly onState: (question: QuestionSnapshot) => void;

  private iframe: HTMLIFrameElement | null = null;

  private iframeAbortController: AbortController | null = null;

  private doc: Document | null = null;

  private observer: MutationObserver | null = null;

  private debounceTimer: number | null = null;

  private settleTimers: number[] = [];

  private lastFingerprint: string | null = null;

  private readonly fontMappings = new Map<string, FontMapping>();

  private readonly pendingFonts = new Set<string>();

  private readonly fontErrors = new Map<string, string>();

  private stopped = false;

  constructor(options: QuestionMonitorOptions) {
    this.onState = options.onState;
  }

  attachIfNeeded(): void {
    if (this.stopped) {
      return;
    }

    const iframe = getExerciseFrame();

    if (!iframe) {
      return;
    }

    if (iframe !== this.iframe) {
      this.bindIframe(iframe);
    }

    let frameDocument: Document | null = null;

    try {
      frameDocument = iframe.contentDocument;
    } catch (error) {
      console.warn(
        `${LOG_PREFIX} 无法访问作业 iframe：${toErrorMessage(error)}`
      );
    }

    if (frameDocument && frameDocument !== this.doc) {
      this.observeDocument(frameDocument);
    }
  }

  stop(): void {
    this.stopped = true;
    this.iframeAbortController?.abort();
    this.iframeAbortController = null;
    this.observer?.disconnect();
    this.observer = null;
    this.doc = null;
    this.iframe = null;

    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    for (const timer of this.settleTimers) {
      window.clearTimeout(timer);
    }

    this.settleTimers = [];
  }

  private bindIframe(iframe: HTMLIFrameElement): void {
    this.iframeAbortController?.abort();
    const controller = new AbortController();
    this.iframeAbortController = controller;
    this.iframe = iframe;

    iframe.addEventListener(
      "load",
      () => {
        this.attachIfNeeded();
      },
      { signal: controller.signal }
    );
  }

  private observeDocument(doc: Document): void {
    this.observer?.disconnect();
    this.doc = doc;
    this.lastFingerprint = null;

    this.observer = new MutationObserver(() => {
      this.scheduleReport();
    });

    if (doc.documentElement) {
      this.observer.observe(doc.documentElement, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }

    this.report();
    this.clearSettleTimers();

    for (const delay of SETTLE_CHECK_DELAYS_MS) {
      this.settleTimers.push(
        window.setTimeout(() => this.report(), delay)
      );
    }
  }

  private clearSettleTimers(): void {
    for (const timer of this.settleTimers) {
      window.clearTimeout(timer);
    }

    this.settleTimers = [];
  }

  private scheduleReport(): void {
    if (this.stopped || !this.doc) {
      return;
    }

    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = window.setTimeout(() => {
      this.debounceTimer = null;
      this.report();
    }, QUESTION_DEBOUNCE_MS);
  }

  private report(): void {
    if (this.stopped || !this.doc) {
      return;
    }

    const fontUrl = findExamFontUrl(this.doc);

    if (fontUrl && !this.fontMappings.has(fontUrl)) {
      const fontError = this.fontErrors.get(fontUrl);

      if (fontError) {
        this.emitQuestion(
          extractQuestionFromFrameDocument(
            this.doc,
            null,
            fontError,
            fontUrl
          )
        );
        return;
      }

      this.requestFontMapping(fontUrl);
      return;
    }

    const mapping = fontUrl
      ? this.fontMappings.get(fontUrl) ?? null
      : null;
    const question = extractQuestionFromFrameDocument(
      this.doc,
      mapping,
      fontUrl ? this.fontErrors.get(fontUrl) ?? null : null,
      fontUrl
    );

    this.emitQuestion(question);
  }

  private emitQuestion(question: QuestionSnapshot | null): void {
    if (!question || question.fingerprint === this.lastFingerprint) {
      return;
    }

    this.lastFingerprint = question.fingerprint;
    this.onState(question);

    console.debug(`${LOG_PREFIX} 题目识别`, {
      kind: question.kind,
      supported: question.supported,
      index: question.index
    });
  }

  private requestFontMapping(fontUrl: string): void {
    if (this.pendingFonts.has(fontUrl)) {
      return;
    }

    this.pendingFonts.add(fontUrl);
    this.fontErrors.delete(fontUrl);

    try {
      void chrome.runtime
        .sendMessage({
          type: RUNTIME_MESSAGE_TYPES.getFontMapping,
          fontUrl
        })
        .then((response: unknown) => {
          if (isFontMappingResponse(response) && response.ok) {
            this.fontMappings.set(fontUrl, response.mapping);
            this.fontErrors.delete(fontUrl);
          } else if (
            isFontMappingResponse(response) &&
            response.ok === false
          ) {
            this.fontErrors.set(fontUrl, response.error);
          } else {
            this.fontErrors.set(
              fontUrl,
              "字体映射接口返回了无法识别的结果。"
            );
          }
        })
        .catch((error: unknown) => {
          this.fontErrors.set(
            fontUrl,
            `字体映射解析失败：${toErrorMessage(error)}`
          );
        })
        .finally(() => {
          this.pendingFonts.delete(fontUrl);
          this.report();
        });
    } catch (error) {
      this.pendingFonts.delete(fontUrl);
      this.fontErrors.set(
        fontUrl,
        `字体映射请求失败：${toErrorMessage(error)}`
      );
      this.report();
    }
  }
}
