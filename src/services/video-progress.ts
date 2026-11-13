import type {
  VideoPlaybackSnapshot,
  VideoProgressRecord
} from "../types/index.js";

const VIDEO_PROGRESS_KEY_PREFIX = "rainclassroom-ai:video-progress:";

export function createVideoProgressKey(
  courseId: string,
  contentId: string
): string {
  return `${VIDEO_PROGRESS_KEY_PREFIX}${courseId}:${contentId}`;
}

export async function saveVideoProgress(
  video: VideoPlaybackSnapshot
): Promise<void> {
  if (!video.courseId || !video.contentId || video.duration <= 0) {
    return;
  }

  const record: VideoProgressRecord = {
    courseId: video.courseId,
    contentId: video.contentId,
    title: video.title,
    currentTime: video.currentTime,
    duration: video.duration,
    progress: video.progress,
    completed: video.ended || video.progress >= 0.98,
    updatedAt: video.updatedAt
  };

  await chrome.storage.local.set({
    [createVideoProgressKey(video.courseId, video.contentId)]: record
  });
}
