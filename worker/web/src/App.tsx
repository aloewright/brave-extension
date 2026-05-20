import { Routes, Route, Navigate } from "react-router-dom"
import { TokenGate } from "./auth"
import { Nav } from "./components/Nav"
import { Search } from "./pages/Search"
import { Conversations, ConversationDetail } from "./pages/Conversations"
import { Links } from "./pages/Links"
import { Bookmarks } from "./pages/Bookmarks"
import { Recordings, RecordingDetail } from "./pages/Recordings"
import { Pdfs, PdfDetail } from "./pages/Pdfs"

export default function App() {
  return (
    <TokenGate>
      <div className="min-h-screen flex flex-col">
        <Nav />
        <main className="flex-1">
          <Routes>
            <Route path="/" element={<Navigate to="/search" replace />} />
            <Route path="/search" element={<Search />} />
            <Route path="/conversations" element={<Conversations />} />
            <Route path="/conversations/:id" element={<ConversationDetail />} />
            <Route path="/links" element={<Links />} />
            <Route path="/bookmarks" element={<Bookmarks />} />
            <Route path="/recordings" element={<Recordings />} />
            <Route path="/recordings/:id" element={<RecordingDetail />} />
            <Route path="/pdfs" element={<Pdfs />} />
            <Route path="/pdfs/:id" element={<PdfDetail />} />
            <Route path="*" element={<div className="p-6 text-muted">Not found.</div>} />
          </Routes>
        </main>
      </div>
    </TokenGate>
  )
}
