import { companyNameForDomain, normalizeHostname } from "../lib/company-names"
import {
  THIRD_PARTY_COOKIE_GRANTS_KEY,
  type ThirdPartyCookieGrant,
  type ThirdPartyCookieState
} from "../lib/third-party-cookie-types"

const BLOCK_RULE_ID = 410_000
const ALLOW_RULE_BASE_ID = 410_100
const MAX_ALLOW_RULES = 900

const THIRD_PARTY_RESOURCE_TYPES = [
  "sub_frame",
  "stylesheet",
  "script",
  "image",
  "font",
  "object",
  "xmlhttprequest",
  "ping",
  "media",
  "websocket",
  "other"
] as chrome.declarativeNetRequest.ResourceType[]

function settingPatternForDomain(domain: string) {
  return `*://*.${normalizeHostname(domain)}/*`
}

type ChromeSettingCompat = {
  set(details: unknown, callback?: () => void): void
}

type ContentSettingClearable = {
  clear(details: { scope?: "regular" | "incognito_session_only" }, callback?: () => void): void
}

type CookieContentSettingDetails = {
  primaryPattern: string
  secondaryPattern?: string
  resourceIdentifier?: unknown
  scope?: "regular" | "incognito_session_only"
  setting: "allow" | "block" | "session_only"
}

function chromeSettingSet(setting: ChromeSettingCompat, details: unknown) {
  return new Promise<void>((resolve, reject) => {
    setting.set(details, () => {
      const err = chrome.runtime.lastError
      if (err) reject(new Error(err.message))
      else resolve()
    })
  })
}

function contentSettingsClear(setting: ContentSettingClearable) {
  return new Promise<void>((resolve, reject) => {
    setting.clear({}, () => {
      const err = chrome.runtime.lastError
      if (err) reject(new Error(err.message))
      else resolve()
    })
  })
}

function contentSettingsSetCookies(details: CookieContentSettingDetails) {
  return new Promise<void>((resolve, reject) => {
    const setCookies = chrome.contentSettings.cookies.set as (
      value: CookieContentSettingDetails,
      callback?: () => void
    ) => void
    setCookies(details, () => {
      const err = chrome.runtime.lastError
      if (err) reject(new Error(err.message))
      else resolve()
    })
  })
}

function grantId(siteDomain: string, embeddedDomain: string) {
  return `${normalizeHostname(siteDomain)}::${normalizeHostname(embeddedDomain)}`
}

function normalizeGrant(grant: Pick<ThirdPartyCookieGrant, "siteDomain" | "embeddedDomain">): ThirdPartyCookieGrant {
  const siteDomain = normalizeHostname(grant.siteDomain)
  const embeddedDomain = normalizeHostname(grant.embeddedDomain)

  return {
    id: grantId(siteDomain, embeddedDomain),
    siteDomain,
    embeddedDomain,
    siteName: companyNameForDomain(siteDomain),
    embeddedName: companyNameForDomain(embeddedDomain),
    createdAt: Date.now()
  }
}

export function buildThirdPartyCookieRules(grants: ThirdPartyCookieGrant[]): chrome.declarativeNetRequest.Rule[] {
  const blockRule: chrome.declarativeNetRequest.Rule = {
    id: BLOCK_RULE_ID,
    priority: 1,
    action: {
      type: "modifyHeaders" as chrome.declarativeNetRequest.RuleActionType,
      requestHeaders: [
        { header: "cookie", operation: "remove" as chrome.declarativeNetRequest.HeaderOperation }
      ],
      responseHeaders: [
        { header: "set-cookie", operation: "remove" as chrome.declarativeNetRequest.HeaderOperation }
      ]
    },
    condition: {
      domainType: "thirdParty" as chrome.declarativeNetRequest.DomainType,
      resourceTypes: THIRD_PARTY_RESOURCE_TYPES
    }
  }

  const allowRules = grants.slice(0, MAX_ALLOW_RULES).map((grant, index) => ({
    id: ALLOW_RULE_BASE_ID + index,
    priority: 10,
    action: {
      type: "allow" as chrome.declarativeNetRequest.RuleActionType
    },
    condition: {
      domainType: "thirdParty" as chrome.declarativeNetRequest.DomainType,
      initiatorDomains: [grant.siteDomain],
      requestDomains: [grant.embeddedDomain],
      resourceTypes: THIRD_PARTY_RESOURCE_TYPES
    }
  }))

  return [blockRule, ...allowRules]
}

function isManagedRuleId(id: number) {
  return id === BLOCK_RULE_ID || (id >= ALLOW_RULE_BASE_ID && id < ALLOW_RULE_BASE_ID + MAX_ALLOW_RULES)
}

