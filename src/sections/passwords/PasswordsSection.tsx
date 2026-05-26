import { useEffect, useMemo, useState } from "react"
import { LeoBadge, LeoButton, LeoIcon, LeoIconButton, LeoTabButton, cx } from "../../components/leo"
import {
  addPasswordLogin,
  getNodewardenServerUrl,
  getPasswordLogins,
  NODEWARDEN_DEFAULT_URL,
  removePasswordLogin,
  setNodewardenServerUrl,
  updatePasswordLogin,
  type PasswordLogin
} from "../../lib/passwords"

type PasswordTab = "vault" | "generator" | "web"

const PASSWORD_TABS: Array<{ id: PasswordTab; label: string }> = [
  { id: "vault", label: "Vault" },
  { id: "generator", label: "Generator" },
  { id: "web", label: "Web Vault" }
]

const EMPTY_FORM = {
  name: "",
  username: "",
  password: "",
  urls: "",
  folder: "",
  notes: ""
}

export function PasswordsSection() {
  const [activeTab, setActiveTab] = useState<PasswordTab>("vault")
  const [serverUrl, setServerUrl] = useState(NODEWARDEN_DEFAULT_URL)
  const [serverDraft, setServerDraft] = useState(NODEWARDEN_DEFAULT_URL)
  const [logins, setLogins] = useState<PasswordLogin[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [query, setQuery] = useState("")
  const [generatedPassword, setGeneratedPassword] = useState(() => generatePassword())
  const [status, setStatus] = useState("")

  useEffect(() => {
    void refreshVault()
    getNodewardenServerUrl().then((url) => {
      setServerUrl(url)
      setServerDraft(url)
    })
  }, [])

  const filteredLogins = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return logins
    return logins.filter((login) =>
      [login.name, login.username, login.folder, ...login.urls].some((value) =>
        value?.toLowerCase().includes(needle)
      )
    )
  }, [logins, query])

  const selectedLogin = useMemo(
    () => logins.find((login) => login.id === selectedId) ?? null,
    [logins, selectedId]
  )

  async function refreshVault() {
    const nextLogins = await getPasswordLogins()
    setLogins(nextLogins)
    setSelectedId((current) => current ?? nextLogins[0]?.id ?? null)
  }

  function startNewLogin() {
    setSelectedId(null)
    setForm(EMPTY_FORM)
    setStatus("")
  }

  function selectLogin(login: PasswordLogin) {
    setSelectedId(login.id)
    setForm({
      name: login.name,
      username: login.username,
      password: login.password,
      urls: login.urls.join("\n"),
      folder: login.folder ?? "",
      notes: login.notes ?? ""
    })
    setStatus("")
  }

  async function saveLogin() {
    const urls = form.urls
      .split("\n")
      .map((url) => url.trim())
      .filter(Boolean)
    if (!form.name.trim() || !form.username.trim() || !form.password || !urls.length) {
      setStatus("Name, username, password, and at least one URI are required.")
      return
    }
    if (selectedLogin) {
      await updatePasswordLogin(selectedLogin.id, {
        name: form.name.trim(),
        username: form.username.trim(),
        password: form.password,
        urls,
        folder: form.folder.trim() || undefined,
        notes: form.notes.trim() || undefined
      })
      setStatus("Updated")
    } else {
      const created = await addPasswordLogin({
        name: form.name.trim(),
        username: form.username.trim(),
        password: form.password,
        urls,
        folder: form.folder.trim() || undefined,
        notes: form.notes.trim() || undefined
      })
      setSelectedId(created.id)
      setStatus("Saved")
    }
    await refreshVault()
  }

  async function deleteLogin() {
    if (!selectedLogin) return
    await removePasswordLogin(selectedLogin.id)
    setSelectedId(null)
    setForm(EMPTY_FORM)
    setStatus("Deleted")
    await refreshVault()
  }

  async function saveServerUrl() {
    try {
      const normalized = await setNodewardenServerUrl(serverDraft)
      setServerUrl(normalized)
      setServerDraft(normalized)
      setStatus("Server saved")
    } catch {
      setStatus("Enter a valid http or https URL.")
    }
  }

  function useGeneratedPassword() {
    setForm((current) => ({ ...current, password: generatedPassword }))
    setActiveTab("vault")
    setStatus("Password inserted")
  }

  return (
    <section className="flex h-full min-w-0 flex-col overflow-hidden bg-bg text-fg" data-testid="passwords-section">
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="border-b border-border bg-bg/95 px-3 pt-3">
          <div className="mb-3 flex min-w-0 items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="grid size-7 place-items-center rounded-md bg-primary/15 text-primary">
                <LeoIcon name="lock" size={15} />
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold leading-5">Passwords</h2>
                <p className="truncate text-[11px] text-fg/45">{serverUrl}</p>
              </div>
            </div>
            <LeoButton size="xs" variant="primary" onClick={startNewLogin}>
              New
            </LeoButton>
          </div>
          <nav className="flex min-w-0 overflow-x-auto" aria-label="Password views">
            {PASSWORD_TABS.map((tab) => (
              <LeoTabButton key={tab.id} active={activeTab === tab.id} onClick={() => setActiveTab(tab.id)}>
                {tab.label}
              </LeoTabButton>
            ))}
          </nav>
        </header>

        {activeTab === "vault" && (
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(190px,0.9fr)_minmax(230px,1.1fr)] overflow-hidden max-[620px]:grid-cols-1">
            <aside className="flex min-h-0 flex-col border-r border-border max-[620px]:max-h-[42vh] max-[620px]:border-b max-[620px]:border-r-0">
              <div className="border-b border-border p-2">
                <input
                  value={query}
                  onChange={(event) => setQuery(event.currentTarget.value)}
                  placeholder="Search vault"
                  className="h-8 w-full rounded-md border border-border bg-secondary px-2 text-xs outline-none focus:border-primary/60"
                />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {filteredLogins.length ? (
                  <div className="space-y-1.5">
                    {filteredLogins.map((login) => (
                      <button
                        key={login.id}
                        type="button"
                        onClick={() => selectLogin(login)}
                        className={cx(
                          "w-full rounded-md border p-2 text-left transition-colors",
                          selectedId === login.id
                            ? "border-primary/40 bg-primary/10"
                            : "border-border bg-secondary/45 hover:bg-secondary"
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-medium">{login.name}</span>
                          {login.favorite && <LeoIcon name="star-outline" size={13} className="text-warning" />}
                        </div>
                        <div className="mt-1 truncate text-[11px] text-fg/50">{login.username}</div>
                        <div className="mt-1 truncate text-[10px] text-fg/35">{login.urls[0]}</div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed border-border p-3 text-xs text-fg/45">
                    No matching vault items.
                  </div>
                )}
              </div>
            </aside>

            <div className="min-h-0 overflow-y-auto p-3">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold">{selectedLogin ? "Edit login" : "New login"}</h3>
                    <p className="text-[11px] text-fg/45">Local autofill cache synced with the Nodewarden tab.</p>
                  </div>
                  {selectedLogin && (
                    <LeoIconButton icon="trash" variant="danger" title="Delete login" onClick={() => void deleteLogin()} />
                  )}
                </div>

                <div className="grid gap-2 min-[780px]:grid-cols-2">
                  <TextInput label="Name" value={form.name} onChange={(value) => setForm((current) => ({ ...current, name: value }))} />
                  <TextInput label="Username" value={form.username} onChange={(value) => setForm((current) => ({ ...current, username: value }))} />
                  <TextInput label="Password" type="password" value={form.password} onChange={(value) => setForm((current) => ({ ...current, password: value }))} />
                  <TextInput label="Folder" value={form.folder} onChange={(value) => setForm((current) => ({ ...current, folder: value }))} />
                </div>
                <TextAreaInput label="URIs" value={form.urls} onChange={(value) => setForm((current) => ({ ...current, urls: value }))} rows={3} />
                <TextAreaInput label="Notes" value={form.notes} onChange={(value) => setForm((current) => ({ ...current, notes: value }))} rows={4} />

                <div className="flex flex-wrap items-center gap-2">
                  <LeoButton variant="primary" onClick={() => void saveLogin()}>
                    Save
                  </LeoButton>
                  <LeoButton variant="neutral" onClick={() => setForm((current) => ({ ...current, password: generatePassword() }))}>
                    Generate
                  </LeoButton>
                  {status && <span className="text-[11px] text-fg/45">{status}</span>}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "generator" && (
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <div className="mx-auto flex max-w-xl flex-col gap-3">
              <div className="rounded-md border border-border bg-secondary/35 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">Generator</h3>
                  <LeoBadge variant="success">unbiased</LeoBadge>
                </div>
                <div className="break-all rounded-md border border-border bg-bg p-3 font-mono text-xs">
                  {generatedPassword}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <LeoButton onClick={() => setGeneratedPassword(generatePassword())}>Refresh</LeoButton>
                  <LeoButton variant="primary" onClick={useGeneratedPassword}>Use password</LeoButton>
                </div>
              </div>
              <div className="rounded-md border border-border bg-secondary/35 p-3 text-xs text-fg/55">
                Password bytes are sampled with rejection to avoid modulo bias.
              </div>
            </div>
          </div>
        )}

        {activeTab === "web" && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex flex-wrap items-end gap-2 border-b border-border p-3">
              <TextInput className="min-w-[220px] flex-1" label="Nodewarden URL" value={serverDraft} onChange={setServerDraft} />
              <LeoButton variant="primary" onClick={() => void saveServerUrl()}>Save</LeoButton>
              <LeoButton onClick={() => window.open(serverUrl, "nodewarden-vault", "popup,width=980,height=720")}>
                Open
              </LeoButton>
            </div>
            <iframe
              src={serverUrl}
              title="Nodewarden vault"
              className="min-h-0 flex-1 border-none"
              allow="clipboard-read; clipboard-write"
            />
          </div>
        )}
      </div>
    </section>
  )
}

function TextInput({
  className,
  label,
  onChange,
  type = "text",
  value
}: {
  className?: string
  label: string
  onChange: (value: string) => void
  type?: string
  value: string
}) {
  return (
    <label className={cx("block min-w-0", className)}>
      <span className="mb-1 block text-[11px] font-medium text-fg/55">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        className="h-8 w-full rounded-md border border-border bg-secondary px-2 text-xs outline-none focus:border-primary/60"
      />
    </label>
  )
}

function TextAreaInput({
  label,
  onChange,
  rows,
  value
}: {
  label: string
  onChange: (value: string) => void
  rows: number
  value: string
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[11px] font-medium text-fg/55">{label}</span>
      <textarea
        rows={rows}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        className="w-full resize-y rounded-md border border-border bg-secondary px-2 py-1.5 text-xs outline-none focus:border-primary/60"
      />
    </label>
  )
}

function generatePassword(length = 22): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*()-_=+"
  const maxValidByte = Math.floor(256 / alphabet.length) * alphabet.length
  const out: string[] = []
  while (out.length < length) {
    const bytes = new Uint8Array((length - out.length) * 2)
    crypto.getRandomValues(bytes)
    for (const byte of bytes) {
      if (byte >= maxValidByte) continue
      out.push(alphabet[byte % alphabet.length])
      if (out.length === length) break
    }
  }
  return out.join("")
}
