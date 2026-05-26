import type { PlasmoCSConfig } from "plasmo"
import type { PasswordLogin } from "../lib/passwords"

export const config: PlasmoCSConfig = {
  matches: ["http://*/*", "https://*/*"],
  run_at: "document_idle",
  all_frames: false
}

let scheduledAttempt: number | null = null
let lastFilledSignature = ""
let passwordAutofillObserver: MutationObserver | null = null

function requestMatches(): Promise<PasswordLogin[]> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(
        { type: "PASSWORDS_MATCH_LOGINS", url: location.href },
        (response) => {
          if (chrome.runtime.lastError) {
            resolve([])
            return
          }
          resolve(Array.isArray(response?.matches) ? response.matches : [])
        }
      )
    } catch {
      resolve([])
    }
  })
}

function isPaymentField(input: HTMLInputElement) {
  const text = `${input.name} ${input.id} ${input.autocomplete}`.toLowerCase()
  return /cc-|card|cvc|cvv|expiry|iban|routing/.test(text)
}

function isVisible(element: HTMLElement) {
  if (element.hidden) return false
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

function findUsernameInput() {
  const candidates = Array.from(
    document.querySelectorAll<HTMLInputElement>(
      'input[type="email"], input[type="text"], input[type="search"], input:not([type])'
    )
  ).filter((input) => !input.disabled && !input.readOnly && !isPaymentField(input))
  return candidates.find(isVisible) ?? candidates[0] ?? null
}

function findPasswordInput() {
  const candidates = Array.from(
    document.querySelectorAll<HTMLInputElement>('input[type="password"]')
  ).filter((input) => !input.disabled && !input.readOnly && !isPaymentField(input))
  return candidates.find(isVisible) ?? candidates[0] ?? null
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set
  setter?.call(input, value)
  input.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, inputType: "insertText", data: value }))
  input.dispatchEvent(new Event("input", { bubbles: true }))
  input.dispatchEvent(new Event("change", { bubbles: true }))
}

function autofillSubmitKey(signature: string) {
  return `ai-dev-sidebar:password-autofill-submitted:${signature}`
}

function readSubmitState(key: string) {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function markSubmitState(key: string) {
  try {
    sessionStorage.setItem(key, "1")
    return true
  } catch {
    return false
  }
}

function findSubmitButton(passwordInput: HTMLInputElement): HTMLElement | null {
  const root = passwordInput.form ?? document
  const buttons = Array.from(
    root.querySelectorAll<HTMLElement>('button, input[type="submit"], input[type="button"]')
  ).filter((button) => {
    if ((button as HTMLButtonElement).disabled) return false
    if (!isVisible(button)) return false
    const label = `${button.textContent || ""} ${(button as HTMLInputElement).value || ""} ${button.getAttribute("aria-label") || ""}`.toLowerCase()
    return !/forgot|reset|cancel|back|show|hide/.test(label)
  })
  return (
    buttons.find((button) => {
      const label = `${button.textContent || ""} ${(button as HTMLInputElement).value || ""} ${button.getAttribute("aria-label") || ""}`.toLowerCase()
      return /log in|login|sign in|signin|continue|submit|unlock/.test(label)
    }) ??
    buttons.find((button) => (button as HTMLInputElement).type === "submit") ??
    buttons[0] ??
    null
  )
}

async function attemptAutofill(force = false) {
  try {
    if (!/^https?:$/i.test(location.protocol)) return
    const matches = await requestMatches()
    const exactMatches = matches.filter((match) => match.password)
    if (exactMatches.length !== 1) return
    const login = exactMatches[0]
    const passwordInput = findPasswordInput()
    if (!passwordInput) return
    const usernameInput = findUsernameInput()
    const signature = `${login.id}:${location.origin}:${usernameInput?.name || usernameInput?.id || ""}:${passwordInput.name || passwordInput.id || ""}`
    if (!force && signature === lastFilledSignature) return
    lastFilledSignature = signature
    if (usernameInput) setInputValue(usernameInput, login.username)
    setInputValue(passwordInput, login.password)
    const submitKey = autofillSubmitKey(signature)
    if (readSubmitState(submitKey) === "1") return
    if (!markSubmitState(submitKey)) return
    window.setTimeout(() => findSubmitButton(passwordInput)?.click(), 150)
  } catch {
    // Best-effort autofill. Some pages block storage, mutate the DOM rapidly,
    // or expose malformed fields; none of those should surface as a runtime
    // error from the content script.
  }
}

function scheduleAutofill(delay = 250, force = false) {
  if (scheduledAttempt !== null) window.clearTimeout(scheduledAttempt)
  scheduledAttempt = window.setTimeout(() => {
    scheduledAttempt = null
    void attemptAutofill(force)
  }, delay)
}

scheduleAutofill(100)
window.addEventListener("focus", () => scheduleAutofill(100))
document.addEventListener("DOMContentLoaded", () => scheduleAutofill(100))

function ensureAutofillObserver() {
  if (passwordAutofillObserver || !document.documentElement) return
  try {
    passwordAutofillObserver = new MutationObserver(() => scheduleAutofill(300))
    passwordAutofillObserver.observe(document.documentElement, {
      childList: true,
      subtree: true
    })
  } catch {
    passwordAutofillObserver = null
  }
}

ensureAutofillObserver()
document.addEventListener("DOMContentLoaded", ensureAutofillObserver, {
  once: true
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "PASSWORDS_RETRY_AUTOFILL") return
  lastFilledSignature = ""
  scheduleAutofill(50, true)
  sendResponse({ ok: true })
})