export async function getThirdPartyCookieGrants(): Promise<ThirdPartyCookieGrant[]> {
  const result = await chrome.storage.local.get(THIRD_PARTY_COOKIE_GRANTS_KEY)
  const grants = Array.isArray(result[THIRD_PARTY_COOKIE_GRANTS_KEY]) ? result[THIRD_PARTY_COOKIE_GRANTS_KEY] : []

  return grants
    .map((grant) => normalizeGrant(grant))
    .filter((grant, index, all) => all.findIndex((candidate) => candidate.id === grant.id) === index)
}

async function setThirdPartyCookieGrants(grants: ThirdPartyCookieGrant[]) {
  await chrome.storage.local.set({ [THIRD_PARTY_COOKIE_GRANTS_KEY]: grants })
}

async function runEnsureThirdPartyCookieRules(): Promise<void> {
  const grants = await getThirdPartyCookieGrants()

  if (chrome.privacy?.websites?.thirdPartyCookiesAllowed?.set) {
    await chromeSettingSet(chrome.privacy.websites.thirdPartyCookiesAllowed as ChromeSettingCompat, {
      value: false,
      scope: "regular"
    })
  }

  if (chrome.contentSettings?.cookies?.set) {
    await contentSettingsClear(chrome.contentSettings.cookies as ContentSettingClearable)
    await Promise.all(grants.slice(0, MAX_ALLOW_RULES).map((grant) =>
      contentSettingsSetCookies({
        primaryPattern: settingPatternForDomain(grant.embeddedDomain),
        secondaryPattern: settingPatternForDomain(grant.siteDomain),
        setting: "allow"
      })
    ))
  }

  if (!chrome.declarativeNetRequest?.updateDynamicRules) return

  const existingRules = await chrome.declarativeNetRequest.getDynamicRules()
  const removeRuleIds = existingRules.filter((rule) => isManagedRuleId(rule.id)).map((rule) => rule.id)
  const addRules = buildThirdPartyCookieRules(grants)

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules
  })
}

// Concurrent callers (SW startup + onInstalled fire at the same time on
// extension reload) would otherwise race on getDynamicRules → updateDynamicRules
// and Chrome rejects the loser with "Rule with id X does not have a unique ID".
// Serialize so each caller runs after the previous finishes against fresh state.
let ensureInFlight: Promise<void> | null = null

export function ensureThirdPartyCookieRules(): Promise<void> {
  const previous = ensureInFlight ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(runEnsureThirdPartyCookieRules)
  ensureInFlight = next.finally(() => {
    if (ensureInFlight === next) ensureInFlight = null
  })
  return next
}

export async function getThirdPartyCookieState(): Promise<ThirdPartyCookieState> {
  await ensureThirdPartyCookieRules()

  return {
    protectedByDefault: true,
    grants: await getThirdPartyCookieGrants()
  }
}

export async function addThirdPartyCookieGrant(payload: Pick<ThirdPartyCookieGrant, "siteDomain" | "embeddedDomain">) {
  const nextGrant = normalizeGrant(payload)
  const grants = await getThirdPartyCookieGrants()
  const next = [nextGrant, ...grants.filter((grant) => grant.id !== nextGrant.id)]

  await setThirdPartyCookieGrants(next)
  await ensureThirdPartyCookieRules()

  return nextGrant
}

export async function revokeThirdPartyCookieGrant(id: string) {
  const grants = await getThirdPartyCookieGrants()
  const next = grants.filter((grant) => grant.id !== id)

  await setThirdPartyCookieGrants(next)
  await ensureThirdPartyCookieRules()

  return { ok: true }
}

async function openGrantPrompt(payload: Pick<ThirdPartyCookieGrant, "siteDomain" | "embeddedDomain">) {
  const grant = normalizeGrant(payload)
  const params = new URLSearchParams({
    thirdPartyCookie: "1",
    siteDomain: grant.siteDomain,
    embeddedDomain: grant.embeddedDomain,
    siteName: grant.siteName,
    embeddedName: grant.embeddedName
  })

  await chrome.windows.create({
    url: chrome.runtime.getURL(`popup.html?${params.toString()}`),
    type: "popup",
    width: 380,
    height: 430,
    focused: true
  })

  return { ok: true }
}

export function isThirdPartyCookieMessage(message: any) {
  return typeof message?.type === "string" && message.type.startsWith("thirdPartyCookies:")
}

export async function handleThirdPartyCookieMessage(message: any) {
  switch (message.type) {
    case "thirdPartyCookies:getState":
      return getThirdPartyCookieState()
    case "thirdPartyCookies:openGrantPrompt":
      return openGrantPrompt(message.payload)
    case "thirdPartyCookies:grantFromPrompt":
      return addThirdPartyCookieGrant(message.payload)
    case "thirdPartyCookies:revokeGrant":
      return revokeThirdPartyCookieGrant(message.id)
    default:
      return { ok: false, error: "unknown third-party cookie message" }
  }
}
