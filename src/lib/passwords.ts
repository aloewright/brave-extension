export const NODEWARDEN_DEFAULT_URL = "https://passwords.lazee.workers.dev"
export const PASSWORD_AUTOFILL_STORAGE_KEY = "passwords.autofill.cache"
export const PASSWORD_SELECTED_LOGIN_KEY = "passwords.autofill.selectedLoginId"
export const PASSWORD_NODEWARDEN_URL_KEY = "passwords.nodewarden.serverUrl"
export const DISPOSABLE_ALIASES_STORAGE_KEY = "passwords.disposableAliases"
export const DISPOSABLE_ALIAS_ENDPOINT =
  "https://mail.fly.pm/api/v1/aliases/disposable"

export interface PasswordLogin {
  id: string
  name: string
  username: string
  password: string
  urls: string[]
  notes?: string
  folder?: string
  favorite?: boolean
  createdAt?: number
  updatedAt: number
}

export interface DisposableAlias {
  id: string
  alias: string
  forwardsTo: string
  createdAt: number
}

export async function getPasswordLogins(): Promise<PasswordLogin[]> {
  const got = await passwordStorageArea().get(PASSWORD_AUTOFILL_STORAGE_KEY)
  const value = got[PASSWORD_AUTOFILL_STORAGE_KEY]
  return Array.isArray(value) ? value.filter(isPasswordLogin) : []
}

export async function setPasswordLogins(logins: PasswordLogin[]): Promise<void> {
  await passwordStorageArea().set({ [PASSWORD_AUTOFILL_STORAGE_KEY]: logins.slice(0, 200) })
}

export async function addPasswordLogin(input: Omit<PasswordLogin, "id" | "updatedAt">) {
  const now = Date.now()
  const login: PasswordLogin = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: input.createdAt ?? now,
    updatedAt: now
  }
  const logins = await getPasswordLogins()
  await setPasswordLogins([login, ...logins])
  return login
}

export async function updatePasswordLogin(
  id: string,
  updates: Partial<Omit<PasswordLogin, "id" | "createdAt">>
): Promise<PasswordLogin | null> {
  const logins = await getPasswordLogins()
  let updated: PasswordLogin | null = null
  const next = logins.map((login) => {
    if (login.id !== id) return login
    updated = { ...login, ...updates, updatedAt: Date.now() }
    return updated
  })
  await setPasswordLogins(next)
  return updated
}

export async function removePasswordLogin(id: string): Promise<void> {
  const logins = await getPasswordLogins()
  await setPasswordLogins(logins.filter((login) => login.id !== id))
}

export async function setSelectedPasswordLogin(id: string | null): Promise<void> {
  if (id) {
    await chrome.storage.local.set({ [PASSWORD_SELECTED_LOGIN_KEY]: id })
  } else {
    await chrome.storage.local.remove(PASSWORD_SELECTED_LOGIN_KEY)
  }
}

export async function getSelectedPasswordLoginId(): Promise<string | null> {
  const got = await chrome.storage.local.get(PASSWORD_SELECTED_LOGIN_KEY)
  const value = got[PASSWORD_SELECTED_LOGIN_KEY]
  return typeof value === "string" ? value : null
}

export async function getMatchingPasswordLogins(pageUrl: string): Promise<PasswordLogin[]> {
  const logins = await getPasswordLogins()
  let pageHost = ""
  try {
    pageHost = new URL(pageUrl).hostname.toLowerCase().replace(/^www\./, "")
  } catch {
    return []
  }
  if (!pageHost) return []
  return logins.filter((login) =>
    login.urls.some((url) => {
      try {
        const loginHost = new URL(url).hostname.toLowerCase().replace(/^www\./, "")
        return pageHost === loginHost || pageHost.endsWith(`.${loginHost}`)
      } catch {
        return false
      }
    })
  )
}

export async function getNodewardenServerUrl(): Promise<string> {
  const got = await chrome.storage.local.get(PASSWORD_NODEWARDEN_URL_KEY)
  const value = got[PASSWORD_NODEWARDEN_URL_KEY]
  return typeof value === "string" && value.trim()
    ? normalizeServerUrl(value)
    : NODEWARDEN_DEFAULT_URL
}

export async function setNodewardenServerUrl(url: string): Promise<string> {
  const normalized = normalizeServerUrl(url)
  await chrome.storage.local.set({ [PASSWORD_NODEWARDEN_URL_KEY]: normalized })
  return normalized
}

export function normalizeServerUrl(url: string): string {
  const parsed = new URL(url.trim())
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Server URL must use http or https")
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "")
  parsed.search = ""
  parsed.hash = ""
  return parsed.toString().replace(/\/+$/, "")
}

export async function getDisposableAliases(): Promise<DisposableAlias[]> {
  const got = await chrome.storage.local.get(DISPOSABLE_ALIASES_STORAGE_KEY)
  const value = got[DISPOSABLE_ALIASES_STORAGE_KEY]
  return Array.isArray(value) ? value.filter(isDisposableAlias) : []
}

export async function setDisposableAliases(aliases: DisposableAlias[]): Promise<void> {
  await chrome.storage.local.set({ [DISPOSABLE_ALIASES_STORAGE_KEY]: aliases.slice(0, 200) })
}

export function generateDisposableAlias(): string {
  const id = crypto.randomUUID().split("-")[0]
  return `inbox-${id}@fly.pm`
}

export async function createDisposableAlias(
  alias: string,
  forwardsTo: string
): Promise<DisposableAlias> {
  const response = await fetch(DISPOSABLE_ALIAS_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ alias, forwardsTo })
  })
  if (!response.ok) throw new Error(`Alias create failed: ${response.status}`)
  const created: DisposableAlias = {
    id: crypto.randomUUID(),
    alias,
    forwardsTo,
    createdAt: Date.now()
  }
  const aliases = await getDisposableAliases()
  await setDisposableAliases([created, ...aliases])
  return created
}

export async function deleteDisposableAlias(aliasId: string): Promise<void> {
  const aliases = await getDisposableAliases()
  await setDisposableAliases(aliases.filter((alias) => alias.id !== aliasId))
}

function isPasswordLogin(value: unknown): value is PasswordLogin {
  if (!value || typeof value !== "object") return false
  const login = value as PasswordLogin
  return (
    typeof login.id === "string" &&
    typeof login.name === "string" &&
    typeof login.username === "string" &&
    typeof login.password === "string" &&
    Array.isArray(login.urls) &&
    login.urls.every((url) => typeof url === "string") &&
    (login.notes === undefined || typeof login.notes === "string") &&
    (login.folder === undefined || typeof login.folder === "string") &&
    (login.favorite === undefined || typeof login.favorite === "boolean") &&
    (login.createdAt === undefined || typeof login.createdAt === "number") &&
    typeof login.updatedAt === "number"
  )
}

function passwordStorageArea(): chrome.storage.StorageArea {
  return chrome.storage.session ?? chrome.storage.local
}

function isDisposableAlias(value: unknown): value is DisposableAlias {
  if (!value || typeof value !== "object") return false
  const alias = value as DisposableAlias
  return (
    typeof alias.id === "string" &&
    typeof alias.alias === "string" &&
    typeof alias.forwardsTo === "string" &&
    typeof alias.createdAt === "number"
  )
}
