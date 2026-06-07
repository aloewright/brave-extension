import React from "react"
import { createRoot } from "react-dom/client"
import "./styles.css"

// TEMPORARY bootstrap. Task 2 replaces this with the real App + TanStack router.
const container = document.getElementById("root")
if (!container) throw new Error("#root missing from index.html")

createRoot(container).render(
  <React.StrictMode>
    <div>Agent UI</div>
  </React.StrictMode>
)
