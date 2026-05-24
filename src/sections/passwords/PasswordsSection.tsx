import { useEffect, useMemo, useState } from "react"
import { LeoTabButton } from "../../components/leo"
import {
  addPasswordLogin,
  createDisposableAlias,
  deleteDisposableAlias,
  generateDisposableAlias,
  getDisposableAliases,
  getPasswordLogins,
  NODEWARDEN_DEFAULT_URL,
  removePasswordLogin,
  setSelectedPasswordLogin,
  type DisposableAlias,
  type PasswordLogin
} from "../../lib/passwords"

type Tab = "vault" | "autofill" | "aliases"

const TABS: { id: Tab; label: string }[] = [
  { id: "vault", label: "Vault" },
  { id: "autofill", label: "Autofill" },
  { id: "aliases", label: "Aliases" }
]

export function PasswordsSection() {
  const [tab, setTab] = useState<Tab>("vault")

  return (
    <section className="flex h-full flex-col overflow-hidden" data-testid="passwords-section">
      <div className="flex border-b border-border px-2 gap-1">
        {TABS.map((item) => (
          <LeoTabButton key={item.id} active={tab === item.id} onClick={() => setTab(item.id)}>
            {item.label}
          </LeoTabButton>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === "vault" && <VaultPanel />}
        {tab === "autofill" && <AutofillPanel />}
        {tab === "aliases" && <AliasesPanel />}
      </div>
    </section>
  )
}

function VaultPanel() {
  const openPopup = () => {
    void chrome.windows.create({
      type: "popup",
      url: NODEWARDEN_DEFAULT_URL,
      width: 460,
      height: 720
    })
  }

  return (
    <div className="flex h-full min-h-[520px] flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">Nodewarden</div>
          <div className="truncate text-[11px] text-fg/45">{NODEWARDEN_DEFAULT_URL}</div>
        </div>
        <button
          type="button"
          onClick={openPopup}
          className="rounded border border-border px-2 py-1 text-xs hover:bg-accent"
        >
          Popup
        </button>
      </div>
      <iframe
        src={NODEWARDEN_DEFAULT_URL}
        title="Nodewarden vault"
        className="min-h-0 flex-1 rounded border border-border bg-bg"
      />
    </div>
  )
}

function AutofillPanel() {
  const [logins, setLogins] = useState<PasswordLogin[]>([])
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    void refresh()
  }, [])

  async function refresh() {
    setLogins(await getPasswordLogins())
  }

  async function addLogin() {
    if (!url.trim() || !username.trim() || !password) return
    let fallbackName = url.trim()
    try {
      fallbackName = new URL(url).hostname
    } catch {
      return
    }
    await addPasswordLogin({
      name: name.trim() || fallbackName,
      username: username.trim(),
      password,
      urls: [url.trim()]
    })
    setName("")
    setUrl("")
    setUsername("")
    setPassword("")
    await refresh()
  }

  async function selectLogin(id: string | null) {
    setSelectedId(id)
    await setSelectedPasswordLogin(id)
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 rounded border border-border bg-card/30 p-3">
        <input className="rounded border border-border bg-bg px-2 py-1 text-xs" placeholder="Name" value={name} onChange={(event) => setName(event.target.value)} />
        <input className="rounded border border-border bg-bg px-2 py-1 text-xs" placeholder="https://example.com" value={url} onChange={(event) => setUrl(event.target.value)} />
        <input className="rounded border border-border bg-bg px-2 py-1 text-xs" placeholder="Email or username" value={username} onChange={(event) => setUsername(event.target.value)} />
        <input className="rounded border border-border bg-bg px-2 py-1 text-xs" placeholder="Password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        <button type="button" onClick={() => void addLogin()} className="rounded bg-primary px-2 py-1 text-xs text-bg">
          Add
        </button>
      </div>
      <div className="space-y-2">
        {logins.map((login) => (
          <div key={login.id} className="rounded border border-border bg-card/30 p-2 text-xs">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-medium">{login.name}</div>
                <div className="truncate text-fg/45">{login.username}</div>
                <div className="truncate text-[10px] text-fg/35">{login.urls.join(", ")}</div>
              </div>
              <button type="button" onClick={() => void removePasswordLogin(login.id).then(refresh)} className="text-fg/35 hover:text-error" aria-label="Remove login">
                x
              </button>
            </div>
            <label className="mt-2 flex items-center gap-2 text-[11px] text-fg/50">
              <input
                type="radio"
                checked={selectedId === login.id}
                onChange={() => void selectLogin(login.id)}
              />
              Active account
            </label>
          </div>
        ))}
      </div>
    </div>
  )
}

function AliasesPanel() {
  const [aliases, setAliases] = useState<DisposableAlias[]>([])
  const [alias, setAlias] = useState(generateDisposableAlias())
  const [forwardsTo, setForwardsTo] = useState("")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void getDisposableAliases().then(setAliases)
  }, [])

  const canCreate = useMemo(() => alias.includes("@fly.pm") && forwardsTo.includes("@"), [alias, forwardsTo])

  async function createAlias() {
    if (!canCreate) return
    setError(null)
    try {
      await createDisposableAlias(alias, forwardsTo)
      setAliases(await getDisposableAliases())
      setAlias(generateDisposableAlias())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function removeAlias(id: string) {
    await deleteDisposableAlias(id)
    setAliases(await getDisposableAliases())
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 rounded border border-border bg-card/30 p-3">
        <input className="rounded border border-border bg-bg px-2 py-1 text-xs" value={alias} onChange={(event) => setAlias(event.target.value)} />
        <input className="rounded border border-border bg-bg px-2 py-1 text-xs" placeholder="Forward to" value={forwardsTo} onChange={(event) => setForwardsTo(event.target.value)} />
        <button type="button" disabled={!canCreate} onClick={() => void createAlias()} className="rounded bg-primary px-2 py-1 text-xs text-bg disabled:opacity-45">
          Create
        </button>
        {error && <div className="text-[11px] text-error">{error}</div>}
      </div>
      {aliases.map((item) => (
        <div key={item.id} className="flex items-center justify-between gap-2 rounded border border-border bg-card/30 p-2 text-xs">
          <div className="min-w-0">
            <div className="truncate font-medium">{item.alias}</div>
            <div className="truncate text-fg/45">{item.forwardsTo}</div>
          </div>
          <button type="button" onClick={() => void removeAlias(item.id)} className="text-fg/35 hover:text-error" aria-label="Remove alias">
            x
          </button>
        </div>
      ))}
    </div>
  )
}
