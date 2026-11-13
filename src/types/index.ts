export const EXTENSION_PHASE = 5;
export const LOG_PREFIX = "[RainClassroom AI]";

export type LifecycleReason =
  | chrome.runtime.InstalledDetails["reason"]
  | "startup";

export interface ExtensionInstallRecord {
  readonly extensionId: string;
  readonly version: string;
  readonly firstInstalledAt: string;
  readonly lastStartedAt: string;
  readonly lastLifecycleReason: LifecycleReason;
}

export interface ApiSettings {
  baseUrl: string;
  model: string;
  apiKey: string;
  autoAnalyze: boolean;
}

export interface ApiSettingsSummary {
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  autoAnalyze: boolean;
}

export interface ApiSettingsUpdate {
  baseUrl: string;
  model: string;
  apiKey?: string;
  autoAnalyze?: boolean;
}

export type RainClassroomPageKind = "video" | "exercise" | "other";

export type DetectionConfidence = "high" | "medium" | "low";

export interface RainClassroomPageContext {
  readonly isRainClassroom: true;
  readonly pageKind: RainClassroomPageKind;
  readonly courseName: string | null;
  readonly courseSecondaryName: string | null;
  readonly taskTitle: string | null;
  readonly url: string;
  readonly courseId: string | null;
  readonly contentId: string | null;
  readonly nodeId: string | null;
  readonly confidence: DetectionConfidence;
  readonly detectedAt: string;
  readonly fingerprint: string;
}

export interface ActivePageSnapshot {
  readonly context: RainClassroomPageContext;
  readonly tabId: number;
  readonly windowId: number | null;
  readonly receivedAt: string;
}

export type VideoSubtitleSource = "text-track" | "none";

export interface VideoSubtitleState {
  readonly trackCount: number;
  readonly cueCount: number;
  readonly source: VideoSubtitleSource;
  readonly label: string | null;
  readonly language: string | null;
  readonly preview: string | null;
}

export interface VideoPlaybackSnapshot {
  readonly courseId: string | null;
  readonly contentId: string | null;
  readonly title: string | null;
  readonly currentTime: number;
  readonly duration: number;
  readonly progress: number;
  readonly paused: boolean;
  readonly ended: boolean;
  readonly playbackRate: number;
  readonly subtitles: VideoSubtitleState;
  readonly updatedAt: string;
}

export interface ActiveVideoSnapshot {
  readonly video: VideoPlaybackSnapshot;
  readonly tabId: number;
  readonly windowId: number | null;
  readonly receivedAt: string;
}

export interface VideoProgressRecord {
  readonly courseId: string;
  readonly contentId: string;
  readonly title: string | null;
  readonly currentTime: number;
  readonly duration: number;
  readonly progress: number;
  readonly completed: boolean;
  readonly updatedAt: string;
}

export type QuestionKind =
  | "single-choice"
  | "multiple-choice"
  | "judgment"
  | "fill-blank"
  | "unknown";

export interface QuestionOption {
  readonly key: string;
  readonly text: string;
}

export interface QuestionSnapshot {
  readonly kind: QuestionKind;
  readonly kindLabel: string;
  readonly index: number | null;
  readonly body: string;
  readonly options: readonly QuestionOption[];
  readonly blankCount: number | null;
  readonly fontHash: string | null;
  readonly supported: boolean;
  readonly unsupportedReason: string | null;
  readonly fingerprint: string;
  readonly detectedAt: string;
}

export interface ActiveQuestionSnapshot {
  readonly question: QuestionSnapshot;
  readonly tabId: number;
  readonly windowId: number | null;
  readonly receivedAt: string;
}

export interface QuestionAnalysis {
  readonly questionType: QuestionKind;
  readonly candidateAnswers: readonly string[];
  readonly analysis: string;
  readonly confidence: number;
  readonly uncertain: boolean;
  readonly uncertaintyReason: string | null;
}

export interface QuestionAnalysisPayload {
  readonly courseName: string | null;
  readonly taskTitle: string | null;
  readonly question: {
    readonly kind: QuestionKind;
    readonly kindLabel: string;
    readonly index: number | null;
    readonly body: string;
    readonly options: readonly QuestionOption[];
  };
}

export interface QuestionAnalysisSuccessResponse {
  readonly ok: true;
  readonly analysis: QuestionAnalysis;
  readonly model: string;
}

export interface QuestionAnalysisErrorResponse {
  readonly ok: false;
  readonly error: string;
}

export type QuestionAnalysisResponse =
  | QuestionAnalysisSuccessResponse
  | QuestionAnalysisErrorResponse;

export const RUNTIME_MESSAGE_TYPES = {
  pageContextDetected: "rainclassroom-ai:page-context-detected",
  videoStateDetected: "rainclassroom-ai:video-state-detected",
  questionStateDetected: "rainclassroom-ai:question-state-detected",
  analyzeQuestion: "rainclassroom-ai:analyze-question",
  getFontMapping: "rainclassroom-ai:get-font-mapping"
} as const;

