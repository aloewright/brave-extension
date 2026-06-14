type MailTwoFactorResponse = {
  code?: string | null
  receivedAt?: number
  source?: string
  threadId?: string
  error?: string
}

type TwoFactorTarget = {
  inputs: HTMLInputElement[]
  signature: string
  mode: "single" | "split"
}

const TWO_FACTOR_HINT_RE =
  /\b(?:2fa|mfa|otp|one[-\s]?time|two[-\s]?factor|verification|verify|security|login|sign[-\s]?in|authentication|authenticator|passcode|code)\b/i
const TEXT_INPUT_SELECTOR =
  'input:not([type]), input[type="text"], input[type="tel"], input[type="number"], input[type="search"], input[type="email"]'
const POLL_INTERVAL_MS = 5_000
const POLL_WINDOW_MS = 2 * 60 * 1000

let scheduledAttempt: number | null = null
let pollTimer: number | null = null
let pollUntil = 0
let lastFilledSignature = ""
let twoFactorObserver: MutationObserver | null = null

// Opt-in diagnostics. Enable with:
//   chrome.storage.local.set({ "mail2fa.debug": true })
// Makes the otherwise-silent boundaries visible: whether an OTP field was
// detected on the page, and the background response (incl. its error string,
// which the normal flow discards).
let mail2faDebugEnabled = false
try {
  chrome.storage?.local
    ?.get?.("mail2fa.debug")
    .then((r) => {
      mail2faDebugEnabled = Boolean((r as Record<string, unknown>)?.["mail2fa.debug"])
    })
    .catch(() => {})
  chrome.storage?.onChanged?.addListener?.((changes, area) => {
    if (area === "local" && changes["mail2fa.debug"]) {
      mail2faDebugEnabled = Boolean(changes["mail2fa.debug"].newValue)
    }
  })
} catch {
  /* storage unavailable */
}
function mail2faDebug(label: string, data: Record<string, unknown>) {
  if (!mail2faDebugEnabled) return
  try {
    console.debug(`[mail-2fa] ${label}`, data)
  } catch {
    /* console unavailable */
  }
}

function requestMailTwoFactorCode(): Promise<MailTwoFactorResponse> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(
        { type: "MAIL_2FA_CODE_REQUEST", url: location.href },
        (response) => {
          if (chrome.runtime.lastError) {
            resolve({ code: null, error: chrome.runtime.lastError.message })
            return
          }
          resolve(response && typeof response === "object" ? response : { code: null })
        }
      )
    } catch {
      resolve({ code: null })
    }
  })
}

