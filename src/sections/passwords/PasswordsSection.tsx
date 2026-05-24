import { useEffect, useMemo, useState, type ReactNode } from "react"
import { LeoTabButton } from "../../components/leo"
import {
  addPasswordLogin,
  createDisposableAlias,
  deleteDisposableAlias,
  generateDisposableAlias,
  getDisposableAliases,
  getNodewardenServerUrl,
  getPasswordLogins,
  getSelectedPasswordLoginId,
  NODEWARDEN_DEFAULT_URL,
  removePasswordLogin,
  setNodewardenServerUrl,
  setSelectedPasswordLogin,
  updatePasswordLogin,
  type DisposableAlias,
  type PasswordLogin
} from "../../lib/passwords"
import { openPopupWindow } from "../../lib/popup-window"

type Tab = "vault" | "generator" | "aliases" | "web" | "settings"
type FormState = {
  id?: string
  name: string
  username: string
  password: string
  urls: string
  folder: string
  notes: string
  favorite: boolean
}

const TABS: { id: Tab; label: string }[] = [
  { id: "vault", label: "Vault" },
  { id: "generator", label: "Generator" },
  { id: "aliases", label: "Aliases" },
  { id: "web", label: "Web Vault" },
  { id: "settings", label: "Settings" }
]

const EMPTY_FORM: FormState = {
  name: "",
  username: "",
  password: "",
  urls: "",
  folder: "",
  notes: "",
  favorite: false
}

