import type {
  CollectedLink,
  Group,
  Profile,
  Settings,
  StorageSchema,
} from "./types";
import { DEFAULT_STORAGE } from "./types";

const KEYS = {
  profiles: "lx_profiles",
  groups: "lx_groups",
  collectedLinks: "lx_collectedLinks",
  settings: "lx_settings",
  extensionLastUsed: "lx_extensionLastUsed",
} as const;

function parseStoredValue<T>(value: unknown): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return value as T;

  try {
    return JSON.parse(value) as T;
  } catch {
    return value as T;
  }
}

const storage = {
  async get<T>(key: string): Promise<T | undefined> {
    const got = await chrome.storage.local.get(key);
    return parseStoredValue<T>(got[key]);
  },

  async set<T>(key: string, value: T): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
  },
};

function normalizeSettings(settings?: Partial<Settings>): Settings {
  return {
    ...DEFAULT_STORAGE.settings,
    ...settings,
    alwaysEnabled: settings?.alwaysEnabled ?? [],
    leanExtensionIds: settings?.leanExtensionIds ?? [],
  };
}

export async function getAll(): Promise<StorageSchema> {
  const profiles =
    (await storage.get<Profile[]>(KEYS.profiles)) ?? DEFAULT_STORAGE.profiles;
  const groups =
    (await storage.get<Group[]>(KEYS.groups)) ?? DEFAULT_STORAGE.groups;
  const collectedLinks =
    (await storage.get<CollectedLink[]>(KEYS.collectedLinks)) ??
    DEFAULT_STORAGE.collectedLinks;
  const settings = normalizeSettings(
    await storage.get<Settings>(KEYS.settings),
  );
  const extensionLastUsed =
    (await storage.get<Record<string, string>>(KEYS.extensionLastUsed)) ??
    DEFAULT_STORAGE.extensionLastUsed;
  return { profiles, groups, collectedLinks, settings, extensionLastUsed };
}

export async function getSettings(): Promise<Settings> {
  return normalizeSettings(await storage.get<Settings>(KEYS.settings));
}

export async function setSettings(settings: Settings): Promise<void> {
  await storage.set(KEYS.settings, normalizeSettings(settings));
}

export async function getProfiles(): Promise<Profile[]> {
  return (await storage.get<Profile[]>(KEYS.profiles)) ?? [];
}

export async function setProfiles(profiles: Profile[]): Promise<void> {
  await storage.set(KEYS.profiles, profiles);
}

export async function getGroups(): Promise<Group[]> {
  return (await storage.get<Group[]>(KEYS.groups)) ?? [];
}

export async function setGroups(groups: Group[]): Promise<void> {
  await storage.set(KEYS.groups, groups);
}

export async function getLinks(): Promise<CollectedLink[]> {
  return (await storage.get<CollectedLink[]>(KEYS.collectedLinks)) ?? [];
}

export async function setLinks(links: CollectedLink[]): Promise<void> {
  await storage.set(KEYS.collectedLinks, links);
}

export async function getLastUsed(): Promise<Record<string, string>> {
  return (
    (await storage.get<Record<string, string>>(KEYS.extensionLastUsed)) ?? {}
  );
}

export async function setLastUsed(data: Record<string, string>): Promise<void> {
  await storage.set(KEYS.extensionLastUsed, data);
}

export async function touchExtension(extId: string): Promise<void> {
  const data = await getLastUsed();
  data[extId] = new Date().toISOString();
  await setLastUsed(data);
}

export { storage, KEYS };
