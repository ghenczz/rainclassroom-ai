import {
  clearStoredApiKey,
  DEFAULT_API_BASE_URL,
  readActivePageSnapshot,
  readActiveQuestionSnapshot,
  readActiveVideoSnapshot,
  readApiSettingsSummary,
  STORAGE_KEYS,
  updateApiSettings
} from "../services/storage.js";
import type {
  ApiSettingsSummary,
  QuestionAnalysis,
  QuestionAnalysisPayload,
  QuestionSnapshot,
  RainClassroomPageContext,
  VideoPlaybackSnapshot,
  VideoSubtitleState
} from "../types/index.js";
import {
  isQuestionAnalysisResponse,
  LOG_PREFIX,
  RUNTIME_MESSAGE_TYPES
} from "../types/index.js";
import { escapeHtml, toErrorMessage } from "../utils/helpers.js";

type ViewId =
  | "course"
  | "video"
  | "chat"
  | "questions"
  | "mistakes"
  | "history"
  | "settings";

type PlaceholderViewId = Exclude<
  ViewId,
  "course" | "video" | "questions" | "settings"
>;

interface ViewMeta {
  readonly kicker: string;
  readonly title: string;
}

interface PlaceholderView {
  readonly icon: string;
  readonly stage: string;
  readonly title: string;
  readonly description: string;
  readonly features: readonly string[];
  readonly note: string;
  readonly preview?: string;
}

interface SettingsControls {
  readonly form: HTMLFormElement;
  readonly baseUrlInput: HTMLInputElement;
  readonly modelInput: HTMLInputElement;
  readonly keyInput: HTMLInputElement;
  readonly autoAnalyzeInput: HTMLInputElement;
  readonly keyToggle: HTMLButtonElement;
  readonly keyState: HTMLParagraphElement;
  readonly keyStateText: HTMLSpanElement;
  readonly clearKeyButton: HTMLButtonElement;
  readonly submitButton: HTMLButtonElement;
  readonly message: HTMLParagraphElement;
}

const VIEW_META: Record<ViewId, ViewMeta> = {
  course: { kicker: "学习空间", title: "当前课程" },
  video: { kicker: "内容理解", title: "视频学习" },
  chat: { kicker: "AI 助手", title: "AI 问答" },
  questions: { kicker: "练习辅助", title: "题目分析" },
  mistakes: { kicker: "复习巩固", title: "错题记录" },
  history: { kicker: "学习轨迹", title: "学习历史" },
  settings: { kicker: "连接与安全", title: "API 设置" }
};

const PLACEHOLDER_VIEWS: Record<PlaceholderViewId, PlaceholderView> = {
  chat: {
    icon: "chat",
    stage: "第五阶段接入",
    title: "AI 问答",
    description:
      "围绕课程字幕与题目上下文，向 DeepSeek 提问并获得结构化的学习帮助。",
    features: [
      "结合当前课程内容组织上下文",
      "支持追问与多轮学习对话",
      "结构化输出与引用来源",
      "网络异常和超时状态提示"
    ],
    note: "当前不会发送任何内容到 DeepSeek，也不会读取页面文本。",
    preview: `
      <div class="composer-preview" aria-disabled="true">
        <span>输入将在第五阶段开放</span>
        <button type="button" disabled aria-label="发送功能未启用">
          <svg aria-hidden="true"><use href="#icon-spark"></use></svg>
        </button>
      </div>
    `
  },
  mistakes: {
    icon: "mistakes",
    stage: "第七阶段接入",
    title: "错题记录",
    description:
      "把需要复习的题目保存在本地，按课程和知识点整理，便于后续回顾。",
    features: [
      "记录题干、解析与正确思路",
      "按课程和任务分类归档",
      "支持标记复习状态",
      "数据默认仅保存在本机"
    ],
    note: "错题本将在本地数据库阶段接入，目前没有题目数据。"
  },
  history: {
    icon: "history",
    stage: "第七阶段接入",
    title: "学习历史",
    description:
      "保存课程、任务和视频学习进度，在页面切换后继续上一次的学习上下文。",
    features: [
      "记录课程与任务切换",
      "保存未完成的学习进度",
      "避免混用不同任务的题目",
      "支持回顾最近学习内容"
    ],
    note: "当前还没有学习记录，历史数据将在第七阶段接入。"
  }
};

const content = requireElement<HTMLDivElement>("content");
const viewTitle = requireElement<HTMLHeadingElement>("view-title");
const viewKicker = requireElement<HTMLParagraphElement>("view-kicker");
const refreshButton = requireElement<HTMLButtonElement>("refresh-button");
const apiDot = requireElement<HTMLSpanElement>("api-dot");
const apiLabel = requireElement<HTMLSpanElement>("api-label");
const versionLabel = requireElement<HTMLSpanElement>("version-label");
const navButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>(".rail-item[data-view]")
);

const PAGE_KIND_LABELS: Readonly<
  Record<RainClassroomPageContext["pageKind"], string>
> = {
  video: "视频学习",
  exercise: "作业练习",
  other: "其他页面"
};

const CONFIDENCE_LABELS: Readonly<
  Record<RainClassroomPageContext["confidence"], string>
> = {
  high: "高",
  medium: "中",
  low: "低"
};

let activeView: ViewId = "course";
let activePageContext: RainClassroomPageContext | null = null;
let pageContextLoaded = false;
let activePageKey: string | null = null;
let activePageRequestId = 0;
let activeVideo: VideoPlaybackSnapshot | null = null;
let videoStateLoaded = false;
let videoRequestId = 0;
let activeQuestion: QuestionSnapshot | null = null;
let questionStateLoaded = false;
let questionRequestId = 0;
let cachedApiSummary: ApiSettingsSummary | null = null;

type AnalysisStatus =
  | "idle"
  | "loading"
  | "success"
  | "error"
  | "permission";

interface AnalysisViewState {
  readonly questionFingerprint: string | null;
  readonly status: AnalysisStatus;
  readonly result: QuestionAnalysis | null;
  readonly model: string | null;
  readonly error: string | null;
}

interface CachedAnalysis {
  readonly result: QuestionAnalysis;
  readonly model: string;
}

const AUTO_ANALYSIS_DELAY_MS = 900;
const ANALYSIS_CACHE_LIMIT = 100;

let analysisState: AnalysisViewState = {
  questionFingerprint: null,
  status: "idle",
  result: null,
  model: null,
  error: null
};
let autoAnalysisTimer: number | null = null;
let autoAnalysisScheduledFingerprint: string | null = null;
const analysisCache = new Map<string, CachedAnalysis>();

function requireElement<T extends HTMLElement>(elementId: string): T {
  const element = document.getElementById(elementId);

  if (!(element instanceof HTMLElement)) {
    throw new Error(`缺少侧边栏元素：${elementId}`);
  }

  return element as T;
}

function isViewId(value: string | undefined): value is ViewId {
  return value !== undefined && value in VIEW_META;
}

function isPlaceholderViewId(view: ViewId): view is PlaceholderViewId {
  return (
    view !== "course" &&
    view !== "video" &&
    view !== "questions" &&
    view !== "settings"
  );
}

function iconMarkup(icon: string, className: string): string {
  return `<svg class="${className}" aria-hidden="true"><use href="#icon-${icon}"></use></svg>`;
}

function renderFeatureItems(features: readonly string[]): string {
  return features
    .map(
      (feature) => `
        <li>
          <span class="feature-check" aria-hidden="true"></span>
          <span>${feature}</span>
        </li>
      `
    )
    .join("");
}

function formatDetectedAt(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}