export function PasswordsSection() {
  const [tab, setTab] = useState<Tab>("vault")
  const [logins, setLogins] = useState<PasswordLogin[]>([])
  const [aliases, setAliases] = useState<DisposableAlias[]>([])
  const [serverUrl, setServerUrl] = useState(NODEWARDEN_DEFAULT_URL)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const refresh = async () => {
    const [nextLogins, nextAliases, nextServerUrl, nextSelectedId] = await Promise.all([
      getPasswordLogins(),
      getDisposableAliases(),
      getNodewardenServerUrl(),
      getSelectedPasswordLoginId()
    ])
    setLogins(nextLogins)
    setAliases(nextAliases)
    setServerUrl(nextServerUrl)
    setSelectedId(nextSelectedId)
  }

  useEffect(() => {
    void refresh()
  }, [])

  return (
    <section className="flex h-full min-w-0 flex-col overflow-hidden" data-testid="passwords-section">
      <div className="border-b border-border px-2">
        <div className="flex min-w-0 gap-1 overflow-x-auto">
          {TABS.map((item) => (
            <LeoTabButton key={item.id} active={tab === item.id} onClick={() => setTab(item.id)}>
              {item.label}
            </LeoTabButton>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {tab === "vault" && (
          <VaultPanel
            logins={logins}
            selectedId={selectedId}
            onRefresh={refresh}
            onSelectActive={async (id) => {
              await setSelectedPasswordLogin(id)
              setSelectedId(id)
            }}
          />
        )}
        {tab === "generator" && <GeneratorPanel onRefresh={refresh} />}
        {tab === "aliases" && (
          <AliasesPanel aliases={aliases} onRefresh={refresh} />
        )}
        {tab === "web" && <WebVaultPanel serverUrl={serverUrl} />}
        {tab === "settings" && (
          <SettingsPanel
            serverUrl={serverUrl}
            onServerUrlChange={(url) => setServerUrl(url)}
          />
        )}
      </div>
    </section>
  )
}

function VaultPanel({
  logins,
  selectedId,
  onRefresh,
  onSelectActive
}: {
  logins: PasswordLogin[]
  selectedId: string | null
  onRefresh: () => Promise<void>
  onSelectActive: (id: string | null) => Promise<void>
}) {
  const [query, setQuery] = useState("")
  const [folderFilter, setFolderFilter] = useState<string>("all")
  const [selectedLoginId, setSelectedLoginId] = useState<string | null>(logins[0]?.id ?? null)
  const [form, setForm] = useState<FormState | null>(null)
  const [revealedId, setRevealedId] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    if (selectedLoginId && logins.some((login) => login.id === selectedLoginId)) return
    setSelectedLoginId(logins[0]?.id ?? null)
  }, [logins, selectedLoginId])

  const folders = useMemo(
    () => Array.from(new Set(logins.map((login) => login.folder || "No folder"))).sort(),
    [logins]
  )
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return logins
      .filter((login) => folderFilter === "all" || (login.folder || "No folder") === folderFilter)
      .filter((login) => {
        if (!needle) return true
        return [
          login.name,
          login.username,
          login.urls.join(" "),
          login.folder || "",
          login.notes || ""
        ].some((value) => value.toLowerCase().includes(needle))
      })
      .sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.updatedAt - a.updatedAt)
  }, [folderFilter, logins, query])

  const selectedLogin = logins.find((login) => login.id === selectedLoginId) ?? filtered[0] ?? null

  const copy = async (value: string, key: string) => {
    await navigator.clipboard.writeText(value)
    setCopied(key)
    setTimeout(() => setCopied(null), 1200)
  }

  const startNew = () => setForm(EMPTY_FORM)
  const startEdit = (login: PasswordLogin) => setForm(formFromLogin(login))

  const saveForm = async () => {
    if (!form?.name.trim() || !form.password) return
    const payload = formToPayload(form)
    if (form.id) {
      await updatePasswordLogin(form.id, payload)
    } else {
      await addPasswordLogin(payload)
    }
    setForm(null)
    await onRefresh()
  }

  const deleteLogin = async (id: string) => {
    await removePasswordLogin(id)
    if (selectedId === id) await onSelectActive(null)
    await onRefresh()
  }

  return (
    <div className="flex h-full min-h-[520px] min-w-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold">Passwords</div>
          <div className="text-[11px] text-fg/45">{logins.length} items</div>
        </div>
        <button
          type="button"
          onClick={startNew}
          className="rounded bg-primary px-2.5 py-1.5 text-xs font-medium text-bg hover:opacity-90"
        >
          New
        </button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(190px,0.9fr)_minmax(230px,1.1fr)] gap-3 max-[620px]:grid-cols-1">
        <aside className="flex min-h-0 flex-col overflow-hidden rounded border border-border bg-card/20">
          <div className="border-b border-border p-2">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search vault"
              className="w-full rounded border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-primary"
            />
            <div className="mt-2 flex gap-1 overflow-x-auto">
              <FilterPill active={folderFilter === "all"} onClick={() => setFolderFilter("all")}>
                All
              </FilterPill>
              {folders.map((folder) => (
                <FilterPill
                  key={folder}
                  active={folderFilter === folder}
                  onClick={() => setFolderFilter(folder)}
                >
                  {folder}
                </FilterPill>
              ))}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="p-3 text-xs text-fg/40">No items</div>
            ) : (
              filtered.map((login) => (
                <button
                  key={login.id}
                  type="button"
                  onClick={() => {
                    setSelectedLoginId(login.id)
                    setForm(null)
                  }}
                  className={`flex w-full items-center gap-2 border-b border-border/60 p-2 text-left transition-colors ${
                    selectedLogin?.id === login.id ? "bg-accent/60" : "hover:bg-accent/35"
                  }`}
                >
                  <WebsiteMark login={login} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1 text-xs font-medium">
                      <span className="truncate">{login.name}</span>
                      {login.favorite && <span className="text-[10px] text-warning">star</span>}
                    </span>
                    <span className="block truncate text-[10px] text-fg/45">{login.username}</span>
                    <span className="block truncate text-[10px] text-fg/35">{hostLabel(login)}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </aside>

        <main className="min-h-0 overflow-y-auto rounded border border-border bg-card/20">
          {form ? (
            <LoginForm
              form={form}
              onChange={setForm}
              onCancel={() => setForm(null)}
              onSave={() => void saveForm()}
            />
          ) : selectedLogin ? (
            <div className="space-y-3 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <WebsiteMark login={selectedLogin} large />
                    <div className="min-w-0">
                      <h2 className="truncate text-sm font-semibold">{selectedLogin.name}</h2>
                      <div className="truncate text-[11px] text-fg/45">{hostLabel(selectedLogin)}</div>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    void updatePasswordLogin(selectedLogin.id, {
                      favorite: !selectedLogin.favorite
                    }).then(onRefresh)
                  }
                  className="rounded border border-border px-2 py-1 text-[11px] hover:bg-accent"
                >
                  {selectedLogin.favorite ? "Unstar" : "Star"}
                </button>
              </div>

              <FieldRow label="Username" value={selectedLogin.username}>
                <SmallButton onClick={() => void copy(selectedLogin.username, "username")}>
                  {copied === "username" ? "Copied" : "Copy"}
                </SmallButton>
              </FieldRow>
              <FieldRow
                label="Password"
                value={revealedId === selectedLogin.id ? selectedLogin.password : maskPassword(selectedLogin.password)}
              >
                <SmallButton
                  onClick={() =>
                    setRevealedId(revealedId === selectedLogin.id ? null : selectedLogin.id)
                  }
                >
                  {revealedId === selectedLogin.id ? "Hide" : "Show"}
                </SmallButton>
                <SmallButton onClick={() => void copy(selectedLogin.password, "password")}>
                  {copied === "password" ? "Copied" : "Copy"}
                </SmallButton>
              </FieldRow>

              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-wide text-fg/35">URIs</div>
                {selectedLogin.urls.map((url) => (
                  <div key={url} className="flex items-center gap-2 rounded border border-border bg-bg/60 px-2 py-1.5">
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg/70">{url}</span>
                    <SmallButton onClick={() => void copy(url, `url:${url}`)}>
                      {copied === `url:${url}` ? "Copied" : "Copy"}
                    </SmallButton>
                    <SmallButton onClick={() => void openPopupWindow(url, 980, 720)}>
                      Open
                    </SmallButton>
                  </div>
                ))}
              </div>

              {(selectedLogin.folder || selectedLogin.notes) && (
                <div className="grid gap-2">
                  {selectedLogin.folder && (
                    <FieldRow label="Folder" value={selectedLogin.folder} />
                  )}
                  {selectedLogin.notes && (
                    <FieldRow label="Notes" value={selectedLogin.notes} multiline />
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                <button
                  type="button"
                  onClick={() => void onSelectActive(selectedLogin.id)}
                  className="rounded bg-primary px-2.5 py-1.5 text-xs font-medium text-bg hover:opacity-90"
                >
                  {selectedId === selectedLogin.id ? "Active" : "Use for autofill"}
                </button>
                <button
                  type="button"
                  onClick={() => startEdit(selectedLogin)}
                  className="rounded border border-border px-2.5 py-1.5 text-xs hover:bg-accent"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => void deleteLogin(selectedLogin.id)}
                  className="ml-auto rounded border border-border px-2.5 py-1.5 text-xs text-error hover:bg-error/10"
                >
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <div className="p-3 text-xs text-fg/40">No item selected</div>
          )}
        </main>
      </div>
    </div>
  )
}

function LoginForm({
  form,
  onChange,
  onCancel,
  onSave
}: {
  form: FormState
  onChange: (form: FormState) => void
  onCancel: () => void
  onSave: () => void
}) {
  return (
    <div className="grid gap-3 p-3">
      <div className="text-sm font-semibold">{form.id ? "Edit item" : "New item"}</div>
      <TextInput label="Name" value={form.name} onChange={(name) => onChange({ ...form, name })} />
      <TextInput label="Username" value={form.username} onChange={(username) => onChange({ ...form, username })} />
      <TextInput label="Password" type="password" value={form.password} onChange={(password) => onChange({ ...form, password })} />
      <TextAreaInput label="URIs" value={form.urls} onChange={(urls) => onChange({ ...form, urls })} />
      <TextInput label="Folder" value={form.folder} onChange={(folder) => onChange({ ...form, folder })} />
      <label className="flex items-center gap-2 text-xs text-fg/65">
        <input
          type="checkbox"
          checked={form.favorite}
          onChange={(event) => onChange({ ...form, favorite: event.target.checked })}
        />
        Favorite
      </label>
      <label className="grid gap-1">
        <span className="text-[10px] uppercase tracking-wide text-fg/35">Notes</span>
        <textarea
          value={form.notes}
          onChange={(event) => onChange({ ...form, notes: event.target.value })}
          className="min-h-[72px] rounded border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-primary"
        />
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded border border-border px-2.5 py-1.5 text-xs hover:bg-accent">
          Cancel
        </button>
        <button type="button" onClick={onSave} className="rounded bg-primary px-2.5 py-1.5 text-xs font-medium text-bg hover:opacity-90">
          Save
        </button>
      </div>
    </div>
  )
}

function GeneratorPanel({ onRefresh }: { onRefresh: () => Promise<void> }) {
  const [length, setLength] = useState(20)
  const [includeSymbols, setIncludeSymbols] = useState(true)
  const [includeNumbers, setIncludeNumbers] = useState(true)
  const [generated, setGenerated] = useState(() => generatePassword(20, true, true))
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [username, setUsername] = useState("")

  const regenerate = () => setGenerated(generatePassword(length, includeNumbers, includeSymbols))

  useEffect(() => {
    regenerate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [length, includeNumbers, includeSymbols])

  const saveGenerated = async () => {
    if (!name.trim() || !url.trim()) return
    await addPasswordLogin({
      name: name.trim(),
      username: username.trim(),
      password: generated,
      urls: [url.trim()],
      favorite: false,
      folder: "Generated"
    })
    setName("")
    setUrl("")
    setUsername("")
    await onRefresh()
  }

  return (
    <div className="grid gap-3">
      <div className="rounded border border-border bg-card/25 p-3">
        <div className="mb-2 text-sm font-semibold">Password Generator</div>
        <div className="break-all rounded border border-border bg-bg p-3 font-mono text-sm">{generated}</div>
        <div className="mt-3 grid gap-3">
          <label className="grid gap-1 text-xs">
            <span className="text-fg/45">Length {length}</span>
            <input
              type="range"
              min={8}
              max={64}
              value={length}
              onChange={(event) => setLength(Number(event.target.value))}
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-fg/65">
            <input type="checkbox" checked={includeNumbers} onChange={(event) => setIncludeNumbers(event.target.checked)} />
            Numbers
          </label>
          <label className="flex items-center gap-2 text-xs text-fg/65">
            <input type="checkbox" checked={includeSymbols} onChange={(event) => setIncludeSymbols(event.target.checked)} />
            Symbols
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={regenerate} className="rounded border border-border px-2.5 py-1.5 text-xs hover:bg-accent">
              Regenerate
            </button>
            <button type="button" onClick={() => void navigator.clipboard.writeText(generated)} className="rounded border border-border px-2.5 py-1.5 text-xs hover:bg-accent">
              Copy
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-2 rounded border border-border bg-card/25 p-3">
        <div className="text-sm font-semibold">Save generated item</div>
        <TextInput label="Name" value={name} onChange={setName} />
        <TextInput label="URI" value={url} onChange={setUrl} />
        <TextInput label="Username" value={username} onChange={setUsername} />
        <button type="button" onClick={() => void saveGenerated()} className="rounded bg-primary px-2.5 py-1.5 text-xs font-medium text-bg hover:opacity-90">
          Save
        </button>
      </div>
    </div>
  )
}

function AliasesPanel({
  aliases,
  onRefresh
}: {
  aliases: DisposableAlias[]
  onRefresh: () => Promise<void>
}) {
  const [alias, setAlias] = useState(generateDisposableAlias())
  const [forwardsTo, setForwardsTo] = useState("")
  const [error, setError] = useState<string | null>(null)
  const canCreate = useMemo(() => alias.includes("@fly.pm") && forwardsTo.includes("@"), [alias, forwardsTo])

  async function createAlias() {
    if (!canCreate) return
    setError(null)
    try {
      await createDisposableAlias(alias, forwardsTo)
      setAlias(generateDisposableAlias())
      await onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function removeAlias(id: string) {
    await deleteDisposableAlias(id)
    await onRefresh()
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-2 rounded border border-border bg-card/25 p-3">
        <div className="text-sm font-semibold">Disposable aliases</div>
        <TextInput label="Alias" value={alias} onChange={setAlias} />
        <TextInput label="Forward to" value={forwardsTo} onChange={setForwardsTo} />
        <button type="button" disabled={!canCreate} onClick={() => void createAlias()} className="rounded bg-primary px-2.5 py-1.5 text-xs font-medium text-bg hover:opacity-90 disabled:opacity-45">
          Create
        </button>
        {error && <div className="text-[11px] text-error">{error}</div>}
      </div>
      <div className="grid gap-2">
        {aliases.map((item) => (
          <div key={item.id} className="flex items-center justify-between gap-2 rounded border border-border bg-card/25 p-2 text-xs">
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
    </div>
  )
}

function WebVaultPanel({ serverUrl }: { serverUrl: string }) {
  return (
    <div className="flex h-full min-h-[560px] flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 truncate text-xs text-fg/45">{serverUrl}</div>
        <button
          type="button"
          onClick={() => void openPopupWindow(serverUrl, 460, 720)}
          className="rounded border border-border px-2 py-1 text-xs hover:bg-accent"
        >
          Popup
        </button>
      </div>
      <iframe
        src={serverUrl}
        title="Nodewarden vault"
        className="min-h-0 flex-1 rounded border border-border bg-bg"
      />
    </div>
  )
}

function SettingsPanel({
  serverUrl,
  onServerUrlChange
}: {
  serverUrl: string
  onServerUrlChange: (url: string) => void
}) {
  const [draft, setDraft] = useState(serverUrl)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => setDraft(serverUrl), [serverUrl])

  const save = async () => {
    try {
      const next = await setNodewardenServerUrl(draft)
      onServerUrlChange(next)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-2 rounded border border-border bg-card/25 p-3">
        <div className="text-sm font-semibold">Server</div>
        <TextInput label="Nodewarden URL" value={draft} onChange={setDraft} />
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void save()} className="rounded bg-primary px-2.5 py-1.5 text-xs font-medium text-bg hover:opacity-90">
            Save
          </button>
          <button type="button" onClick={() => setDraft(NODEWARDEN_DEFAULT_URL)} className="rounded border border-border px-2.5 py-1.5 text-xs hover:bg-accent">
            Default
          </button>
        </div>
        {error && <div className="text-[11px] text-error">{error}</div>}
      </div>
    </div>
  )
}

function TextInput({
  label,
  value,
  onChange,
  type = "text"
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
}) {
  return (
    <label className="grid gap-1">
      <span className="text-[10px] uppercase tracking-wide text-fg/35">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-primary"
      />
    </label>
  )
}

function TextAreaInput({
  label,
  value,
  onChange
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="grid gap-1">
      <span className="text-[10px] uppercase tracking-wide text-fg/35">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-[72px] rounded border border-border bg-bg px-2 py-1.5 text-xs outline-none focus:border-primary"
      />
    </label>
  )
}

function FieldRow({
  label,
  value,
  children,
  multiline
}: {
  label: string
  value: string
  children?: ReactNode
  multiline?: boolean
}) {
  return (
    <div className="grid gap-1 rounded border border-border bg-bg/60 p-2">
      <div className="text-[10px] uppercase tracking-wide text-fg/35">{label}</div>
      <div className="flex items-start gap-2">
        <div className={`min-w-0 flex-1 break-words font-mono text-xs text-fg/75 ${multiline ? "whitespace-pre-wrap" : "truncate"}`}>
          {value}
        </div>
        {children && <div className="flex shrink-0 gap-1">{children}</div>}
      </div>
    </div>
  )
}

function SmallButton({
  children,
  onClick
}: {
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick} className="rounded border border-border px-1.5 py-0.5 text-[10px] hover:bg-accent">
      {children}
    </button>
  )
}

function FilterPill({
  active,
  children,
  onClick
}: {
  active: boolean
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`whitespace-nowrap rounded px-2 py-0.5 text-[10px] ${
        active ? "bg-primary text-bg" : "bg-accent/50 text-fg/55 hover:text-fg"
      }`}
    >
      {children}
    </button>
  )
}

function WebsiteMark({ login, large }: { login: PasswordLogin; large?: boolean }) {
  const host = hostLabel(login)
  const label = (login.name || host || "?").slice(0, 1).toUpperCase()
  return (
    <span className={`grid shrink-0 place-items-center rounded bg-chart-1/20 text-chart-1 ${large ? "h-9 w-9 text-sm" : "h-8 w-8 text-xs"}`}>
      {label}
    </span>
  )
}

function formFromLogin(login: PasswordLogin): FormState {
  return {
    id: login.id,
    name: login.name,
    username: login.username,
    password: login.password,
    urls: login.urls.join("\n"),
    folder: login.folder || "",
    notes: login.notes || "",
    favorite: login.favorite === true
  }
}

function formToPayload(form: FormState): Omit<PasswordLogin, "id" | "updatedAt"> {
  return {
    name: form.name.trim(),
    username: form.username.trim(),
    password: form.password,
    urls: form.urls
      .split("\n")
      .map((url) => url.trim())
      .filter(Boolean),
    folder: form.folder.trim() || undefined,
    notes: form.notes.trim() || undefined,
    favorite: form.favorite
  }
}

function hostLabel(login: PasswordLogin): string {
  for (const url of login.urls) {
    try {
      return new URL(url).hostname.replace(/^www\./, "")
    } catch {
      // Ignore malformed local entries; the raw URL still renders elsewhere.
    }
  }
  return login.urls[0] || ""
}

function maskPassword(password: string): string {
  return "•".repeat(Math.min(Math.max(password.length, 8), 24))
}

function generatePassword(length: number, includeNumbers: boolean, includeSymbols: boolean): string {
  const letters = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ"
  const numbers = "23456789"
  const symbols = "!@#$%^&*_-+="
  const alphabet = letters + (includeNumbers ? numbers : "") + (includeSymbols ? symbols : "")
  const maxValidByte = 256 - (256 % alphabet.length)
  let result = ""

  while (result.length < length) {
    const bytes = new Uint8Array(Math.max(16, length - result.length))
    crypto.getRandomValues(bytes)
    for (const byte of bytes) {
      if (byte >= maxValidByte) continue
      result += alphabet[byte % alphabet.length]
      if (result.length >= length) break
    }
  }

  return result
}
