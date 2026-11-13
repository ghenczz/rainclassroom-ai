import { analyzeQuestionWithDeepSeek } from "../services/deepseek.js";
import { getFontMappingForUrl } from "../services/font-decoder.js";
import {
  clearActivePageSnapshotForTab,
  clearActiveQuestionSnapshotForTab,
  clearActiveVideoSnapshotForTab,
  readActivePageSnapshot,
  readApiSettings,
  readInstallRecord,
  writeActivePageSnapshot,
  writeActiveQuestionSnapshot,
  writeActiveVideoSnapshot,
  writeInstallRecord
} from "../services/storage.js";
import type {
  AnalyzeQuestionMessage,
  ExtensionInstallRecord,
  LifecycleReason,
  PageContextDetectedMessage,
  QuestionAnalysisResponse,
  QuestionStateDetectedMessage,
  VideoStateDetectedMessage
} from "../types/index.js";
import {
  EXTENSION_PHASE,
  isAnalyzeQuestionMessage,
  isFontMappingRequestMessage,
  isPageContextDetectedMessage,
  isQuestionStateDetectedMessage,
  isVideoStateDetectedMessage,
  LOG_PREFIX
} from "../types/index.js";
import { nowIso, toErrorMessage } from "../utils/helpers.js";

const extensionManifest = chrome.runtime.getManifest();

async function showActiveBadge(): Promise<void> {
  await Promise.all([
    chrome.action.setBadgeText({ text: "ON" }),
    chrome.action.setBadgeBackgroundColor({ color: "#0F766E" }),
    chrome.action.setTitle({
      title: `长江雨课堂 AI 学习助手 v${extensionManifest.version} · 点击打开侧边栏`
    })
  ]);
}

async function saveLifecycleState(reason: LifecycleReason): Promise<void> {
  const previous = await readInstallRecord();
  const startedAt = nowIso();

  const record: ExtensionInstallRecord = {
    extensionId: chrome.runtime.id,
    version: extensionManifest.version,
    firstInstalledAt: previous?.firstInstalledAt ?? startedAt,
    lastStartedAt: startedAt,
    lastLifecycleReason: reason
  };

  await writeInstallRecord(record);

  console.info(`${LOG_PREFIX} 扩展生命周期已更新`, {
    phase: EXTENSION_PHASE,
    ...record
  });
}

async function initialize(reason: LifecycleReason): Promise<void> {
  try {
    await Promise.all([saveLifecycleState(reason), showActiveBadge()]);
  } catch (error) {
    console.error(`${LOG_PREFIX} 扩展初始化失败：${toErrorMessage(error)}`);
  }
}

async function openSidePanel(windowId: number): Promise<void> {
  try {
    await chrome.sidePanel.open({ windowId });
    console.info(`${LOG_PREFIX} 侧边栏已打开`, { windowId });
  } catch (error) {
    console.error(
      `${LOG_PREFIX} 打开侧边栏失败：${toErrorMessage(error)}`
    );
  }
}

async function handlePageContextMessage(
  message: PageContextDetectedMessage,
  sender: chrome.runtime.MessageSender
): Promise<void> {
  const tabId = sender.tab?.id;

  if (typeof tabId !== "number") {
    console.warn(`${LOG_PREFIX} 忽略没有标签页来源的页面识别消息。`);
    return;
  }

  const previous = await readActivePageSnapshot();

  if (
    previous?.tabId === tabId &&
    previous.context.fingerprint === message.context.fingerprint
  ) {
    return;
  }

  const snapshot = {
    context: message.context,
    tabId,
    windowId: sender.tab?.windowId ?? null,
    receivedAt: nowIso()
  } as const;

  await writeActivePageSnapshot(snapshot);

  if (message.context.pageKind !== "video") {
    await clearActiveVideoSnapshotForTab(tabId);
  }

  const contentIdentityChanged =
    previous?.tabId === tabId &&
    (previous.context.courseId !== message.context.courseId ||
      previous.context.contentId !== message.context.contentId);

  if (
    message.context.pageKind !== "exercise" ||
    contentIdentityChanged
  ) {
    await clearActiveQuestionSnapshotForTab(tabId);
  }

  console.info(`${LOG_PREFIX} 页面识别结果已更新`, {
    tabId,
    pageKind: message.context.pageKind,
    courseName: message.context.courseName,
    taskTitle: message.context.taskTitle,
    confidence: message.context.confidence
  });
}