function renderCourseView(): string {
  const context = activePageContext;
  const recognized =
    context !== null &&
    (context.pageKind === "video" || context.pageKind === "exercise");

  let statusText = "等待页面接入";
  let phaseText = "第三阶段识别";
  let headline = "尚未识别到课程";
  let description =
    "打开长江雨课堂课程页后，这里将显示课程名称、当前任务与学习状态。";
  let stats = `
    <div>
      <span>课程</span>
      <strong>—</strong>
    </div>
    <div>
      <span>当前任务</span>
      <strong>—</strong>
    </div>
    <div>
      <span>状态</span>
      <strong>待识别</strong>
    </div>
  `;
  let detectedMeta = "";
  let statusClass = "";
  let toolsNote = "侧边栏已就绪";
  let readyTitle = "页面识别已就绪";
  let readyCopy =
    "导航、本地 API 配置与页面识别已完成。打开已验证的雨课堂页面后会自动显示课程与任务。";

  if (!pageContextLoaded) {
    statusText = "正在识别当前页面";
    phaseText = "第三阶段";
    headline = "正在读取当前页面";
    description = "正在读取当前标签页的课程与任务信息…";
    stats = `
      <div>
        <span>课程</span>
        <strong>识别中</strong>
      </div>
      <div>
        <span>当前任务</span>
        <strong>识别中</strong>
      </div>
      <div>
        <span>状态</span>
        <strong>读取中</strong>
      </div>
    `;
  } else if (context) {
    const pageLabel = PAGE_KIND_LABELS[context.pageKind];
    const confidence = CONFIDENCE_LABELS[context.confidence];
    const taskTitle = context.taskTitle ?? "未命名任务";
    const detectedAt = formatDetectedAt(context.detectedAt);
    const courseLabel = context.courseName ?? "已进入雨课堂页面";

    detectedMeta = detectedAt
      ? `<span class="hero-detected">最近识别 ${escapeHtml(detectedAt)}</span>`
      : "";

    stats = `
      <div>
        <span>当前任务</span>
        <strong title="${escapeHtml(taskTitle)}">${escapeHtml(taskTitle)}</strong>
      </div>
      <div>
        <span>页面类型</span>
        <strong>${escapeHtml(pageLabel)}</strong>
      </div>
      <div>
        <span>识别置信度</span>
        <strong>${escapeHtml(confidence)}</strong>
      </div>
    `;

    if (recognized) {
      statusText = "已识别当前页面";
      phaseText = "已识别";
      statusClass = " is-detected";
      headline = courseLabel;
      description = context.courseSecondaryName ?? "已读取当前课程与任务信息。";
      toolsNote = "页面识别已接入";
      readyTitle = "真实页面识别已接入";
      readyCopy =
        "当前课程、任务和页面类型来自真实 DOM；页面切换后会自动重新识别。";
    } else {
      statusText = "页面暂未匹配";
      phaseText = "待扩展";
      headline = "当前页面暂未匹配";
      description = context.courseName
        ? `${context.courseName} · 尚未匹配到已验证的视频或作业页面。`
        : "当前页面属于长江雨课堂，但尚未匹配到已验证的视频或作业页面。";
      readyTitle = "已进入雨课堂";
      readyCopy =
        "当前页面类型尚未纳入识别范围。后续会根据真实页面逐步扩展，不会猜测页面结构。";
    }
  }

  return `
    <div class="view-enter">
      <section class="hero-card">
        <div class="hero-status">
          <span class="status-pill${statusClass}">
            <span class="status-pulse" aria-hidden="true"></span>
            ${statusText}
          </span>
          <span class="hero-phase">${phaseText}</span>
        </div>
        <h2>${escapeHtml(headline)}</h2>
        <p class="hero-description">
          ${escapeHtml(description)}
          ${detectedMeta}
        </p>
        <div class="hero-stats">
          ${stats}
        </div>
      </section>

      <section>
        <div class="section-heading">
          <h2>学习工具</h2>
          <span class="section-note">${toolsNote}</span>
        </div>
        <div class="tool-stack">
          <button class="tool-card" type="button" data-jump="video">
            <span class="tool-icon tone-blue">${iconMarkup("video", "tool-svg")}</span>
            <span class="tool-copy">
              <strong>视频学习</strong>
              <span>字幕总结与学习笔记</span>
            </span>
            <span class="tool-state">第四阶段</span>
            ${iconMarkup("chevron", "arrow-icon")}
          </button>
          <button class="tool-card" type="button" data-jump="chat">
            <span class="tool-icon tone-violet">${iconMarkup("chat", "tool-svg")}</span>
            <span class="tool-copy">
              <strong>AI 问答</strong>
              <span>结合课程内容提问</span>
            </span>
            <span class="tool-state">第五阶段</span>
            ${iconMarkup("chevron", "arrow-icon")}
          </button>
          <button class="tool-card" type="button" data-jump="questions">
            <span class="tool-icon tone-teal">${iconMarkup("questions", "tool-svg")}</span>
            <span class="tool-copy">
              <strong>题目分析</strong>
              <span>题型识别与解析提示</span>
            </span>
            <span class="tool-state">第五阶段</span>
            ${iconMarkup("chevron", "arrow-icon")}
          </button>
        </div>
      </section>

      <section class="ready-card">
        <span class="ready-icon">${iconMarkup("shield", "ready-svg")}</span>
        <div class="ready-copy">
          <strong>${readyTitle}</strong>
          <p>${readyCopy}</p>
        </div>
      </section>
    </div>
  `;
}

function formatPlaybackTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "00:00";
  }

  const wholeSeconds = Math.floor(seconds);
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const remainingSeconds = wholeSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");

  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(remainingSeconds)}`
    : `${pad(minutes)}:${pad(remainingSeconds)}`;
}

function formatPlaybackRate(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) {
    return "1×";
  }

  const value = Number.isInteger(rate)
    ? String(rate)
    : rate.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");

  return `${value}×`;
}

function getVideoStatus(video: VideoPlaybackSnapshot): {
  readonly text: string;
  readonly className: string;
} {
  if (video.ended) {
    return { text: "已完成", className: "is-ended" };
  }

  if (video.paused) {
    return { text: "已暂停", className: "is-paused" };
  }

  return { text: "正在播放", className: "is-playing" };
}

function subtitleSignature(
  subtitles: VideoSubtitleState | null | undefined
): string {
  if (!subtitles) {
    return "none";
  }

  return [
    subtitles.source,
    subtitles.trackCount,
    subtitles.cueCount,
    subtitles.label ?? "",
    subtitles.language ?? "",
    subtitles.preview ?? ""
  ].join("|");
}

function renderVideoSubtitlePanel(subtitles: VideoSubtitleState): string {
  if (subtitles.source === "text-track" && subtitles.cueCount > 0) {
    const meta = [subtitles.label, subtitles.language]
      .filter((value): value is string => Boolean(value))
      .join(" · ");

    return `
      <div class="subtitle-ready">
        <div class="subtitle-ready-head">
          <span class="subtitle-ready-dot" aria-hidden="true"></span>
          <strong>已读取 ${subtitles.cueCount} 条字幕</strong>
          ${meta ? `<span>${escapeHtml(meta)}</span>` : ""}
        </div>
        ${
          subtitles.preview
            ? `<p class="subtitle-preview">${escapeHtml(subtitles.preview)}</p>`
            : ""
        }
      </div>
    `;
  }

  if (subtitles.trackCount > 0) {
    return `
      <div class="subtitle-empty">
        ${iconMarkup("video", "subtitle-empty-icon")}
        <div>
          <strong>发现 ${subtitles.trackCount} 条字幕轨道</strong>
          <p>当前没有读取到 cue 文本，播放器可能尚未加载字幕内容。</p>
        </div>
      </div>
    `;
  }

  return `
    <div class="subtitle-empty">
      ${iconMarkup("shield", "subtitle-empty-icon")}
      <div>
        <strong>本视频未提供页面可访问字幕</strong>
        <p>页面没有暴露 textTracks 字幕文本。不会生成虚构的知识点总结或问答内容。</p>
      </div>
    </div>
  `;
}

function renderVideoInactivePage(
  page: RainClassroomPageContext | null
): string {
  const contextMessage =
    page?.pageKind === "exercise"
      ? `当前页面是「${page.taskTitle ?? "作业练习"}」，不是视频页。`
      : page?.courseName
        ? `已识别课程「${page.courseName}」，但当前页面不是已验证的视频页。`
        : "请先打开长江雨课堂的课程视频页面。";

  return `
    <div class="view-enter">
      <section class="empty-card">
        <div class="empty-icon" aria-hidden="true">
          ${iconMarkup("video", "empty-svg")}
        </div>
        <span class="phase-label">第四阶段</span>
        <h2>当前不在视频页</h2>
        <p class="empty-description">${escapeHtml(contextMessage)}</p>
        <ul class="feature-list">
          ${renderFeatureItems([
            "检测 HTML5 视频与视频标题",
            "读取页面可访问的原生字幕轨道",
            "记录并保存本机播放进度",
            "为后续 AI 字幕总结准备数据"
          ])}
        </ul>
      </section>
      <div class="stage-note">
        ${iconMarkup("shield", "note-icon")}
        <span>视频识别只在已验证的视频页面运行，不会自动播放或修改课程内容。</span>
      </div>
    </div>
  `;
}

function renderVideoWaitingPage(page: RainClassroomPageContext): string {
  const title = page.taskTitle ?? "视频加载中";
  const courseName = page.courseName ?? "长江雨课堂";

  return `
    <div class="view-enter">
      <section class="video-card video-card-loading">
        <div class="video-card-header">
          <span class="video-stage-pill">第四阶段 · 视频识别</span>
          <span class="video-status-chip is-paused">
            <span class="video-status-dot" aria-hidden="true"></span>
            读取中
          </span>
        </div>
        <div class="video-title-row">
          <span class="video-play-mark" aria-hidden="true">
            ${iconMarkup("video", "video-play-icon")}
          </span>
          <div class="video-title-copy">
            <p class="video-overline">${escapeHtml(courseName)}</p>
            <h2>${escapeHtml(title)}</h2>
            <p class="video-page-kind">正在连接页面播放器</p>
          </div>
        </div>
        <div class="video-progress-track is-loading" aria-hidden="true">
          <span></span>
        </div>
        <p class="video-loading-note">
          ${videoStateLoaded ? "当前页面尚未暴露可读取的 HTML5 视频元素。" : "正在读取视频状态…"}
        </p>
      </section>
      <div class="stage-note">
        ${iconMarkup("shield", "note-icon")}
        <span>页面识别已完成，正在等待播放器数据。不会自动播放视频。</span>
      </div>
    </div>
  `;
}

function renderActiveVideoPage(
  video: VideoPlaybackSnapshot,
  page: RainClassroomPageContext
): string {
  const title = video.title ?? page.taskTitle ?? "当前视频";
  const courseName = page.courseName ?? "长江雨课堂";
  const percent = Math.round(
    Math.min(1, Math.max(0, video.progress)) * 100
  );
  const status = getVideoStatus(video);
  const subtitleSummary =
    video.subtitles.cueCount > 0
      ? `${video.subtitles.cueCount} 条`
      : video.subtitles.trackCount > 0
        ? "未加载"
        : "无";

  return `
    <div class="view-enter">
      <section class="video-card">
        <div class="video-card-header">
          <span class="video-stage-pill">第四阶段 · 视频识别</span>
          <span class="video-status-chip ${status.className}" id="video-status-chip">
            <span class="video-status-dot" aria-hidden="true"></span>
            <span id="video-status-text">${status.text}</span>
          </span>
        </div>
        <div class="video-title-row">
          <span class="video-play-mark" aria-hidden="true">
            ${iconMarkup("video", "video-play-icon")}
          </span>
          <div class="video-title-copy">
            <p class="video-overline">${escapeHtml(courseName)}</p>
            <h2>${escapeHtml(title)}</h2>
            <p class="video-page-kind">${PAGE_KIND_LABELS[page.pageKind]} · 进度自动记录</p>
          </div>
        </div>

        <div class="video-progress-block">
          <div class="video-progress-labels">
            <span>播放进度</span>
            <strong id="video-percent">${percent}%</strong>
          </div>
          <div
            class="video-progress-track"
            id="video-progress-track"
            role="progressbar"
            aria-label="视频播放进度"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow="${percent}"
          >
            <span id="video-progress-fill" style="width: ${percent}%"></span>
          </div>
          <div class="video-time-row">
            <span id="video-current-time">${formatPlaybackTime(video.currentTime)}</span>
            <span id="video-duration-time">${formatPlaybackTime(video.duration)}</span>
          </div>
        </div>

        <div class="video-meta-grid">
          <div>
            <span>播放速度</span>
            <strong id="video-rate">${formatPlaybackRate(video.playbackRate)}</strong>
          </div>
          <div>
            <span>字幕</span>
            <strong>${escapeHtml(subtitleSummary)}</strong>
          </div>
          <div>
            <span>保存</span>
            <strong>本机</strong>
          </div>
        </div>
      </section>

      <section class="subtitle-card">
        <div class="section-heading">
          <h2>页面可访问字幕</h2>
          <span class="section-note">第四阶段</span>
        </div>
        ${renderVideoSubtitlePanel(video.subtitles)}
      </section>

      <div class="stage-note">
        ${iconMarkup("spark", "note-icon")}
        <span>知识点总结、学习笔记和视频问答将在 DeepSeek 接入阶段实现。当前只读取视频状态、字幕轨道与播放进度。</span>
      </div>
    </div>
  `;
}

function renderVideoView(): string {
  const page = activePageContext;

  if (!page || page.pageKind !== "video") {
    return renderVideoInactivePage(page);
  }

  if (!videoStateLoaded) {
    return renderVideoWaitingPage(page);
  }

  const video =
    activeVideo &&
    (page.contentId === null || activeVideo.contentId === page.contentId)
      ? activeVideo
      : null;

  if (!video) {
    return renderVideoWaitingPage(page);
  }

  return renderActiveVideoPage(video, page);
}

function setTextContent(elementId: string, text: string): void {
  const element = document.getElementById(elementId);

  if (element) {
    element.textContent = text;
  }
}

function updateVideoProgressDom(video: VideoPlaybackSnapshot): void {
  const percent = Math.round(
    Math.min(1, Math.max(0, video.progress)) * 100
  );
  const status = getVideoStatus(video);

  setTextContent("video-percent", `${percent}%`);
  setTextContent("video-current-time", formatPlaybackTime(video.currentTime));
  setTextContent("video-duration-time", formatPlaybackTime(video.duration));
  setTextContent("video-status-text", status.text);
  setTextContent("video-rate", formatPlaybackRate(video.playbackRate));

  const fill = document.getElementById("video-progress-fill");
  const track = document.getElementById("video-progress-track");
  const statusChip = document.getElementById("video-status-chip");

  if (fill instanceof HTMLElement) {
    fill.style.width = `${percent}%`;
  }

  if (track) {
    track.setAttribute("aria-valuenow", String(percent));
  }

  if (statusChip instanceof HTMLElement) {
    statusChip.classList.remove("is-playing", "is-paused", "is-ended");
    statusChip.classList.add(status.className);
  }
}

function isApiReady(summary: ApiSettingsSummary | null): boolean {
  return Boolean(
    summary &&
      summary.baseUrl.trim().length > 0 &&
      summary.model.trim().length > 0 &&
      summary.hasApiKey
  );
}

function renderQuestionInactivePage(
  page: RainClassroomPageContext | null
): string {
  const contextMessage =
    page?.pageKind === "video"
      ? "当前页面是视频学习页，不是作业页。"
      : page?.courseName
        ? `已识别课程「${page.courseName}」，但当前页面不是已验证的作业页。`
        : "请先打开长江雨课堂中包含具体题目的作业页面。";

  return `
    <div class="view-enter">
      <section class="empty-card">
        <div class="empty-icon" aria-hidden="true">
          ${iconMarkup("questions", "empty-svg")}
        </div>
        <span class="phase-label">第五阶段</span>
        <h2>当前不在作业页</h2>
        <p class="empty-description">${escapeHtml(contextMessage)}</p>
        <ul class="feature-list">
          ${renderFeatureItems([
            "读取当前题目的题干、题型与选项",
            "使用已校验的字体映射还原题目文本",
            "由 DeepSeek 输出结构化候选答案与解析",
            "不确定结果会明确标记"
          ])}
        </ul>
      </section>
      <div class="stage-note">
        ${iconMarkup("shield", "note-icon")}
        <span>只提供学习分析，不会自动选择、填写或提交作业答案。</span>
      </div>
    </div>
  `;
}

function renderQuestionWaitingPage(
  page: RainClassroomPageContext,
  loaded: boolean
): string {
  const title = loaded ? "尚未读取到题目" : "正在读取题目";
  const description = loaded
    ? "请确认作业页面中已经显示具体题目，滚动或切换题目后会自动重新识别。"
    : "正在读取作业 iframe 中的题干与选项…";

  return `
    <div class="view-enter">
      <section class="empty-card">
        <div class="empty-icon" aria-hidden="true">
          ${iconMarkup("questions", "empty-svg")}
        </div>
        <span class="phase-label">第五阶段</span>
        <h2>${title}</h2>
        <p class="empty-description">${description}</p>
        <div class="question-context-line">
          ${escapeHtml(page.courseName ?? "长江雨课堂")}
          ${page.taskTitle ? ` · ${escapeHtml(page.taskTitle)}` : ""}
        </div>
      </section>
      <div class="stage-note">
        ${iconMarkup("shield", "note-icon")}
        <span>页面结构或题型尚未匹配时不会猜测题目内容。</span>
      </div>
    </div>
  `;
}

function renderUnsupportedQuestion(
  question: QuestionSnapshot,
  page: RainClassroomPageContext
): string {
  const indexLabel =
    question.index === null ? "当前题目" : `第 ${question.index} 题`;

  return `
    <div class="view-enter">
      <section class="question-card">
        <div class="question-head">
          <span class="phase-label">${indexLabel}</span>
          <span class="question-type">${escapeHtml(question.kindLabel)}</span>
        </div>
        <p class="question-context">
          ${escapeHtml(page.courseName ?? "长江雨课堂")}
          ${page.taskTitle ? ` · ${escapeHtml(page.taskTitle)}` : ""}
        </p>
        <div class="question-unsupported">
          ${iconMarkup("shield", "question-warning-icon")}
          <div>
            <strong>无法可靠读取当前题目</strong>
            <p>${escapeHtml(question.unsupportedReason ?? "题目结构尚未支持")}</p>
          </div>
        </div>
      </section>
      <div class="stage-note">
        ${iconMarkup("shield", "note-icon")}
        <span>为避免把错误文本发送给 AI，当前题目不会进入分析流程。</span>
      </div>
    </div>
  `;
}

function renderAnalysisResult(
  question: QuestionSnapshot,
  analysis: QuestionAnalysis,
  model: string | null
): string {
  const confidence = Math.round(analysis.confidence * 100);
  const answers =
    analysis.candidateAnswers.length > 0
      ? analysis.candidateAnswers.map(escapeHtml).join("、")
      : "未给出明确答案";

  return `
    <div class="analysis-result${analysis.uncertain ? " is-uncertain" : ""}">
      <div class="analysis-result-head">
        <span class="analysis-answer-label">候选答案</span>
        <span class="analysis-answer">${answers}</span>
        <span class="analysis-confidence">置信度 ${confidence}%</span>
      </div>
      <p class="analysis-text">${escapeHtml(analysis.analysis)}</p>
      ${
        analysis.uncertain
          ? `<div class="analysis-warning">${escapeHtml(
              analysis.uncertaintyReason ?? "模型将结果标记为不确定，请独立核对。"
            )}</div>`
          : ""
      }
      <p class="analysis-meta">
        ${model ? `模型：${escapeHtml(model)}` : "DeepSeek 分析结果"} · AI 未读取课程教材
      </p>
    </div>
    <div class="analysis-actions">
      <button
        class="button-primary"
        type="button"
        data-action="analyze-question"
        data-question-fingerprint="${escapeHtml(question.fingerprint)}"
      >
        重新分析
      </button>
      <span class="analysis-hint">仅供学习参考</span>
    </div>
  `;
}

function renderQuestionAnalysisPanel(question: QuestionSnapshot): string {
  const matchingAnalysis =
    analysisState.questionFingerprint === question.fingerprint
      ? analysisState
      : null;
  const status = matchingAnalysis?.status ?? "idle";
  const apiReady = isApiReady(cachedApiSummary);

  if (status === "loading") {
    return `
      <div class="analysis-loading" role="status" aria-live="polite">
        <span class="analysis-spinner" aria-hidden="true"></span>
        <div>
          <strong>正在请求 DeepSeek</strong>
          <p>题目文本已准备完成，请稍候。</p>
        </div>
      </div>
    `;
  }

  if (status === "success" && matchingAnalysis?.result) {
    return renderAnalysisResult(
      question,
      matchingAnalysis.result,
      matchingAnalysis.model
    );
  }

  if (status === "permission") {
    return `
      <div class="analysis-empty">
        <strong>自动分析等待授权</strong>
        <p>${escapeHtml(
          matchingAnalysis?.error ??
            "首次自动分析需要允许扩展访问 API 域名。"
        )}点击一次完成授权，之后新题目会自动分析。</p>
        <button
          class="button-primary"
          type="button"
          data-action="analyze-question"
          data-question-fingerprint="${escapeHtml(question.fingerprint)}"
        >
          授权并分析
        </button>
      </div>
    `;
  }

  if (status === "error") {
    return `
      <div class="analysis-error" role="alert">
        <strong>分析失败</strong>
        <p>${escapeHtml(matchingAnalysis?.error ?? "未知错误")}</p>
      </div>
      <div class="analysis-actions">
        <button
          class="button-primary"
          type="button"
          data-action="analyze-question"
          data-question-fingerprint="${escapeHtml(question.fingerprint)}"
        >
          重试分析
        </button>
      </div>
    `;
  }

  if (!apiReady) {
    return `
      <div class="analysis-empty">
        <strong>尚未完成 DeepSeek 配置</strong>
        <p>请先在 API 设置中填写 API 地址、模型 ID 和 API Key，再分析当前题目。</p>
        <button class="button-primary" type="button" data-jump="settings">
          前往 API 设置
        </button>
      </div>
    `;
  }

  return `
    <div class="analysis-actions">
      <button
        class="button-primary"
        type="button"
        data-action="analyze-question"
        data-question-fingerprint="${escapeHtml(question.fingerprint)}"
      >
        使用 DeepSeek 分析
      </button>
      <span class="analysis-hint">${
        cachedApiSummary?.autoAnalyze
          ? "已开启自动分析"
          : "不会自动填写答案"
      }</span>
    </div>
  `;
}

function renderSupportedQuestion(
  question: QuestionSnapshot,
  page: RainClassroomPageContext
): string {
  const indexLabel =
    question.index === null ? "当前题目" : `第 ${question.index} 题`;
  const options = question.options
    .map(
      (option) => `
        <li class="question-option">
          <span class="question-option-key">${escapeHtml(option.key)}</span>
          <span class="question-option-text">${escapeHtml(option.text)}</span>
        </li>
      `
    )
    .join("");

  return `
    <div class="view-enter">
      <section class="question-card">
        <div class="question-head">
          <span class="phase-label">${indexLabel}</span>
          <span class="question-type">${escapeHtml(question.kindLabel)}</span>
        </div>
        <p class="question-context">
          ${escapeHtml(page.courseName ?? "长江雨课堂")}
          ${page.taskTitle ? ` · ${escapeHtml(page.taskTitle)}` : ""}
        </p>
        <div class="question-body">${escapeHtml(question.body)}</div>
        ${
          question.options.length > 0
            ? `<ul class="question-option-list">${options}</ul>`
            : ""
        }
      </section>

      <section class="analysis-card">
        <div class="section-heading">
          <h2>DeepSeek 分析</h2>
          <span class="section-note">${
            cachedApiSummary?.autoAnalyze && isApiReady(cachedApiSummary)
              ? "自动分析"
              : "第五阶段"
          }</span>
        </div>
        <div aria-live="polite">
          ${renderQuestionAnalysisPanel(question)}
        </div>
      </section>

      <div class="stage-note">
        ${iconMarkup("shield", "note-icon")}
        <span>正式计分考核只提供题目分析与学习提示，不实现自动填写、提交或代替学生作答。</span>
      </div>
    </div>
  `;
}

function renderQuestionView(): string {
  const page = activePageContext;

  if (!page || page.pageKind !== "exercise") {
    return renderQuestionInactivePage(page);
  }

  if (!questionStateLoaded) {
    return renderQuestionWaitingPage(page, false);
  }

  if (!activeQuestion) {
    return renderQuestionWaitingPage(page, true);
  }

  if (!activeQuestion.supported) {
    return renderUnsupportedQuestion(activeQuestion, page);
  }

  return renderSupportedQuestion(activeQuestion, page);
}

function renderPlaceholderView(view: PlaceholderViewId): string {
  const config = PLACEHOLDER_VIEWS[view];

  return `
    <div class="view-enter">
      <section class="empty-card">
        <div class="empty-icon" aria-hidden="true">
          ${iconMarkup(config.icon, "empty-svg")}
        </div>
        <span class="phase-label">${config.stage}</span>
        <h2>${config.title}</h2>
        <p class="empty-description">${config.description}</p>
        <ul class="feature-list">
          ${renderFeatureItems(config.features)}
        </ul>
      </section>
      ${config.preview ?? ""}
      <div class="stage-note">
        ${iconMarkup("shield", "note-icon")}
        <span>${config.note}</span>
      </div>
    </div>
  `;
}

function renderSettingsView(): string {
  return `
    <div class="view-enter">
      <section class="settings-hero">
        <div class="settings-heading">
          <span class="settings-mark" aria-hidden="true">
            ${iconMarkup("settings", "settings-svg")}
          </span>
          <div class="settings-title">
            <h2>DeepSeek API</h2>
            <p>保存后，题目分析会调用 DeepSeek API</p>
          </div>
          <span class="local-pill">仅本地</span>
        </div>
        <p class="settings-description">
          填写接口地址、模型 ID 与 API Key。API Key 只保存在本机，题目分析时由后台服务调用 DeepSeek。
        </p>
      </section>

      <section class="settings-card">
        <form id="settings-form" novalidate>
          <div class="field">
            <label class="field-label" for="api-base-url">
              API 地址
              <span>HTTPS</span>
            </label>
            <input
              id="api-base-url"
              name="baseUrl"
              type="url"
              inputmode="url"
              autocomplete="off"
              spellcheck="false"
              maxlength="500"
              placeholder="https://api.deepseek.com"
              aria-describedby="api-base-hint"
            />
            <span class="field-hint" id="api-base-hint">
              必须使用 HTTPS；本机地址（localhost / 127.0.0.1）可使用 HTTP。
            </span>
          </div>

          <div class="field">
            <label class="field-label" for="api-model">
              模型 ID
              <span>必填</span>
            </label>
            <input
              id="api-model"
              name="model"
              type="text"
              autocomplete="off"
              spellcheck="false"
              maxlength="120"
              placeholder="以你的 API 服务商文档为准"
            />
            <span class="field-hint">
              留空或不正确的模型名会导致题目分析失败。
            </span>
          </div>

          <div class="field">
            <label class="field-label" for="api-key">
              API Key
              <span>不回显</span>
            </label>
            <div class="secret-wrap">
              <input
                id="api-key"
                name="apiKey"
                type="password"
                autocomplete="off"
                spellcheck="false"
                maxlength="500"
                placeholder="输入 API Key"
                aria-describedby="api-key-state"
              />
              <button
                class="secret-toggle"
                id="api-key-toggle"
                type="button"
                aria-label="显示 API Key"
              >
                显示
              </button>
            </div>
            <p class="key-state" id="api-key-state">
              <span class="state-dot" aria-hidden="true"></span>
              <span id="api-key-state-text">正在读取本地设置…</span>
            </p>
          </div>

          <label class="auto-analyze" for="api-auto-analyze">
            <input
              id="api-auto-analyze"
              name="autoAnalyze"
              type="checkbox"
              checked
            />
            <span class="auto-analyze-copy">
              <strong>自动分析新题目</strong>
              <span>检测到新题目后自动发送分析请求，不再需要点击按钮。每次请求会产生少量 API 费用。</span>
            </span>
          </label>

          <div class="form-actions">
            <button class="button-primary" type="submit">保存设置</button>
            <button class="button-ghost" id="clear-api-key" type="button">
              清除密钥
            </button>
          </div>
          <p class="form-message" id="settings-message" role="status" aria-live="polite"></p>
        </form>
      </section>

      <section class="privacy-card">
        ${iconMarkup("shield", "privacy-icon")}
        <div>
          <strong>本地保存说明</strong>
          <p>API Key 仅写入浏览器本地扩展存储，不会发送给本扩展以外的服务。共用电脑上不建议保存长期密钥。</p>
        </div>
      </section>
    </div>
  `;
}

function renderView(view: ViewId): string {
  if (view === "course") {
    return renderCourseView();
  }

  if (view === "video") {
    return renderVideoView();
  }

  if (view === "questions") {
    return renderQuestionView();
  }

  if (view === "settings") {
    return renderSettingsView();
  }

  if (isPlaceholderViewId(view)) {
    return renderPlaceholderView(view);
  }

  return renderCourseView();
}

function setView(view: ViewId): void {
  activeView = view;
  const meta = VIEW_META[view];

  viewTitle.textContent = meta.title;
  viewKicker.textContent = meta.kicker;

  for (const button of navButtons) {
    const isActive = button.dataset.view === view;
    button.classList.toggle("is-active", isActive);

    if (isActive) {
      button.setAttribute("aria-current", "page");
    } else {
      button.removeAttribute("aria-current");
    }
  }

  content.innerHTML = renderView(view);
  content.scrollTop = 0;

  if (view === "settings") {
    void hydrateSettingsForm();
  }
}

function updateApiIndicator(summary: ApiSettingsSummary): void {
  const complete =
    summary.baseUrl.trim().length > 0 &&
    summary.model.trim().length > 0 &&
    summary.hasApiKey;
  const partial =
    !complete && (summary.model.trim().length > 0 || summary.hasApiKey);

  apiDot.classList.toggle("is-online", complete);
  apiDot.classList.toggle("is-partial", partial);
  apiLabel.textContent = complete
    ? "API 已配置"
    : partial
      ? "API 待完善"
      : "API 未配置";
}

async function refreshApiIndicator(): Promise<void> {
  const wasReady = isApiReady(cachedApiSummary);

  try {
    const summary = await readApiSettingsSummary();
    cachedApiSummary = summary;
    updateApiIndicator(summary);
    maybeScheduleAutoAnalysis(activeQuestion);

    if (
      activeView === "questions" &&
      wasReady !== isApiReady(cachedApiSummary)
    ) {
      setView("questions");
    }
  } catch (error) {
    cachedApiSummary = null;
    apiDot.classList.remove("is-online", "is-partial");
    apiLabel.textContent = "状态未知";
    maybeScheduleAutoAnalysis(activeQuestion);

    if (activeView === "questions") {
      setView("questions");
    }

    console.error(`${LOG_PREFIX} 读取 API 设置失败`, error);
  }
}

function rerenderContextView(): void {
  if (
    activeView === "course" ||
    activeView === "video" ||
    activeView === "questions"
  ) {
    setView(activeView);
  }
}

async function refreshActivePageContext(): Promise<void> {
  const requestId = ++activePageRequestId;

  try {
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });
    const snapshot = await readActivePageSnapshot();

    if (requestId !== activePageRequestId) {
      return;
    }

    let context: RainClassroomPageContext | null = null;
    let nextKey = "none";

    if (
      typeof activeTab?.id === "number" &&
      snapshot &&
      snapshot.tabId === activeTab.id
    ) {
      context = snapshot.context;
      nextKey = `${snapshot.tabId}:${snapshot.context.fingerprint}`;
    }

    const shouldRender = !pageContextLoaded || nextKey !== activePageKey;
    activePageContext = context;
    pageContextLoaded = true;
    activePageKey = nextKey;

    if (shouldRender) {
      rerenderContextView();
    }
  } catch (error) {
    if (requestId !== activePageRequestId) {
      return;
    }

    const shouldRender = !pageContextLoaded || activePageKey !== null;
    activePageContext = null;
    pageContextLoaded = true;
    activePageKey = null;

    if (shouldRender) {
      rerenderContextView();
    }

    console.error(`${LOG_PREFIX} 读取当前页面识别结果失败`, error);
  }
}

async function refreshActiveVideoState(): Promise<void> {
  const requestId = ++videoRequestId;

  try {
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });
    const snapshot = await readActiveVideoSnapshot();

    if (requestId !== videoRequestId) {
      return;
    }

    const nextVideo =
      typeof activeTab?.id === "number" && snapshot?.tabId === activeTab.id
        ? snapshot.video
        : null;
    const previousVideo = activeVideo;
    const wasLoaded = videoStateLoaded;
    const identityChanged =
      (previousVideo === null) !== (nextVideo === null) ||
      (previousVideo?.contentId ?? null) !== (nextVideo?.contentId ?? null) ||
      (previousVideo?.title ?? null) !== (nextVideo?.title ?? null);
    const subtitleChanged =
      subtitleSignature(previousVideo?.subtitles) !==
      subtitleSignature(nextVideo?.subtitles);

    activeVideo = nextVideo;
    videoStateLoaded = true;

    if (activeView === "video") {
      const hasProgressDom =
        document.getElementById("video-progress-fill") !== null;

      if (!wasLoaded || identityChanged || subtitleChanged || !hasProgressDom) {
        setView("video");
      } else if (nextVideo) {
        updateVideoProgressDom(nextVideo);
      }
    }
  } catch (error) {
    if (requestId !== videoRequestId) {
      return;
    }

    const shouldRender =
      videoStateLoaded ||
      document.getElementById("video-progress-fill") !== null;
    activeVideo = null;
    videoStateLoaded = true;

    if (activeView === "video" && shouldRender) {
      setView("video");
    }

    console.error(`${LOG_PREFIX} 读取视频状态失败`, error);
  }
}

function resetAnalysisForQuestion(question: QuestionSnapshot | null): void {
  const fingerprint = question?.fingerprint ?? null;

  if (analysisState.questionFingerprint !== fingerprint) {
    cancelAutoAnalysis();
    analysisState = {
      questionFingerprint: fingerprint,
      status: "idle",
      result: null,
      model: null,
      error: null
    };
  }
}

async function refreshActiveQuestionState(): Promise<void> {
  const requestId = ++questionRequestId;

  try {
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });
    const snapshot = await readActiveQuestionSnapshot();

    if (requestId !== questionRequestId) {
      return;
    }

    const nextQuestion =
      typeof activeTab?.id === "number" && snapshot?.tabId === activeTab.id
        ? snapshot.question
        : null;
    const changed =
      !questionStateLoaded ||
      nextQuestion?.fingerprint !== activeQuestion?.fingerprint ||
      (nextQuestion === null) !== (activeQuestion === null);

    activeQuestion = nextQuestion;
    questionStateLoaded = true;
    resetAnalysisForQuestion(nextQuestion);
    maybeScheduleAutoAnalysis(nextQuestion);

    if (activeView === "questions" && changed) {
      setView("questions");
    }
  } catch (error) {
    if (requestId !== questionRequestId) {
      return;
    }

    const shouldRender = questionStateLoaded || activeQuestion !== null;
    activeQuestion = null;
    questionStateLoaded = true;
    resetAnalysisForQuestion(null);
    maybeScheduleAutoAnalysis(null);

    if (activeView === "questions" && shouldRender) {
      setView("questions");
    }

    console.error(`${LOG_PREFIX} 读取题目状态失败`, error);
  }
}

function getApiOriginPattern(baseUrl: string): string | null {
  try {
    const url = new URL(baseUrl);
    return `${url.protocol}//${url.hostname}/*`;
  } catch {
    return null;
  }
}

