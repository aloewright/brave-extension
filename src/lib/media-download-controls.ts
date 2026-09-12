import type { MediaDownloadMode } from "./media-download"
import type { Settings } from "../types"

type MediaDownloadControlSettings = Pick<Settings, "hideVideoDownloadButton">

export function shouldShowMediaDownloadButton(
  mode: MediaDownloadMode,
  settings?: Partial<MediaDownloadControlSettings> | null,
): boolean {
  return mode !== "video" || settings?.hideVideoDownloadButton !== true
}
