// Isolated-world controls: the page cannot send native download requests.
import { shouldShowMediaDownloadButton, type MediaDownloadControlSettings } from '../lib/media-download-controls';
import type { MediaDownloadMode } from '../lib/media-download';
import { getSettings, SETTINGS_STORAGE_KEY } from '../storage';

const host = document.createElement('div');
const shadow = host.attachShadow({ mode: 'open' });
const style = document.createElement('style');
style.textContent = `:host{all:initial;position:fixed;z-index:2147483647;display:none} .bar{display:flex;gap:5px;align-items:center;padding:6px;background:#18181bee;border:1px solid #777;border-radius:8px;font:12px system-ui;color:white;box-shadow:0 2px 12px #0006}button{font:inherit;color:inherit;background:#333;border:0;border-radius:5px;padding:7px 10px;cursor:pointer}button:hover{background:#555}button:disabled{opacity:.65;cursor:wait}.status{max-width:260px;overflow-wrap:anywhere}`;
const bar = document.createElement('div');
bar.className = 'bar';
const status = document.createElement('span');
status.className = 'status';
status.setAttribute('role', 'status');
let selected: HTMLVideoElement | null = null;
let busy = false;
let controlsVisible = false;
const buttons = new Map<MediaDownloadMode, HTMLButtonElement>();
for (const mode of ['video', 'audio'] as const) {
  const button = document.createElement('button');
  button.textContent = `Download ${mode}`;
  button.addEventListener('click', async event => {
    if (!event.isTrusted || !selected || busy) return;
    event.preventDefault();
    event.stopPropagation();
    busy = true;
    const buttons = bar.querySelectorAll('button');
    buttons.forEach(b => { b.disabled = true; });
    status.textContent = 'Downloading…';
    try {
      const result = await chrome.runtime.sendMessage({ type: 'MEDIA_DOWNLOAD', mode, sourceUrl: selected.currentSrc || selected.src });
      status.textContent = result?.ok ? `Saved to Downloads: ${result.filename}` : result?.error || 'Download failed.';
    } catch { status.textContent = 'Reload this page after reloading the extension.'; }
    finally { busy = false; buttons.forEach(b => { b.disabled = false; }); }
  });
  buttons.set(mode, button);
  bar.append(button);
}
bar.append(status);
shadow.append(style, bar);
document.documentElement.append(host);
function position() {
  if (!controlsVisible || !selected?.isConnected) { host.style.display = 'none'; return; }
  const rect = selected.getBoundingClientRect();
  host.style.display = rect.width > 80 && rect.height > 60 && rect.bottom > 0 && rect.top < innerHeight ? 'block' : 'none';
  host.style.left = `${Math.max(8, Math.min(rect.left + 8, innerWidth - 285))}px`;
  host.style.top = `${Math.max(8, rect.top + 8)}px`;
}
document.addEventListener('pointerover', event => {
  if (busy) return;
  const video = event.composedPath().find(el => el instanceof HTMLVideoElement);
  if (video instanceof HTMLVideoElement) { selected = video; status.textContent = ''; position(); }
}, true);
// Some players put a click surface over the video. Detect that player too.
document.addEventListener('pointermove', event => {
  if (busy || event.target === host) return;
  for (const video of document.querySelectorAll('video')) {
    const rect = video.getBoundingClientRect();
    if (event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) {
      if (selected !== video) status.textContent = '';
      selected = video; position(); return;
    }
  }
});
addEventListener('scroll', position, true);
addEventListener('resize', position);

function applySettings(settings?: Partial<MediaDownloadControlSettings> | null) {
  for (const [mode, button] of buttons) {
    button.hidden = !shouldShowMediaDownloadButton(mode, settings);
  }
  controlsVisible = [...buttons.values()].some(button => !button.hidden);
  position();
}

void getSettings()
  .then(applySettings)
  .catch(() => applySettings());

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes[SETTINGS_STORAGE_KEY]) return;
  applySettings(changes[SETTINGS_STORAGE_KEY].newValue);
});

export {};
