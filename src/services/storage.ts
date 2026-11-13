import {
  isActivePageSnapshot,
  isActiveQuestionSnapshot,
  isActiveVideoSnapshot
} from "../types/index.js";
import type {
  ActivePageSnapshot,
  ActiveQuestionSnapshot,
  ActiveVideoSnapshot,
  ApiSettings,
  ApiSettingsSummary,
  ApiSettingsUpdate,
  ExtensionInstallRecord,
  LifecycleReason
} from "../types/index.js";

export const STORAGE_KEYS = {
  installRecord: "rainclassroom-ai:install-record",
  apiSettings: "rainclassroom-ai:api-settings",
  activePage: "rainclassroom-ai:active-page",
  activeVideo: "rainclassroom-ai:active-video",
  activeQuestion: "rainclassroom-ai:active-question"
} as const;

export const DEFAULT_API_BASE_URL = "https://api.deepseek.com";

const LIFECYCLE_REASONS: ReadonlySet<string> = new Set([
  "install",
  "update",
  "chrome_update",
  "shared_module_update",
  "startup"
]);

function isLifecycleReason(value: unknown): value is LifecycleReason {
  return typeof value === "string" && LIFECYCLE_REASONS.has(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isExtensionInstallRecord(
  value: unknown
): value is ExtensionInstallRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    typeof record.extensionId === "string" &&
    record.extensionId.length > 0 &&
    typeof record.version === "string" &&
    record.version.length > 0 &&
    isTimestamp(record.firstInstalledAt) &&
    isTimestamp(record.lastStartedAt) &&
    isLifecycleReason(record.lastLifecycleReason)
  );
}

export async function readInstallRecord(): Promise<ExtensionInstallRecord | null> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.installRecord);
  const value: unknown = stored[STORAGE_KEYS.installRecord];

  return isExtensionInstallRecord(value) ? value : null;
}

export async function writeInstallRecord(
  record: ExtensionInstallRecord
): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEYS.installRecord]: record
  });
}

function isApiSettings(value: unknown): value is ApiSettings {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const settings = value as Record<string, unknown>;

  return (
    typeof settings.baseUrl === "string" &&
    typeof settings.model === "string" &&
    typeof settings.apiKey === "string"
  );
}

function createDefaultApiSettings(): ApiSettings {
  return {
    baseUrl: DEFAULT_API_BASE_URL,
    model: "",
    apiKey: "",
    autoAnalyze: true
  };
}

function normalizeApiSettings(settings: ApiSettings): ApiSettings {
  return {
    baseUrl: settings.baseUrl,
    model: settings.model,
    apiKey: settings.apiKey,
    // 旧版本保存的设置没有该字段，默认开启自动分析。
    autoAnalyze: settings.autoAnalyze !== false
  };
}

function summarizeApiSettings(settings: ApiSettings): ApiSettingsSummary {
  return {
    baseUrl: settings.baseUrl,
    model: settings.model,
    hasApiKey: settings.apiKey.trim().length > 0,
    autoAnalyze: settings.autoAnalyze
  };
}

export async function readApiSettings(): Promise<ApiSettings> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.apiSettings);
  const value: unknown = stored[STORAGE_KEYS.apiSettings];

  return isApiSettings(value)
    ? normalizeApiSettings(value)
    : createDefaultApiSettings();
}

export async function readApiSettingsSummary(): Promise<ApiSettingsSummary> {
  const settings = await readApiSettings();
  return summarizeApiSettings(settings);
}

export async function updateApiSettings(
  update: ApiSettingsUpdate
): Promise<ApiSettingsSummary> {
  const current = await readApiSettings();

  const next: ApiSettings = {
    baseUrl: update.baseUrl.trim(),
    model: update.model.trim(),
    apiKey:
      update.apiKey === undefined
        ? current.apiKey
        : update.apiKey.trim(),
    autoAnalyze: update.autoAnalyze ?? current.autoAnalyze
  };

  await chrome.storage.local.set({
    [STORAGE_KEYS.apiSettings]: next
  });

  return summarizeApiSettings(next);
}

export async function clearStoredApiKey(): Promise<ApiSettingsSummary> {
  const current = await readApiSettings();
  const next: ApiSettings = {
    ...current,
    apiKey: ""
  };

  await chrome.storage.local.set({
    [STORAGE_KEYS.apiSettings]: next
  });

  return summarizeApiSettings(next);
}

export async function readActivePageSnapshot(): Promise<ActivePageSnapshot | null> {
  const stored = await chrome.storage.session.get(STORAGE_KEYS.activePage);
  const value: unknown = stored[STORAGE_KEYS.activePage];

  return isActivePageSnapshot(value) ? value : null;
}

export async function writeActivePageSnapshot(
  snapshot: ActivePageSnapshot
): Promise<void> {
  await chrome.storage.session.set({
    [STORAGE_KEYS.activePage]: snapshot
  });
}

export async function clearActivePageSnapshotForTab(
  tabId: number
): Promise<void> {
  const current = await readActivePageSnapshot();

  if (current?.tabId === tabId) {
    await chrome.storage.session.remove(STORAGE_KEYS.activePage);
  }
}

export async function readActiveVideoSnapshot(): Promise<ActiveVideoSnapshot | null> {
  const stored = await chrome.storage.session.get(STORAGE_KEYS.activeVideo);
  const value: unknown = stored[STORAGE_KEYS.activeVideo];

  return isActiveVideoSnapshot(value) ? value : null;
}

export async function writeActiveVideoSnapshot(
  snapshot: ActiveVideoSnapshot
): Promise<void> {
  await chrome.storage.session.set({
    [STORAGE_KEYS.activeVideo]: snapshot
  });
}

export async function clearActiveVideoSnapshotForTab(
  tabId: number
): Promise<void> {
  const current = await readActiveVideoSnapshot();

  if (current?.tabId === tabId) {
    await chrome.storage.session.remove(STORAGE_KEYS.activeVideo);
  }
}

export async function readActiveQuestionSnapshot(): Promise<ActiveQuestionSnapshot | null> {
  const stored = await chrome.storage.session.get(
    STORAGE_KEYS.activeQuestion
  );
  const value: unknown = stored[STORAGE_KEYS.activeQuestion];

  return isActiveQuestionSnapshot(value) ? value : null;
}

export async function writeActiveQuestionSnapshot(
  snapshot: ActiveQuestionSnapshot
): Promise<void> {
  await chrome.storage.session.set({
    [STORAGE_KEYS.activeQuestion]: snapshot
  });
}

export async function clearActiveQuestionSnapshotForTab(
  tabId: number
): Promise<void> {
  const current = await readActiveQuestionSnapshot();

  if (current?.tabId === tabId) {
    await chrome.storage.session.remove(STORAGE_KEYS.activeQuestion);
  }
}