function isVisible(element: HTMLElement) {
  if (element.hidden) return false
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

function isPaymentField(input: HTMLInputElement) {
  const text = `${input.name} ${input.id} ${input.autocomplete}`.toLowerCase()
  return /cc-|card|cvc|cvv|expiry|iban|routing/.test(text)
}

function candidateInputs() {
  return Array.from(document.querySelectorAll<HTMLInputElement>(TEXT_INPUT_SELECTOR))
    .filter((input) => !input.disabled && !input.readOnly && !isPaymentField(input))
    .filter(isVisible)
}

function inputHintText(input: HTMLInputElement) {
  const labelText = Array.from(input.labels ?? [])
    .map((label) => label.textContent ?? "")
    .join(" ")
  return [
    input.autocomplete,
    input.name,
    input.id,
    input.placeholder,
    input.getAttribute("aria-label"),
    input.getAttribute("data-testid"),
    input.inputMode,
    labelText
  ]
    .filter(Boolean)
    .join(" ")
}

function isDirectTwoFactorInput(input: HTMLInputElement) {
  if (input.autocomplete?.toLowerCase() === "one-time-code") return true
  return TWO_FACTOR_HINT_RE.test(inputHintText(input))
}

function findSingleTarget(inputs: HTMLInputElement[]): TwoFactorTarget | null {
  const input = inputs.find(isDirectTwoFactorInput)
  if (!input) return null
  return {
    inputs: [input],
    mode: "single",
    signature: `${input.form?.id || ""}:${input.name || input.id || input.autocomplete || "otp"}`
  }
}

function findSplitTarget(inputs: HTMLInputElement[]): TwoFactorTarget | null {
  const shortInputs = inputs.filter((input) => {
    const maxLength = input.maxLength > 0 ? input.maxLength : Number(input.getAttribute("maxlength") || 0)
    const size = Number(input.getAttribute("size") || 0)
    return maxLength === 1 || size === 1
  })
  if (shortInputs.length < 4) return null

  const groups = new Map<Element, HTMLInputElement[]>()
  for (const input of shortInputs) {
    const key = input.form ?? input.closest("fieldset, [role='group'], section, main")
    if (!key) continue
    groups.set(key, [...(groups.get(key) ?? []), input])
  }

  for (const [container, group] of groups) {
    if (group.length < 4 || group.length > 8) continue
    const text = container.textContent ?? ""
    if (!TWO_FACTOR_HINT_RE.test(text)) continue
    return {
      inputs: group.slice(0, 8),
      mode: "split",
      signature: group.map((input) => input.name || input.id || input.autocomplete || "digit").join(":")
    }
  }

  return null
}

function findTwoFactorTarget(): TwoFactorTarget | null {
  const inputs = candidateInputs()
  return findSingleTarget(inputs) ?? findSplitTarget(inputs)
}

function hasUserValue(target: TwoFactorTarget) {
  if (target.mode === "single") return target.inputs[0]?.value.trim().length > 0
  return target.inputs.every((input) => input.value.trim().length > 0)
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

function fillTarget(target: TwoFactorTarget, code: string) {
  if (target.mode === "single") {
    setInputValue(target.inputs[0]!, code)
    target.inputs[0]?.focus()
    return
  }

  const digits = code.split("")
  target.inputs.forEach((input, index) => setInputValue(input, digits[index] ?? ""))
  target.inputs[Math.min(digits.length, target.inputs.length) - 1]?.focus()
}

async function attemptTwoFactorAutofill(force = false) {
  try {
    if (!/^https?:$/i.test(location.protocol)) return
    const target = findTwoFactorTarget()
    mail2faDebug("target detection", {
      found: Boolean(target),
      mode: target?.mode,
      inputs: target?.inputs.length,
    })
    if (!target) {
      stopPolling()
      return
    }
    if (!force && hasUserValue(target)) return

    const response = await requestMailTwoFactorCode()
    const code = typeof response.code === "string" ? response.code.replace(/\D/g, "") : ""
    mail2faDebug("background response", {
      codeLength: code.length,
      source: response.source,
      error: response.error,
    })
    if (code.length < 4 || code.length > 8) {
      ensurePolling()
      return
    }
    if (target.mode === "split" && code.length > target.inputs.length) {
      ensurePolling()
      return
    }

    const signature = `${location.origin}:${target.signature}:${code}`
    if (!force && signature === lastFilledSignature) return
    lastFilledSignature = signature
    fillTarget(target, code)
    stopPolling()
  } catch {
    // Page OTP widgets vary widely and can disappear during mutation work.
    // Treat this as best-effort so a site-specific failure never breaks pages.
  }
}

function scheduleTwoFactorAutofill(delay = 250, force = false) {
  if (scheduledAttempt !== null) window.clearTimeout(scheduledAttempt)
  scheduledAttempt = window.setTimeout(() => {
    scheduledAttempt = null
    void attemptTwoFactorAutofill(force)
  }, delay)
}

function ensurePolling() {
  const now = Date.now()
  if (pollUntil < now) pollUntil = now + POLL_WINDOW_MS
  if (pollTimer !== null || now >= pollUntil) return
  pollTimer = window.setTimeout(() => {
    pollTimer = null
    scheduleTwoFactorAutofill(0)
  }, POLL_INTERVAL_MS)
}

function stopPolling() {
  pollUntil = 0
  if (pollTimer !== null) {
    window.clearTimeout(pollTimer)
    pollTimer = null
  }
}

function ensureTwoFactorObserver() {
  if (twoFactorObserver || !document.documentElement) return
  try {
    twoFactorObserver = new MutationObserver(() => scheduleTwoFactorAutofill(300))
    twoFactorObserver.observe(document.documentElement, {
      childList: true,
      subtree: true
    })
  } catch {
    twoFactorObserver = null
  }
}

scheduleTwoFactorAutofill(150)
window.addEventListener("focus", () => scheduleTwoFactorAutofill(100))
document.addEventListener("DOMContentLoaded", () => scheduleTwoFactorAutofill(100))
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") scheduleTwoFactorAutofill(100, true)
})

ensureTwoFactorObserver()

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "MAIL_2FA_FILL_CODE") {
    const code = String(message.code || "").replace(/\D/g, "")
    if (code.length < 4 || code.length > 8) {
      sendResponse({ ok: false, error: "invalid code" })
      return
    }

    const target = findTwoFactorTarget()
    if (!target) {
      sendResponse({ ok: false, error: "no code field found" })
      return
    }
    if (target.mode === "split" && code.length > target.inputs.length) {
      sendResponse({ ok: false, error: "code is too long for split fields" })
      return
    }

    lastFilledSignature = `${location.origin}:${target.signature}:${code}`
    fillTarget(target, code)
    stopPolling()
    sendResponse({ ok: true })
  }

  if (message?.type === "MAIL_2FA_FORCE_AUTOFILL") {
    attemptTwoFactorAutofill(true)
      .then(() => sendResponse({ ok: true }))
      .catch((err) =>
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : "autofill failed"
        })
      )
    return true
  }
})
document.addEventListener("DOMContentLoaded", ensureTwoFactorObserver, {
  once: true
})