function renderQuestionViewIfActive(fingerprint: string): void {
  if (
    activeView === "questions" &&
    activeQuestion?.fingerprint === fingerprint
  ) {
    setView("questions");
  }
}

function getAnalysisCacheKey(fingerprint: string): string | null {
  const summary = cachedApiSummary;

  if (!summary) {
    return null;
  }

  return `${summary.baseUrl}\n${summary.model}\n${fingerprint}`;
}

function readCachedAnalysis(fingerprint: string): CachedAnalysis | null {
  const key = getAnalysisCacheKey(fingerprint);
  return key ? analysisCache.get(key) ?? null : null;
}

function writeCachedAnalysis(
  fingerprint: string,
  result: QuestionAnalysis,
  model: string
): void {
  const key = getAnalysisCacheKey(fingerprint);

  if (!key) {
    return;
  }

  analysisCache.delete(key);
  analysisCache.set(key, { result, model });

  while (analysisCache.size > ANALYSIS_CACHE_LIMIT) {
    const oldestKey = analysisCache.keys().next().value;

    if (oldestKey === undefined) {
      break;
    }

    analysisCache.delete(oldestKey);
  }
}

function cancelAutoAnalysis(): void {
  if (autoAnalysisTimer !== null) {
    window.clearTimeout(autoAnalysisTimer);
    autoAnalysisTimer = null;
  }

  autoAnalysisScheduledFingerprint = null;
}

