import { saveVideoProgress } from "../services/video-progress.js";
import type {
  RainClassroomPageContext,
  VideoPlaybackSnapshot,
  VideoSubtitleState
} from "../types/index.js";
import { LOG_PREFIX } from "../types/index.js";
import { toErrorMessage } from "../utils/helpers.js";

const VIDEO_SELECTOR = "video.xt_video_player, video";
const PLAYBACK_EMIT_INTERVAL_MS = 2000;
const PROGRESS_SAVE_INTERVAL_MS = 5000;
const SUBTITLE_REFRESH_INTERVAL_MS = 5000;

export interface TextTrackCueLike {
  readonly startTime: number;
  readonly endTime: number;
  readonly text: string;
}

export interface TextTrackLike {
  readonly kind: string;
  readonly label: string;
  readonly language: string;
  readonly mode: string;
  readonly cues: ArrayLike<TextTrackCueLike> | null;
}

export interface SubtitleCue {
  readonly startTime: number;
  readonly endTime: number;
  readonly text: string;
}

export interface AccessibleSubtitles {
  readonly state: VideoSubtitleState;
  readonly cues: readonly SubtitleCue[];
}

export interface VideoMonitorOptions {
  readonly context: RainClassroomPageContext;
  readonly onState: (state: VideoPlaybackSnapshot) => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function normalizeCueText(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readTrackCues(track: TextTrackLike): SubtitleCue[] {
  if (!track.cues) {
    return [];
  }

  const seen = new Set<string>();
  const cues: SubtitleCue[] = [];

  for (const cue of Array.from(track.cues)) {
    const startTime = Number.isFinite(cue.startTime) ? cue.startTime : 0;
    const endTime = Number.isFinite(cue.endTime) ? cue.endTime : 0;
    const text = normalizeCueText(cue.text);

    if (text.length === 0 || endTime < startTime) {
      continue;
    }

    const dedupeKey = `${startTime}:${endTime}:${text}`;

    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    cues.push({ startTime, endTime, text });
  }

  return cues.sort((left, right) => left.startTime - right.startTime);
}

function scoreTrack(track: TextTrackLike, cueCount: number): number {
  const language = track.language.trim().toLowerCase();
  const label = track.label.trim().toLowerCase();
  const isChinese =
    language.startsWith("zh") ||
    label.includes("中文") ||
    label.includes("chinese");

  return (
    (isChinese ? 1_000_000 : 0) +
    (track.mode === "showing" ? 100_000 : 0) +
    cueCount
  );
}

export function extractAccessibleSubtitles(
  tracks: readonly TextTrackLike[]
): AccessibleSubtitles {
  const subtitleTracks = tracks.filter(
    (track) => track.kind === "subtitles" || track.kind === "captions"
  );

  let selected:
    | { track: TextTrackLike; cues: SubtitleCue[]; score: number }
    | null = null;

  for (const track of subtitleTracks) {
    const cues = readTrackCues(track);

    if (cues.length === 0) {
      continue;
    }

    const score = scoreTrack(track, cues.length);

    if (selected === null || score > selected.score) {
      selected = { track, cues, score };
    }
  }

  const state: VideoSubtitleState = {
    trackCount: subtitleTracks.length,
    cueCount: selected?.cues.length ?? 0,
    source: selected ? "text-track" : "none",
    label: selected?.track.label.trim() || null,
    language: selected?.track.language.trim() || null,
    preview: selected
      ? selected.cues
          .slice(0, 2)
          .map((cue) => cue.text)
          .join(" / ")
          .slice(0, 220)
      : null
  };

  return {
    state,
    cues: selected?.cues ?? []
  };
}

export function findVideoElement(
  documentRef: Document = document
): HTMLVideoElement | null {
  return documentRef.querySelector<HTMLVideoElement>(VIDEO_SELECTOR);
}

export class VideoMonitor {
  private context: RainClassroomPageContext;

  private readonly onState: (state: VideoPlaybackSnapshot) => void;

  private video: HTMLVideoElement | null = null;

  private abortController: AbortController | null = null;

  private subtitleState: VideoSubtitleState = {
    trackCount: 0,
    cueCount: 0,
    source: "none",
    label: null,
    language: null,
    preview: null
  };

  private subtitleCues: readonly SubtitleCue[] = [];

  private lastEmitAt = 0;

  private lastSaveAt = 0;

  private lastSubtitleRefreshAt = 0;

  private stopped = false;

  constructor(options: VideoMonitorOptions) {
    this.context = options.context;
    this.onState = options.onState;
  }

  get contentId(): string | null {
    return this.context.contentId;
  }

  getSubtitleCues(): readonly SubtitleCue[] {
    return this.subtitleCues;
  }

  updateContext(context: RainClassroomPageContext): void {
    this.context = context;

    if (this.video) {
      this.emit(this.video, true);
    }
  }

  attachIfNeeded(): void {
    if (this.stopped) {
      return;
    }

    const nextVideo = findVideoElement();

    if (!nextVideo || nextVideo === this.video) {
      return;
    }

    this.detachElement();
    this.video = nextVideo;

    const controller = new AbortController();
    this.abortController = controller;
    const options = { signal: controller.signal };

    nextVideo.addEventListener(
      "loadedmetadata",
      () => this.handlePlaybackEvent(nextVideo, false),
      options
    );
    nextVideo.addEventListener(
      "loadeddata",
      () => this.handlePlaybackEvent(nextVideo, false),
      options
    );
    nextVideo.addEventListener(
      "durationchange",
      () => this.handlePlaybackEvent(nextVideo, false),
      options
    );
    nextVideo.addEventListener(
      "play",
      () => this.handlePlaybackEvent(nextVideo, false),
      options
    );
    nextVideo.addEventListener(
      "pause",
      () => this.handlePlaybackEvent(nextVideo, true),
      options
    );
    nextVideo.addEventListener(
      "seeked",
      () => this.handlePlaybackEvent(nextVideo, true),
      options
    );
    nextVideo.addEventListener(
      "ratechange",
      () => this.handlePlaybackEvent(nextVideo, false),
      options
    );
    nextVideo.addEventListener(
      "ended",
      () => this.handlePlaybackEvent(nextVideo, true),
      options
    );
    nextVideo.addEventListener(
      "timeupdate",
      () => this.handleTimeUpdate(nextVideo),
      options
    );

    this.refreshSubtitles(nextVideo, true, false);
    this.emit(nextVideo, true);

    if (nextVideo.currentTime > 0) {
      this.saveProgress(nextVideo, true);
    }
  }

  stop(): void {
    if (this.stopped) {
      return;
    }

    if (this.video && this.video.currentTime > 0) {
      this.saveProgress(this.video, true);
    }

    this.stopped = true;
    this.detachElement();
  }

  private detachElement(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.video = null;
  }

  private handlePlaybackEvent(video: HTMLVideoElement, saveNow: boolean): void {
    this.refreshSubtitles(video, true, true);
    this.emit(video, true);

    if (saveNow) {
      this.saveProgress(video, true);
    }
  }

  private handleTimeUpdate(video: HTMLVideoElement): void {
    const now = Date.now();

    if (now - this.lastSubtitleRefreshAt >= SUBTITLE_REFRESH_INTERVAL_MS) {
      this.refreshSubtitles(video, false, true);
    }

    this.emit(video, false);
    this.saveProgress(video, false);
  }

  private refreshSubtitles(
    video: HTMLVideoElement,
    force: boolean,
    emitOnChange: boolean
  ): void {
    const now = Date.now();

    if (
      !force &&
      now - this.lastSubtitleRefreshAt < SUBTITLE_REFRESH_INTERVAL_MS
    ) {
      return;
    }

    this.lastSubtitleRefreshAt = now;

    const previousKey = this.subtitleKey(this.subtitleState);
    const tracks = Array.from(video.textTracks) as unknown as TextTrackLike[];
    const result = extractAccessibleSubtitles(tracks);

    this.subtitleState = result.state;
    this.subtitleCues = result.cues;

    if (
      emitOnChange &&
      previousKey !== this.subtitleKey(this.subtitleState)
    ) {
      this.emit(video, true);
    }
  }

  private subtitleKey(state: VideoSubtitleState): string {
    return [
      state.source,
      state.trackCount,
      state.cueCount,
      state.label ?? "",
      state.language ?? "",
      state.preview ?? ""
    ].join("|");
  }

  private buildState(video: HTMLVideoElement): VideoPlaybackSnapshot {
    const duration =
      Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : 0;
    const rawCurrentTime =
      Number.isFinite(video.currentTime) && video.currentTime >= 0
        ? video.currentTime
        : 0;
    const currentTime =
      duration > 0 ? Math.min(rawCurrentTime, duration) : rawCurrentTime;
    const progress = video.ended
      ? 1
      : duration > 0
        ? clamp(currentTime / duration, 0, 1)
        : 0;

    return {
      courseId: this.context.courseId,
      contentId: this.context.contentId,
      title: this.context.taskTitle,
      currentTime: round(currentTime, 1),
      duration: round(duration, 1),
      progress: round(progress, 4),
      paused: video.paused,
      ended: video.ended,
      playbackRate:
        Number.isFinite(video.playbackRate) && video.playbackRate > 0
          ? video.playbackRate
          : 1,
      subtitles: { ...this.subtitleState },
      updatedAt: new Date().toISOString()
    };
  }

  private emit(video: HTMLVideoElement, force: boolean): void {
    const now = Date.now();

    if (!force && now - this.lastEmitAt < PLAYBACK_EMIT_INTERVAL_MS) {
      return;
    }

    this.lastEmitAt = now;
    this.onState(this.buildState(video));
  }

  private saveProgress(video: HTMLVideoElement, force: boolean): void {
    const now = Date.now();

    if (!force && now - this.lastSaveAt < PROGRESS_SAVE_INTERVAL_MS) {
      return;
    }

    this.lastSaveAt = now;
    const state = this.buildState(video);

    if (state.duration <= 0) {
      return;
    }

    void saveVideoProgress(state).catch((error: unknown) => {
      console.warn(
        `${LOG_PREFIX} 保存视频进度失败：${toErrorMessage(error)}`
      );
    });
  }
}
