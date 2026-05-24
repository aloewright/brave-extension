const DEFAULT_SIDEBAR_WINDOW_WIDTH = 760
const DEFAULT_SIDEBAR_WINDOW_HEIGHT = 900

export async function openResizableSidebarWindow() {
  await chrome.windows.create({
    url: chrome.runtime.getURL("sidepanel.html?window=1"),
    type: "popup",
    width: DEFAULT_SIDEBAR_WINDOW_WIDTH,
    height: DEFAULT_SIDEBAR_WINDOW_HEIGHT,
    focused: true
  })
}
