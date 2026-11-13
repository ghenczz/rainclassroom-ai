import type {
  DetectionConfidence,
  RainClassroomPageContext,
  RainClassroomPageKind
} from "../types/index.js";

export const RAIN_CLASSROOM_HOST = "changjiang.yuketang.cn";

const LMS_CONTENT_ROUTE =
  /^\/ai-workspace\/lms-graph\/(\d+)\/([^/]+)\/(\d+)(?:\/|$)/;

const COURSE_NAME_SELECTOR = ".learning-space-header__primary";
const COURSE_SECONDARY_SELECTOR = ".learning-space-header__secondary";
const TASK_TITLE_SELECTOR = ".unit-title";
const VIDEO_SELECTORS = [
  ".learning-space-video",
  "video.xt_video_player"
];
const EXERCISE_SELECTORS = [
  ".lms-graph-exercise",
  "iframe#iframeExerciseId"
];

function normalizeText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
}

function readText(document: Document, selector: string): string | null {
  const element = document.querySelector(selector);
  return normalizeText(element?.textContent);
}

function hasAnySelector(document: Document, selectors: readonly string[]): boolean {
  return selectors.some((selector) => document.querySelector(selector) !== null);
}

function isSupportedKind(value: string | undefined): value is "video" | "exercise" {
  return value === "video" || value === "exercise";
}

export function isRainClassroomUrl(value: string): boolean {
  try {
    return new URL(value).hostname === RAIN_CLASSROOM_HOST;
  } catch {
    return false;
  }
}

export function detectPageContext(
  document: Document = window.document,
  href: string = window.location.href
): RainClassroomPageContext | null {
  if (!isRainClassroomUrl(href)) {
    return null;
  }

  const url = new URL(href);
  const routeMatch = url.pathname.match(LMS_CONTENT_ROUTE);
  const routeKind = isSupportedKind(routeMatch?.[2])
    ? routeMatch[2]
    : null;
  const courseId = routeMatch?.[1] ?? null;
  const contentId = routeMatch?.[3] ?? null;
  const nodeId = url.searchParams.get("node_id");

  const hasVideoDom = hasAnySelector(document, VIDEO_SELECTORS);
  const hasExerciseDom = hasAnySelector(document, EXERCISE_SELECTORS);

  let domKind: "video" | "exercise" | null = null;

  if (hasVideoDom && !hasExerciseDom) {
    domKind = "video";
  } else if (hasExerciseDom && !hasVideoDom) {
    domKind = "exercise";
  }

  const pageKind: RainClassroomPageKind = routeKind ?? domKind ?? "other";

  let confidence: DetectionConfidence = "low";

  if (routeKind !== null && domKind === routeKind) {
    confidence = "high";
  } else if (routeKind !== null || domKind !== null) {
    confidence = "medium";
  }

  const courseName = readText(document, COURSE_NAME_SELECTOR);
  const courseSecondaryName = readText(
    document,
    COURSE_SECONDARY_SELECTOR
  );
  const taskTitle = readText(document, TASK_TITLE_SELECTOR);

  const fingerprint = JSON.stringify([
    pageKind,
    url.pathname,
    courseId,
    contentId,
    nodeId,
    courseName,
    courseSecondaryName,
    taskTitle
  ]);

  return {
    isRainClassroom: true,
    pageKind,
    courseName,
    courseSecondaryName,
    taskTitle,
    url: href,
    courseId,
    contentId,
    nodeId,
    confidence,
    detectedAt: new Date().toISOString(),
    fingerprint
  };
}