function maybeScheduleAutoAnalysis(question: QuestionSnapshot | null): void {
  if (
    !question ||
    !question.supported ||
    question.body.trim().length === 0
  ) {
    cancelAutoAnalysis();
    return;
  }

  const summary = cachedApiSummary;

  if (!summary || !summary.autoAnalyze || !isApiReady(summary)) {
    if (!summary?.autoAnalyze) {
      cancelAutoAnalysis();
    }
    return;
  }

  const fingerprint = question.fingerprint;

  if (analysisState.questionFingerprint === fingerprint) {
    if (
      analysisState.status === "loading" ||
      analysisState.status === "success" ||
      analysisState.status === "error" ||
      analysisState.status === "permission"
    ) {
      return;
    }
  }

  const cached = readCachedAnalysis(fingerprint);

  if (cached) {
    analysisState = {
      questionFingerprint: fingerprint,
      status: "success",
      result: cached.result,
      model: cached.model,
      error: null
    };
    renderQuestionViewIfActive(fingerprint);
    return;
  }

  if (autoAnalysisTimer !== null) {
    if (autoAnalysisScheduledFingerprint === fingerprint) {
      return;
    }

    cancelAutoAnalysis();
  }

  autoAnalysisScheduledFingerprint = fingerprint;
  autoAnalysisTimer = window.setTimeout(() => {
    autoAnalysisTimer = null;
    autoAnalysisScheduledFingerprint = null;

    if (activeQuestion?.fingerprint !== fingerprint) {
      return;
    }

    if (!isApiReady(cachedApiSummary) || !cachedApiSummary?.autoAnalyze) {
      return;
    }

    void analyzeActiveQuestion(fingerprint, { auto: true });
  }, AUTO_ANALYSIS_DELAY_MS);
}

