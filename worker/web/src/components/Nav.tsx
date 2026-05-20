import { NavLink } from "react-router-dom"
import { SignOutButton } from "../auth"

const sections = [
  { to: "/search", label: "Search" },
  { to: "/conversations", label: "Conversations" },
  { to: "/links", label: "Links" },
  { to: "/bookmarks", label: "Bookmarks" },
  { to: "/recordings", label: "Recordings" },
  { to: "/pdfs", label: "PDFs" }
]

export function Nav() {
  return (
    <nav className="border-b border-fg/10 px-6 py-3 flex items-center gap-6 text-sm">
      <span className="font-medium">Sidebar</span>
      <ul className="flex gap-4 flex-1">
        {sections.map((s) => (
          <li key={s.to}>
            <NavLink
              to={s.to}
              className={({ isActive }) =>
                `hover:text-fg ${isActive ? "text-fg" : "text-muted"}`
              }
            >
              {s.label}
            </NavLink>
          </li>
        ))}
      </ul>
      <SignOutButton />
    </nav>
  )
}
