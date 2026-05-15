import type { CSSProperties } from "react"
import "./style.css"
import { companyNameForDomain } from "./lib/company-names"
import { WORKSPACE_APPS } from "./newtab-apps"

function NewTabWorkspace() {
  return (
    <div className="newtab-workspace">
      <main className="newtab-workspace__shell">
        <header className="newtab-workspace__header">
          <p className="newtab-workspace__eyebrow">Workspace</p>
          <span className="newtab-workspace__count">
            {WORKSPACE_APPS.length} links
          </span>
        </header>

        <section
          className="newtab-workspace__grid"
          aria-label="Workspace app links"
        >
          {WORKSPACE_APPS.map((app) => (
            <a
              key={app.url}
              className="workspace-app-card"
              href={app.url}
              aria-label={`Open ${app.name}`}
              style={{ "--workspace-app-accent": app.accent } as CSSProperties}
            >
              <span className="workspace-app-card__mark" aria-hidden="true">
                {app.initials}
              </span>
              <span className="workspace-app-card__body">
                <span className="workspace-app-card__name">{app.name}</span>
                <span className="workspace-app-card__domain">{companyNameForDomain(app.domain)}</span>
              </span>
              <span className="workspace-app-card__action">Open</span>
            </a>
          ))}
        </section>
      </main>
    </div>
  )
}

export default NewTabWorkspace
