import { useEffect, useState } from "react"
import * as store from "../storage"
import type { CollectedLink, Group, Profile, Settings } from "../types"
import { DEFAULT_STORAGE } from "../types"

export function useLastUsed() {
  const [lastUsed, setLastUsed] = useState<Record<string, string>>({})

  useEffect(() => {
    store.getLastUsed().then(setLastUsed)
  }, [])

  const touch = async (id: string) => {
    const next = { ...lastUsed, [id]: new Date().toISOString() }
    await store.setLastUsed(next)
    setLastUsed(next)
  }

  return { lastUsed, touch }
}

export function useProfiles() {
  const [profiles, setProfiles] = useState<Profile[]>([])

  useEffect(() => {
    store.getProfiles().then(setProfiles)
  }, [])

  const save = async (p: Profile[]) => {
    await store.setProfiles(p)
    setProfiles(p)
  }

  const addProfile = async (name: string, extensionIds: string[]) => {
    const p: Profile = { id: crypto.randomUUID(), name, extensionIds }
    await save([...profiles, p])
    return p
  }

  const removeProfile = async (id: string) => {
    await save(profiles.filter((p) => p.id !== id))
  }

  const updateProfile = async (id: string, updates: Partial<Profile>) => {
    await save(profiles.map((p) => (p.id === id ? { ...p, ...updates } : p)))
  }

  return { profiles, addProfile, removeProfile, updateProfile }
}

export function useGroups() {
  const [groups, setGroups] = useState<Group[]>([])

  useEffect(() => {
    store.getGroups().then(setGroups)
  }, [])

  const save = async (g: Group[]) => {
    await store.setGroups(g)
    setGroups(g)
  }

  const addGroup = async (name: string, extensionIds: string[]) => {
    const g: Group = { id: crypto.randomUUID(), name, extensionIds, enabled: false }
    await save([...groups, g])
    return g
  }

  const removeGroup = async (id: string) => {
    await save(groups.filter((g) => g.id !== id))
  }

  const toggleGroup = async (id: string) => {
    const group = groups.find((g) => g.id === id)
    if (!group) return
    const newEnabled = !group.enabled
    for (const extId of group.extensionIds) {
      try {
        await chrome.management.setEnabled(extId, newEnabled)
      } catch {}
    }
    await save(groups.map((g) => (g.id === id ? { ...g, enabled: newEnabled } : g)))
  }

  return { groups, addGroup, removeGroup, toggleGroup }
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_STORAGE.settings)

  useEffect(() => {
    store.getSettings().then(setSettings)
  }, [])

  const update = async (updates: Partial<Settings>) => {
    const next = { ...settings, ...updates }
    await store.setSettings(next)
    setSettings(next)
  }

  return { settings, update }
}

export function useLinks() {
  const [links, setLinks] = useState<CollectedLink[]>([])

  useEffect(() => {
    store.getLinks().then(setLinks)
  }, [])

  const save = async (l: CollectedLink[]) => {
    await store.setLinks(l)
    setLinks(l)
  }

  const addLink = async (url: string, title: string, tags: string[] = []) => {
    const link: CollectedLink = {
      id: crypto.randomUUID(),
      url,
      title,
      tags,
      date: new Date().toISOString()
    }
    await save([link, ...links])
    return link
  }

  const removeLink = async (id: string) => {
    await save(links.filter((l) => l.id !== id))
  }

  const updateLink = async (id: string, updates: Partial<CollectedLink>) => {
    await save(links.map((l) => (l.id === id ? { ...l, ...updates } : l)))
  }

  const clearLinks = async () => {
    await save([])
  }

  return { links, addLink, removeLink, updateLink, clearLinks }
}