interface AnalyzeOptions {
  readonly force?: boolean;
  readonly auto?: boolean;
}

async function analyzeActiveQuestion(
  expectedFingerprint?: string,
  options: AnalyzeOptions = {}
): Promise<void> {
  const question = activeQuestion;

  if (!question || !question.supported || !questionStateLoaded) {
    return;
  }

  if (
    expectedFingerprint &&
    expectedFingerprint !== question.fingerprint
  ) {
    return;
  }

  if (
    analysisState.questionFingerprint === question.fingerprint &&
    analysisState.status === "loading"
  ) {
    return;
  }

  const fingerprint = question.fingerprint;

  if (!options.force) {
    if (
      analysisState.questionFingerprint === fingerprint &&
      analysisState.status === "success"
    ) {
      return;
    }

    const cached = readCachedAnalysis(fingerprint);

    if (cached) {
      analysisState = {
        questionFingerprint: fingerprint,
        status: "success",
        result: cached.result,
        model: cached.model,
        error: null
      };
      renderQuestionViewIfActive(fingerprint);
      return;
    }
  }

  const summary = cachedApiSummary;

  if (!isApiReady(summary) || !summary) {
    if (options.auto) {
      return;
    }

    analysisState = {
      questionFingerprint: fingerprint,
      status: "error",
      result: null,
      model: null,
      error: "请先在 API 设置中填写 API 地址、模型 ID 和 API Key。"
    };
    renderQuestionViewIfActive(fingerprint);
    return;
  }

  const originPattern = getApiOriginPattern(summary.baseUrl);

  if (!originPattern) {
    analysisState = {
      questionFingerprint: fingerprint,
      status: "error",
      result: null,
      model: null,
      error: "API 地址格式不正确，请重新保存 API 设置。"
    };
    renderQuestionViewIfActive(fingerprint);
    return;
  }

  if (options.auto) {
    let alreadyGranted = false;

    try {
      alreadyGranted = await chrome.permissions.contains({
        origins: [originPattern]
      });
    } catch {
      alreadyGranted = false;
    }

    if (!alreadyGranted) {
      analysisState = {
        questionFingerprint: fingerprint,
        status: "permission",
        result: null,
        model: null,
        error: "首次自动分析需要允许扩展访问 API 域名。"
      };
      renderQuestionViewIfActive(fingerprint);
      return;
    }
  }

  analysisState = {
    questionFingerprint: fingerprint,
    status: "loading",
    result: null,
    model: null,
    error: null
  };
  renderQuestionViewIfActive(fingerprint);

  if (!options.auto) {
    let granted = false;

    try {
      granted = await chrome.permissions.request({
        origins: [originPattern]
      });
    } catch (error) {
      analysisState = {
        questionFingerprint: fingerprint,
        status: "error",
        result: null,
        model: null,
        error: `无法申请 API 域名访问权限：${toErrorMessage(error)}`
      };
      renderQuestionViewIfActive(fingerprint);
      return;
    }

    if (!granted) {
      analysisState = {
        questionFingerprint: fingerprint,
        status: "error",
        result: null,
        model: null,
        error: "未授予 API 域名访问权限，无法调用 DeepSeek。"
      };
      renderQuestionViewIfActive(fingerprint);
      return;
    }
  }

  const payload: QuestionAnalysisPayload = {
    courseName: activePageContext?.courseName ?? null,
    taskTitle: activePageContext?.taskTitle ?? null,
    question: {
      kind: question.kind,
      kindLabel: question.kindLabel,
      index: question.index,
      body: question.body,
      options: question.options
    }
  };

  try {
    const response: unknown = await chrome.runtime.sendMessage({
      type: RUNTIME_MESSAGE_TYPES.analyzeQuestion,
      payload
    });

    if (activeQuestion?.fingerprint !== fingerprint) {
      return;
    }

    if (!isQuestionAnalysisResponse(response)) {
      throw new Error("AI 分析服务返回了无法识别的结果。");
    }

    if (response.ok) {
      writeCachedAnalysis(fingerprint, response.analysis, response.model);
      analysisState = {
        questionFingerprint: fingerprint,
        status: "success",
        result: response.analysis,
        model: response.model,
        error: null
      };
    } else {
      analysisState = {
        questionFingerprint: fingerprint,
        status: "error",
        result: null,
        model: null,
        error: response.error
      };
    }
  } catch (error) {
    if (activeQuestion?.fingerprint !== fingerprint) {
      return;
    }

    analysisState = {
      questionFingerprint: fingerprint,
      status: "error",
      result: null,
      model: null,
      error: toErrorMessage(error)
    };
  }

  renderQuestionViewIfActive(fingerprint);
}

