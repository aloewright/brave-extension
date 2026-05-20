import { Routes, Route, Navigate } from "react-router-dom"

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/search" replace />} />
      <Route path="/search" element={<div className="p-6">Search (coming soon)</div>} />
      <Route path="*" element={<div className="p-6">Not found</div>} />
    </Routes>
  )
}
