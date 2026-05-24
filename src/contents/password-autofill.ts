import type { PlasmoCSConfig } from "plasmo"
import type { PasswordLogin } from "../lib/passwords"

export const config: PlasmoCSConfig = {
  matches: ["http://*/*", "https://*/*"],
  run_at: "document_idle",
  all_frames: false
}

let attempted = false

function requestMatches(): Promise<PasswordLogin[]> {
  return new Promise((resolve) => {
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
  })
}

function isPaymentField(input: HTMLInputElement) {
  const text = `${input.name} ${input.id} ${input.autocomplete}`.toLowerCase()
  return /cc-|card|cvc|cvv|expiry|iban|routing/.test(text)
}

function findUsernameInput() {
  const candidates = Array.from(
    document.querySelectorAll<HTMLInputElement>(
      'input[type="email"], input[type="text"], input[type="search"], input:not([type])'
    )
  ).filter((input) => !input.disabled && !input.readOnly && !isPaymentField(input))
  return candidates.find((input) => input.offsetParent !== null) ?? candidates[0] ?? null
}

function findPasswordInput() {
  const candidates = Array.from(
    document.querySelectorAll<HTMLInputElement>('input[type="password"]')
  ).filter((input) => !input.disabled && !input.readOnly && !isPaymentField(input))
  return candidates.find((input) => input.offsetParent !== null) ?? candidates[0] ?? null
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
  input.dispatchEvent(new Event("change", { bubbles: true }))
}

async function attemptAutofill() {
  if (attempted || !/^https?:$/i.test(location.protocol)) return
  attempted = true
  const matches = await requestMatches()
  const exactMatches = matches.filter((match) => match.password)
  if (exactMatches.length !== 1) return
  const login = exactMatches[0]
  const passwordInput = findPasswordInput()
  if (!passwordInput) return
  const usernameInput = findUsernameInput()
  if (usernameInput) setInputValue(usernameInput, login.username)
  setInputValue(passwordInput, login.password)
}

void attemptAutofill()
window.addEventListener("focus", () => void attemptAutofill(), { once: true })