function getSettingsControls(
  form: HTMLFormElement
): SettingsControls | null {
  const baseUrlInput = form.querySelector<HTMLInputElement>("#api-base-url");
  const modelInput = form.querySelector<HTMLInputElement>("#api-model");
  const keyInput = form.querySelector<HTMLInputElement>("#api-key");
  const autoAnalyzeInput = form.querySelector<HTMLInputElement>(
    "#api-auto-analyze"
  );
  const keyToggle = form.querySelector<HTMLButtonElement>("#api-key-toggle");
  const keyState = form.querySelector<HTMLParagraphElement>("#api-key-state");
  const keyStateText = form.querySelector<HTMLSpanElement>(
    "#api-key-state-text"
  );
  const clearKeyButton =
    form.querySelector<HTMLButtonElement>("#clear-api-key");
  const submitButton = form.querySelector<HTMLButtonElement>(
    'button[type="submit"]'
  );
  const message = form.querySelector<HTMLParagraphElement>(
    "#settings-message"
  );

  if (
    !baseUrlInput ||
    !modelInput ||
    !keyInput ||
    !autoAnalyzeInput ||
    !keyToggle ||
    !keyState ||
    !keyStateText ||
    !clearKeyButton ||
    !submitButton ||
    !message
  ) {
    return null;
  }

  return {
    form,
    baseUrlInput,
    modelInput,
    keyInput,
    autoAnalyzeInput,
    keyToggle,
    keyState,
    keyStateText,
    clearKeyButton,
    submitButton,
    message
  };
}

function updateKeyUi(
  controls: SettingsControls,
  summary: ApiSettingsSummary
): void {
  controls.keyInput.placeholder = summary.hasApiKey
    ? "已保存，留空保持不变"
    : "输入 API Key";
  controls.keyState.classList.toggle("is-ready", summary.hasApiKey);
  controls.keyStateText.textContent = summary.hasApiKey
    ? "API Key 已保存在本机"
    : "尚未保存 API Key";
  controls.clearKeyButton.disabled = !summary.hasApiKey;
}

function setSettingsMessage(
  controls: SettingsControls,
  text: string,
  type: "muted" | "success" | "error"
): void {
  controls.message.textContent = text;
  controls.message.classList.toggle("is-success", type === "success");
  controls.message.classList.toggle("is-error", type === "error");
}

function normalizeBaseUrl(rawValue: string): string {
  const value = rawValue.trim();

  if (value.length === 0) {
    throw new Error("请填写 API 地址。");
  }

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error("API 地址格式不正确。");
  }

  const isLoopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]" ||
    url.hostname === "::1";

  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) {
    throw new Error("API 地址必须使用 HTTPS（本机地址可使用 HTTP）。");
  }

  url.hash = "";
  url.search = "";

  return url.toString().replace(/\/+$/, "");
}