async function handleVideoStateMessage(
  message: VideoStateDetectedMessage,
  sender: chrome.runtime.MessageSender
): Promise<void> {
  const tabId = sender.tab?.id;

  if (typeof tabId !== "number") {
    return;
  }

  const snapshot = {
    video: message.video,
    tabId,
    windowId: sender.tab?.windowId ?? null,
    receivedAt: nowIso()
  } as const;

  await writeActiveVideoSnapshot(snapshot);
}

async function handleQuestionStateMessage(
  message: QuestionStateDetectedMessage,
  sender: chrome.runtime.MessageSender
): Promise<void> {
  const tabId = sender.tab?.id;

  if (typeof tabId !== "number") {
    return;
  }

  const snapshot = {
    question: message.question,
    tabId,
    windowId: sender.tab?.windowId ?? null,
    receivedAt: nowIso()
  } as const;

  await writeActiveQuestionSnapshot(snapshot);
}

async function handleAnalyzeQuestion(
  message: AnalyzeQuestionMessage
): Promise<QuestionAnalysisResponse> {
  try {
    const settings = await readApiSettings();
    const result = await analyzeQuestionWithDeepSeek(
      settings,
      message.payload
    );

    return {
      ok: true,
      analysis: result.analysis,
      model: result.model
    };
  } catch (error) {
    return {
      ok: false,
      error: toErrorMessage(error)
    };
  }
}

async function clearTabPageContext(tabId: number): Promise<void> {
  try {
    await Promise.all([
      clearActivePageSnapshotForTab(tabId),
      clearActiveVideoSnapshotForTab(tabId),
      clearActiveQuestionSnapshotForTab(tabId)
    ]);
  } catch (error) {
    console.error(
      `${LOG_PREFIX} 清理标签页识别状态失败：${toErrorMessage(error)}`
    );
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  void initialize(details.reason);
});

chrome.runtime.onStartup.addListener(() => {
  void initialize("startup");
});

chrome.action.onClicked.addListener((tab) => {
  if (typeof tab.windowId !== "number") {
    console.warn(`${LOG_PREFIX} 无法确定当前浏览器窗口。`);
    return;
  }

  void openSidePanel(tab.windowId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (isFontMappingRequestMessage(message)) {
    void getFontMappingForUrl(message.fontUrl)
      .then((mapping) => {
        sendResponse({ ok: true, mapping });
      })
      .catch((error: unknown) => {
        sendResponse({
          ok: false,
          error: toErrorMessage(error)
        });
      });

    return true;
  }

  if (isAnalyzeQuestionMessage(message)) {
    void handleAnalyzeQuestion(message)
      .then((response) => {
        sendResponse(response);
      })
      .catch((error: unknown) => {
        sendResponse({
          ok: false,
          error: toErrorMessage(error)
        } satisfies QuestionAnalysisResponse);
      });

    return true;
  }

  if (isPageContextDetectedMessage(message)) {
    void handlePageContextMessage(message, sender).catch((error: unknown) => {
      console.error(
        `${LOG_PREFIX} 保存页面识别结果失败：${toErrorMessage(error)}`
      );
    });

    return false;
  }

  if (isVideoStateDetectedMessage(message)) {
    void handleVideoStateMessage(message, sender).catch((error: unknown) => {
      console.error(
        `${LOG_PREFIX} 保存视频状态失败：${toErrorMessage(error)}`
      );
    });

    return false;
  }

  if (isQuestionStateDetectedMessage(message)) {
    void handleQuestionStateMessage(message, sender).catch(
      (error: unknown) => {
        console.error(
          `${LOG_PREFIX} 保存题目状态失败：${toErrorMessage(error)}`
        );
      }
    );
  }

  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void clearTabPageContext(tabId);
});
