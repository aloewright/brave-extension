import type { MediaDownloadMode } from "./media-download"
import type { Settings } from "../types"

export type MediaDownloadControlSettings = Pick<
  Settings,
  "hideVideoDownloadButton" | "hideAudioDownloadButton"
>

export function shouldShowMediaDownloadButton(
  mode: MediaDownloadMode,
  settings?: Partial<MediaDownloadControlSettings> | null,
): boolean {
  return mode === "video"
    ? settings?.hideVideoDownloadButton !== true
    : settings?.hideAudioDownloadButton !== true
}
