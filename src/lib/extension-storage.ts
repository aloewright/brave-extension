type ChromeStorageArea = Pick<chrome.storage.StorageArea, "get" | "set" | "remove">;

const memoryStore = new Map<string, unknown>();

function cloneValue<T>(value: T): T {
  if (value === undefined) return value;
  return structuredClone(value);
}

function getChromeStorageArea(): ChromeStorageArea | null {
  const maybeChrome = (globalThis as { chrome?: { storage?: { local?: ChromeStorageArea } } }).chrome;
  return maybeChrome?.storage?.local ?? null;
}

export class ExtensionStorage {
  async get<T>(key: string): Promise<T | undefined> {
    const area = getChromeStorageArea();
    if (area) {
      const result = await area.get(key);
      return result[key] as T | undefined;
    }
    return cloneValue(memoryStore.get(key)) as T | undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    const area = getChromeStorageArea();
    if (area) {
      await area.set({ [key]: value });
      return;
    }
    memoryStore.set(key, cloneValue(value));
  }

  async remove(key: string): Promise<void> {
    const area = getChromeStorageArea();
    if (area) {
      await area.remove(key);
      return;
    }
    memoryStore.delete(key);
  }
}