async function saveSettings(form: HTMLFormElement): Promise<void> {
  const controls = getSettingsControls(form);

  if (!controls) {
    return;
  }

  controls.baseUrlInput.classList.remove("is-invalid");
  controls.modelInput.classList.remove("is-invalid");
  setSettingsMessage(controls, "", "muted");

  let baseUrl: string;

  try {
    baseUrl = normalizeBaseUrl(controls.baseUrlInput.value);
  } catch (error) {
    controls.baseUrlInput.classList.add("is-invalid");
    controls.baseUrlInput.focus();
    setSettingsMessage(
      controls,
      toErrorMessage(error),
      "error"
    );
    return;
  }

  const model = controls.modelInput.value.trim();

  if (model.length === 0) {
    controls.modelInput.classList.add("is-invalid");
    controls.modelInput.focus();
    setSettingsMessage(controls, "请填写模型 ID。", "error");
    return;
  }

  const newApiKey = controls.keyInput.value.trim();
  const autoAnalyze = controls.autoAnalyzeInput.checked;
  const originPattern = getApiOriginPattern(baseUrl);

  controls.submitButton.disabled = true;
  controls.submitButton.textContent = "保存中…";

  // 在用户点击“保存设置”的手势内申请域名权限，
  // 这样之后的自动分析不需要再弹授权窗口。
  if (originPattern) {
    try {
      await chrome.permissions.request({ origins: [originPattern] });
    } catch {
      // 授权失败不阻止保存，手动分析时会再次尝试。
    }
  }

  try {
    const summary = await updateApiSettings({
      baseUrl,
      model,
      autoAnalyze,
      ...(newApiKey.length > 0 ? { apiKey: newApiKey } : {})
    });

    if (!form.isConnected) {
      return;
    }

    controls.baseUrlInput.value = summary.baseUrl;
    controls.modelInput.value = summary.model;
    controls.keyInput.value = "";
    updateKeyUi(controls, summary);
    updateApiIndicator(summary);
    setSettingsMessage(
      controls,
      summary.hasApiKey
        ? summary.autoAnalyze
          ? "设置已保存。检测到新题目后会自动分析。"
          : "设置已保存。自动分析已关闭，可在题目分析中手动点击。"
        : "设置已保存，但尚未配置 API Key。",
      "success"
    );
  } catch (error) {
    if (form.isConnected) {
      setSettingsMessage(
        controls,
        `保存失败：${toErrorMessage(error)}`,
        "error"
      );
    }

    console.error(`${LOG_PREFIX} 保存 API 设置失败`, error);
  } finally {
    if (form.isConnected) {
      controls.submitButton.disabled = false;
      controls.submitButton.textContent = "保存设置";
    }
  }
}

async function clearApiKey(form: HTMLFormElement): Promise<void> {
  const controls = getSettingsControls(form);

  if (!controls) {
    return;
  }

  const wasEnabled = !controls.clearKeyButton.disabled;
  let succeeded = false;
  controls.clearKeyButton.disabled = true;

  try {
    const summary = await clearStoredApiKey();
    succeeded = true;

    if (!form.isConnected) {
      return;
    }

    controls.keyInput.value = "";
    updateKeyUi(controls, summary);
    updateApiIndicator(summary);
    setSettingsMessage(controls, "已清除本地保存的 API Key。", "success");
  } catch (error) {
    if (form.isConnected) {
      setSettingsMessage(
        controls,
        `清除失败：${toErrorMessage(error)}`,
        "error"
      );
    }

    console.error(`${LOG_PREFIX} 清除 API Key 失败`, error);
  } finally {
    if (!succeeded && form.isConnected && wasEnabled) {
      controls.clearKeyButton.disabled = false;
    }
  }
}

async function hydrateSettingsForm(): Promise<void> {
  const form = document.getElementById("settings-form");

  if (!(form instanceof HTMLFormElement)) {
    return;
  }

  const controls = getSettingsControls(form);

  if (!controls) {
    return;
  }

  controls.submitButton.disabled = true;
  controls.clearKeyButton.disabled = true;

  controls.keyToggle.addEventListener("click", () => {
    const isCurrentlyHidden = controls.keyInput.type === "password";
    controls.keyInput.type = isCurrentlyHidden ? "text" : "password";
    controls.keyToggle.textContent = isCurrentlyHidden ? "隐藏" : "显示";
    controls.keyToggle.setAttribute(
      "aria-label",
      isCurrentlyHidden ? "隐藏 API Key" : "显示 API Key"
    );
  });

  controls.baseUrlInput.addEventListener("input", () => {
    controls.baseUrlInput.classList.remove("is-invalid");
  });

  controls.modelInput.addEventListener("input", () => {
    controls.modelInput.classList.remove("is-invalid");
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveSettings(form);
  });

  controls.clearKeyButton.addEventListener("click", () => {
    void clearApiKey(form);
  });

  try {
    const summary = await readApiSettingsSummary();

    if (!form.isConnected) {
      return;
    }

    controls.baseUrlInput.value = summary.baseUrl || DEFAULT_API_BASE_URL;
    controls.modelInput.value = summary.model;
    controls.autoAnalyzeInput.checked = summary.autoAnalyze;
    updateKeyUi(controls, summary);
    updateApiIndicator(summary);
  } catch (error) {
    if (form.isConnected) {
      setSettingsMessage(
        controls,
        `读取本地设置失败：${toErrorMessage(error)}`,
        "error"
      );
    }

    console.error(`${LOG_PREFIX} 读取 API 设置失败`, error);
  } finally {
    if (form.isConnected) {
      controls.submitButton.disabled = false;
    }
  }
}

function handleContentClick(event: MouseEvent): void {
  const target = event.target;

  if (!(target instanceof Element)) {
    return;
  }

  const actionTarget = target.closest<HTMLElement>("[data-action]");

  if (actionTarget?.dataset.action === "analyze-question") {
    void analyzeActiveQuestion(actionTarget.dataset.questionFingerprint);
    return;
  }

  const jumpTarget = target.closest<HTMLElement>("[data-jump]");

  if (!jumpTarget) {
    return;
  }

  const view = jumpTarget.dataset.jump;

  if (!isViewId(view)) {
    return;
  }

  setView(view);

  if (view === "video") {
    void refreshActiveVideoState();
  } else if (view === "questions") {
    void refreshActiveQuestionState();
  }

  navButtons
    .find((button) => button.dataset.view === view)
    ?.focus();
}

function handleRefresh(): void {
  refreshButton.classList.remove("is-spinning");
  refreshButton.getBoundingClientRect();
  refreshButton.classList.add("is-spinning");
  refreshButton.addEventListener(
    "animationend",
    () => {
      refreshButton.classList.remove("is-spinning");
    },
    { once: true }
  );

  void refreshApiIndicator();
  void refreshActivePageContext();
  void refreshActiveVideoState();
  void refreshActiveQuestionState();
}

function initializeUi(): void {
  versionLabel.textContent = `v${chrome.runtime.getManifest().version}`;

  for (const button of navButtons) {
    button.addEventListener("click", () => {
      const view = button.dataset.view;

      if (isViewId(view)) {
        setView(view);

        if (view === "video") {
          void refreshActiveVideoState();
        } else if (view === "questions") {
          void refreshActiveQuestionState();
        }
      }
    });
  }

  content.addEventListener("click", handleContentClick);
  refreshButton.addEventListener("click", handleRefresh);

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && STORAGE_KEYS.apiSettings in changes) {
      void refreshApiIndicator();
    }

    if (areaName === "session" && STORAGE_KEYS.activePage in changes) {
      void refreshActivePageContext();
    }

    if (areaName === "session" && STORAGE_KEYS.activeVideo in changes) {
      void refreshActiveVideoState();
    }

    if (areaName === "session" && STORAGE_KEYS.activeQuestion in changes) {
      void refreshActiveQuestionState();
    }
  });

  chrome.tabs.onActivated.addListener(() => {
    void refreshActivePageContext();
    void refreshActiveVideoState();
    void refreshActiveQuestionState();
  });

  chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (
      tab.active &&
      (changeInfo.status === "complete" || changeInfo.url !== undefined)
    ) {
      void refreshActivePageContext();
      void refreshActiveVideoState();
      void refreshActiveQuestionState();
    }
  });

  setView(activeView);
  void refreshApiIndicator();
  void refreshActivePageContext();
  void refreshActiveVideoState();
  void refreshActiveQuestionState();
}

try {
  initializeUi();
} catch (error) {
  console.error(`${LOG_PREFIX} 侧边栏初始化失败`, error);
  content.textContent = "侧边栏初始化失败，请重新加载扩展。";
}
