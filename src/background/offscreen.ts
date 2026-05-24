const OFFSCREEN_URL = "tabs/offscreen.html";

type OffscreenUse = "recorder" | "terminal-keepalive";

const activeUses = new Set<OffscreenUse>();
let createPromise: Promise<void> | null = null;

export async function hasOffscreenDocument(): Promise<boolean> {
  // @ts-ignore — chrome.runtime.getContexts is MV3 only and may be missing
  // from older @types/chrome.
  const existing = await (chrome.runtime as any).getContexts?.({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });
  return Array.isArray(existing) && existing.length > 0;
}

export async function retainOffscreenDocument(use: OffscreenUse): Promise<void> {
  activeUses.add(use);
  try {
    if (await hasOffscreenDocument()) return;
    if (!createPromise) {
      createPromise = (chrome.offscreen as any)
        .createDocument({
          url: OFFSCREEN_URL,
          reasons: ["USER_MEDIA", "DISPLAY_MEDIA", "BLOBS", "WORKERS"],
          justification:
            "Record media and keep terminal native messaging sessions connected while the sidebar is closed.",
        })
        .finally(() => {
          createPromise = null;
        });
    }
    await createPromise;
  } catch (err) {
    activeUses.delete(use);
    throw err;
  }
}

export async function releaseOffscreenDocument(use: OffscreenUse): Promise<void> {
  activeUses.delete(use);
  if (activeUses.size > 0) return;
  if (!(await hasOffscreenDocument())) return;
  try {
    await chrome.offscreen.closeDocument();
  } catch {
    // ignore
  }
}
