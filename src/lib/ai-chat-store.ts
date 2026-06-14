// src/lib/ai-chat-store.ts
//
// Storage layer for the rolling AI chat conversation. Single key in
// chrome.storage.local. Append-only at runtime; updateMessage exists for future
// patching paths but the orchestrator never calls it in V1.

import type { ChatMessage, Conversation } from "./ai-chat-types"
import { ExtensionStorage } from "./extension-storage"

const STORAGE_KEY = "ai-dev-ai-chat-conversation"
const storage = new ExtensionStorage()

export async function getConversation(): Promise<Conversation> {
  const raw = await storage.get<Conversation>(STORAGE_KEY)
  if (!raw || !Array.isArray(raw.messages)) return { messages: [] }
  return raw
}

export async function setConversation(conv: Conversation): Promise<void> {
  await storage.set(STORAGE_KEY, conv)
}

export async function appendMessage(m: ChatMessage): Promise<void> {
  const conv = await getConversation()
  conv.messages.push(m)
  await setConversation(conv)
}

export async function updateMessage(
  id: string,
  patch: Partial<ChatMessage>
): Promise<void> {
  const conv = await getConversation()
  const i = conv.messages.findIndex((m) => m.id === id)
  if (i < 0) return
  conv.messages[i] = { ...conv.messages[i], ...patch }
  await setConversation(conv)
}

export async function clearConversation(): Promise<void> {
  await storage.set(STORAGE_KEY, { messages: [] } satisfies Conversation)
}

export async function setCompactedHead(
  summary: string,
  truncatedThrough: string
): Promise<void> {
  const conv = await getConversation()
  conv.compactedHead = { summary, truncatedThrough }
  await setConversation(conv)
}
