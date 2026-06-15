import {
  GO_VAULT_BROWSER_SESSION_EVENT,
  GO_VAULT_SESSION_STATUS_MESSAGE,
  sanitizeGoVaultBrowserSessionStatus,
} from "../lib/go-vault-session-state";

function forwardSessionStatus(event: MessageEvent) {
  if (event.source !== window) return;
  if (event.origin !== window.location.origin) return;

  const data = event.data;
  if (!data || typeof data !== "object") return;
  if ((data as { type?: unknown }).type !== GO_VAULT_BROWSER_SESSION_EVENT) {
    return;
  }

  const payload = sanitizeGoVaultBrowserSessionStatus(
    (data as { payload?: unknown }).payload,
    window.location.origin,
  );
  if (!payload) return;

  chrome.runtime
    .sendMessage({ type: GO_VAULT_SESSION_STATUS_MESSAGE, payload })
    .catch(() => {});
}

window.addEventListener("message", forwardSessionStatus);
