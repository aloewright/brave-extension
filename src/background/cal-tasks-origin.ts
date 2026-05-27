// MV3 service worker fetches to cal.fly.pm carry `Origin: chrome-extension://<id>`,
// which better-auth's trustedOrigins check rejects with `{ error: "unauthorized" }`
// even when a valid `__Secure-better-auth.session_token` cookie is present.
// A static DNR modifyHeaders rule rewrites Origin/Referer on cal.fly.pm requests
// so the server sees them as same-site.

const CAL_TASKS_ORIGIN_RULE_ID = 411_000
const CAL_TASKS_ORIGIN_RULE_ID_MAX = 411_099
const CAL_TASKS_HOST = "cal.fly.pm"
const CAL_TASKS_ORIGIN = "https://cal.fly.pm"

function buildCalTasksOriginRule(): chrome.declarativeNetRequest.Rule {
  return {
    id: CAL_TASKS_ORIGIN_RULE_ID,
    priority: 100,
    action: {
      type: "modifyHeaders" as chrome.declarativeNetRequest.RuleActionType,
      requestHeaders: [
        {
          header: "origin",
          operation: "set" as chrome.declarativeNetRequest.HeaderOperation,
          value: CAL_TASKS_ORIGIN
        },
        {
          header: "referer",
          operation: "set" as chrome.declarativeNetRequest.HeaderOperation,
          value: `${CAL_TASKS_ORIGIN}/`
        }
      ]
    },
    condition: {
      requestDomains: [CAL_TASKS_HOST],
      resourceTypes: ["xmlhttprequest"] as chrome.declarativeNetRequest.ResourceType[]
    }
  }
}

function isManagedRuleId(id: number) {
  return id >= CAL_TASKS_ORIGIN_RULE_ID && id <= CAL_TASKS_ORIGIN_RULE_ID_MAX
}

export async function ensureCalTasksOriginRule() {
  if (!chrome.declarativeNetRequest?.updateDynamicRules) return

  const existing = await chrome.declarativeNetRequest.getDynamicRules()
  const removeRuleIds = existing.filter((rule) => isManagedRuleId(rule.id)).map((rule) => rule.id)

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules: [buildCalTasksOriginRule()]
  })
}
