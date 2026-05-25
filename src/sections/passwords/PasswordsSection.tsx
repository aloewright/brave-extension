import { useEffect, useState } from "react"
import { getNodewardenServerUrl, NODEWARDEN_DEFAULT_URL } from "../../lib/passwords"

export function PasswordsSection() {
  const [serverUrl, setServerUrl] = useState(NODEWARDEN_DEFAULT_URL)

  useEffect(() => {
    getNodewardenServerUrl().then(setServerUrl)
  }, [])

  return (
    <section className="flex h-full min-w-0 flex-col overflow-hidden bg-bg" data-testid="passwords-section">
      <iframe
        src={serverUrl}
        title="Nodewarden vault"
        className="h-full w-full border-none"
        allow="clipboard-read; clipboard-write"
      />
    </section>
  )
}
