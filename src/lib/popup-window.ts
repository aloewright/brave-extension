export async function openPopupWindow(url: string, width = 960, height = 720) {
  await chrome.windows.create({
    type: "popup",
    url,
    width,
    height
  })
}
