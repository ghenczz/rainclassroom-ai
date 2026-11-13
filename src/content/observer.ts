import { detectPageContext } from "./detector.js";
import { QuestionMonitor } from "./question.js";
import { VideoMonitor } from "./video.js";
import type {
  PageContextDetectedMessage,
  QuestionSnapshot,
  QuestionStateDetectedMessage,
  RainClassroomPageContext,
  VideoPlaybackSnapshot,
  VideoStateDetectedMessage
} from "../types/index.js";
import { LOG_PREFIX, RUNTIME_MESSAGE_TYPES } from "../types/index.js";
import { toErrorMessage } from "../utils/helpers.js";

const DETECTION_DEBOUNCE_MS = 350;
const SETTLE_CHECK_DELAYS_MS = [700, 1800] as const;

let lastFingerprint: string | null = null;
let detectionTimer: number | null = null;
let observer: MutationObserver | null = null;
let videoMonitor: VideoMonitor | null = null;
let questionMonitor: QuestionMonitor | null = null;
let stopped = false;

function stopObserving(): void {
  stopped = true;
  observer?.disconnect();
  observer = null;
  videoMonitor?.stop();
  videoMonitor = null;
  questionMonitor?.stop();
  questionMonitor = null;

  if (detectionTimer !== null) {
    window.clearTimeout(detectionTimer);
    detectionTimer = null;
  }
}

function handleMessageError(error: unknown): void {
  const message = toErrorMessage(error);

  if (
    message.includes("Extension context invalidated") ||
    message.includes("message port closed")
  ) {
    stopObserving();
    return;
  }

  console.warn(`${LOG_PREFIX} 页面上报失败：${message}`);
}

function sendRuntimeMessage(
  message:
    | PageContextDetectedMessage
    | VideoStateDetectedMessage
    | QuestionStateDetectedMessage
): void {
  try {
    void chrome.runtime.sendMessage(message).catch(handleMessageError);
  } catch (error) {
    handleMessageError(error);
  }
}

function reportVideoState(state: VideoPlaybackSnapshot): void {
  const message: VideoStateDetectedMessage = {
    type: RUNTIME_MESSAGE_TYPES.videoStateDetected,
    video: state
  };

  sendRuntimeMessage(message);
}

function stopVideoTracking(): void {
  videoMonitor?.stop();
  videoMonitor = null;
}

function syncVideoTracking(
  context: RainClassroomPageContext,
  contextChanged: boolean
): void {
  if (context.pageKind !== "video") {
    stopVideoTracking();
    return;
  }

  if (!videoMonitor || videoMonitor.contentId !== context.contentId) {
    videoMonitor?.stop();
    videoMonitor = new VideoMonitor({
      context,
      onState: reportVideoState
    });
  } else if (contextChanged) {
    videoMonitor.updateContext(context);
  }

  videoMonitor.attachIfNeeded();
}

function reportQuestionState(question: QuestionSnapshot): void {
  const message: QuestionStateDetectedMessage = {
    type: RUNTIME_MESSAGE_TYPES.questionStateDetected,
    question
  };

  sendRuntimeMessage(message);
}

function stopQuestionTracking(): void {
  questionMonitor?.stop();
  questionMonitor = null;
}

function syncQuestionTracking(context: RainClassroomPageContext): void {
  if (context.pageKind !== "exercise") {
    stopQuestionTracking();
    return;
  }

  if (!questionMonitor) {
    questionMonitor = new QuestionMonitor({
      onState: reportQuestionState
    });
  }

  questionMonitor.attachIfNeeded();
}

function reportPageContext(): void {
  if (stopped) {
    return;
  }

  const context = detectPageContext();

  if (!context) {
    stopVideoTracking();
    stopQuestionTracking();
    return;
  }

  const contextChanged = context.fingerprint !== lastFingerprint;

  if (contextChanged) {
    lastFingerprint = context.fingerprint;

    const message: PageContextDetectedMessage = {
      type: RUNTIME_MESSAGE_TYPES.pageContextDetected,
      context
    };

    sendRuntimeMessage(message);

    console.debug(`${LOG_PREFIX} 页面识别`, {
      pageKind: context.pageKind,
      courseName: context.courseName,
      taskTitle: context.taskTitle,
      confidence: context.confidence
    });
  }

  syncVideoTracking(context, contextChanged);
  syncQuestionTracking(context);
}

function scheduleDetection(): void {
  if (stopped) {
    return;
  }

  if (detectionTimer !== null) {
    window.clearTimeout(detectionTimer);
  }

  detectionTimer = window.setTimeout(() => {
    detectionTimer = null;
    reportPageContext();
  }, DETECTION_DEBOUNCE_MS);
}

function startObserving(): void {
  if (stopped) {
    return;
  }

  observer = new MutationObserver(scheduleDetection);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  window.addEventListener("popstate", scheduleDetection);
  window.addEventListener("hashchange", scheduleDetection);
  window.addEventListener("pageshow", scheduleDetection);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      scheduleDetection();
    }
  });

  reportPageContext();

  for (const delay of SETTLE_CHECK_DELAYS_MS) {
    window.setTimeout(reportPageContext, delay);
  }
}

startObserving();