export interface PageContextDetectedMessage {
  readonly type: typeof RUNTIME_MESSAGE_TYPES.pageContextDetected;
  readonly context: RainClassroomPageContext;
}

export interface VideoStateDetectedMessage {
  readonly type: typeof RUNTIME_MESSAGE_TYPES.videoStateDetected;
  readonly video: VideoPlaybackSnapshot;
}

export interface QuestionStateDetectedMessage {
  readonly type: typeof RUNTIME_MESSAGE_TYPES.questionStateDetected;
  readonly question: QuestionSnapshot;
}

export interface AnalyzeQuestionMessage {
  readonly type: typeof RUNTIME_MESSAGE_TYPES.analyzeQuestion;
  readonly payload: QuestionAnalysisPayload;
}

export interface FontMappingRequestMessage {
  readonly type: typeof RUNTIME_MESSAGE_TYPES.getFontMapping;
  readonly fontUrl: string;
}

export interface FontMappingSuccessResponse {
  readonly ok: true;
  readonly mapping: Readonly<Record<string, string>>;
}

export interface FontMappingErrorResponse {
  readonly ok: false;
  readonly error: string;
}

export type FontMappingResponse =
  | FontMappingSuccessResponse
  | FontMappingErrorResponse;

const PAGE_KINDS: ReadonlySet<string> = new Set([
  "video",
  "exercise",
  "other"
]);

const CONFIDENCE_LEVELS: ReadonlySet<string> = new Set([
  "high",
  "medium",
  "low"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

export function isRainClassroomPageContext(
  value: unknown
): value is RainClassroomPageContext {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.isRainClassroom === true &&
    typeof value.pageKind === "string" &&
    PAGE_KINDS.has(value.pageKind) &&
    isNullableString(value.courseName) &&
    isNullableString(value.courseSecondaryName) &&
    isNullableString(value.taskTitle) &&
    typeof value.url === "string" &&
    value.url.length > 0 &&
    isNullableString(value.courseId) &&
    isNullableString(value.contentId) &&
    isNullableString(value.nodeId) &&
    typeof value.confidence === "string" &&
    CONFIDENCE_LEVELS.has(value.confidence) &&
    typeof value.detectedAt === "string" &&
    typeof value.fingerprint === "string" &&
    value.fingerprint.length > 0
  );
}

export function isActivePageSnapshot(
  value: unknown
): value is ActivePageSnapshot {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isRainClassroomPageContext(value.context) &&
    typeof value.tabId === "number" &&
    Number.isInteger(value.tabId) &&
    value.tabId >= 0 &&
    (value.windowId === null ||
      (typeof value.windowId === "number" &&
        Number.isInteger(value.windowId))) &&
    typeof value.receivedAt === "string"
  );
}

export function isPageContextDetectedMessage(
  value: unknown
): value is PageContextDetectedMessage {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.type === RUNTIME_MESSAGE_TYPES.pageContextDetected &&
    isRainClassroomPageContext(value.context)
  );
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isVideoSubtitleState(value: unknown): value is VideoSubtitleState {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.trackCount === "number" &&
    Number.isInteger(value.trackCount) &&
    value.trackCount >= 0 &&
    typeof value.cueCount === "number" &&
    Number.isInteger(value.cueCount) &&
    value.cueCount >= 0 &&
    (value.source === "text-track" || value.source === "none") &&
    isNullableString(value.label) &&
    isNullableString(value.language) &&
    isNullableString(value.preview)
  );
}

export function isVideoPlaybackSnapshot(
  value: unknown
): value is VideoPlaybackSnapshot {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isNullableString(value.courseId) &&
    isNullableString(value.contentId) &&
    isNullableString(value.title) &&
    isFiniteNonNegativeNumber(value.currentTime) &&
    isFiniteNonNegativeNumber(value.duration) &&
    typeof value.progress === "number" &&
    Number.isFinite(value.progress) &&
    value.progress >= 0 &&
    value.progress <= 1 &&
    typeof value.paused === "boolean" &&
    typeof value.ended === "boolean" &&
    typeof value.playbackRate === "number" &&
    Number.isFinite(value.playbackRate) &&
    value.playbackRate > 0 &&
    isVideoSubtitleState(value.subtitles) &&
    typeof value.updatedAt === "string"
  );
}

export function isActiveVideoSnapshot(
  value: unknown
): value is ActiveVideoSnapshot {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isVideoPlaybackSnapshot(value.video) &&
    typeof value.tabId === "number" &&
    Number.isInteger(value.tabId) &&
    value.tabId >= 0 &&
    (value.windowId === null ||
      (typeof value.windowId === "number" &&
        Number.isInteger(value.windowId))) &&
    typeof value.receivedAt === "string"
  );
}

export function isVideoStateDetectedMessage(
  value: unknown
): value is VideoStateDetectedMessage {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.type === RUNTIME_MESSAGE_TYPES.videoStateDetected &&
    isVideoPlaybackSnapshot(value.video)
  );
}

const QUESTION_KINDS: ReadonlySet<string> = new Set([
  "single-choice",
  "multiple-choice",
  "judgment",
  "fill-blank",
  "unknown"
]);

function isQuestionKind(value: unknown): value is QuestionKind {
  return typeof value === "string" && QUESTION_KINDS.has(value);
}

function isQuestionOption(value: unknown): value is QuestionOption {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.key === "string" &&
    value.key.length > 0 &&
    typeof value.text === "string"
  );
}

export function isQuestionSnapshot(value: unknown): value is QuestionSnapshot {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isQuestionKind(value.kind) &&
    typeof value.kindLabel === "string" &&
    (value.index === null ||
      (typeof value.index === "number" && Number.isInteger(value.index))) &&
    typeof value.body === "string" &&
    Array.isArray(value.options) &&
    value.options.every(isQuestionOption) &&
    (value.blankCount === null ||
      (typeof value.blankCount === "number" &&
        Number.isInteger(value.blankCount) &&
        value.blankCount >= 0)) &&
    isNullableString(value.fontHash) &&
    typeof value.supported === "boolean" &&
    isNullableString(value.unsupportedReason) &&
    typeof value.fingerprint === "string" &&
    value.fingerprint.length > 0 &&
    typeof value.detectedAt === "string"
  );
}

export function isActiveQuestionSnapshot(
  value: unknown
): value is ActiveQuestionSnapshot {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isQuestionSnapshot(value.question) &&
    typeof value.tabId === "number" &&
    Number.isInteger(value.tabId) &&
    value.tabId >= 0 &&
    (value.windowId === null ||
      (typeof value.windowId === "number" &&
        Number.isInteger(value.windowId))) &&
    typeof value.receivedAt === "string"
  );
}

export function isQuestionStateDetectedMessage(
  value: unknown
): value is QuestionStateDetectedMessage {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.type === RUNTIME_MESSAGE_TYPES.questionStateDetected &&
    isQuestionSnapshot(value.question)
  );
}

export function isQuestionAnalysis(value: unknown): value is QuestionAnalysis {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isQuestionKind(value.questionType) &&
    Array.isArray(value.candidateAnswers) &&
    value.candidateAnswers.length <= 20 &&
    value.candidateAnswers.every((answer) => typeof answer === "string") &&
    typeof value.analysis === "string" &&
    value.analysis.length > 0 &&
    typeof value.confidence === "number" &&
    Number.isFinite(value.confidence) &&
    value.confidence >= 0 &&
    value.confidence <= 1 &&
    typeof value.uncertain === "boolean" &&
    isNullableString(value.uncertaintyReason)
  );
}

function isQuestionAnalysisPayload(
  value: unknown
): value is QuestionAnalysisPayload {
  if (!isRecord(value)) {
    return false;
  }

  const question = value.question;

  if (!isRecord(question)) {
    return false;
  }

  return (
    isNullableString(value.courseName) &&
    isNullableString(value.taskTitle) &&
    isQuestionKind(question.kind) &&
    typeof question.kindLabel === "string" &&
    (question.index === null ||
      (typeof question.index === "number" &&
        Number.isInteger(question.index))) &&
    typeof question.body === "string" &&
    question.body.length > 0 &&
    Array.isArray(question.options) &&
    question.options.length <= 50 &&
    question.options.every(isQuestionOption)
  );
}

export function isAnalyzeQuestionMessage(
  value: unknown
): value is AnalyzeQuestionMessage {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.type === RUNTIME_MESSAGE_TYPES.analyzeQuestion &&
    isQuestionAnalysisPayload(value.payload)
  );
}

export function isQuestionAnalysisResponse(
  value: unknown
): value is QuestionAnalysisResponse {
  if (!isRecord(value)) {
    return false;
  }

  if (value.ok === false) {
    return typeof value.error === "string";
  }

  return (
    value.ok === true &&
    isQuestionAnalysis(value.analysis) &&
    typeof value.model === "string"
  );
}

export function isFontMappingRequestMessage(
  value: unknown
): value is FontMappingRequestMessage {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.type === RUNTIME_MESSAGE_TYPES.getFontMapping &&
    typeof value.fontUrl === "string" &&
    value.fontUrl.length > 0
  );
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) {
    return false;
  }

  return Object.values(value).every((item) => typeof item === "string");
}

export function isFontMappingResponse(
  value: unknown
): value is FontMappingResponse {
  if (!isRecord(value)) {
    return false;
  }

  if (value.ok === false) {
    return typeof value.error === "string";
  }

  return value.ok === true && isStringRecord(value.mapping);
}
