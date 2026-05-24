import type { WorkspaceApp } from "../newtab-apps";

export const APP_ORDER_STORAGE_KEY = "newtab.appOrder";
export const CUSTOM_APPS_STORAGE_KEY = "newtab.customApps";
export const HIDDEN_APPS_STORAGE_KEY = "newtab.hiddenApps";

export function applyStoredOrder(
  allApps: WorkspaceApp[],
  stored: string[],
): WorkspaceApp[] {
  const remaining = new Map(allApps.map((app) => [app.url, app]));
  const ordered: WorkspaceApp[] = [];
  for (const url of stored) {
    const app = remaining.get(url);
    if (app) {
      ordered.push(app);
      remaining.delete(url);
    }
  }
  for (const app of remaining.values()) ordered.push(app);
  return ordered;
}

export function sanitizeCustomApps(input: unknown): WorkspaceApp[] {
  if (!Array.isArray(input)) return [];
  return input.filter((entry): entry is WorkspaceApp => {
    return (
      !!entry &&
      typeof entry === "object" &&
      typeof (entry as WorkspaceApp).name === "string" &&
      typeof (entry as WorkspaceApp).url === "string" &&
      typeof (entry as WorkspaceApp).domain === "string"
    );
  });
}

export function sanitizeHiddenAppUrls(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return Array.from(
    new Set(
      input.filter((entry): entry is string => typeof entry === "string"),
    ),
  );
}

export function visibleWorkspaceApps(
  defaultApps: WorkspaceApp[],
  customApps: WorkspaceApp[],
  hiddenUrls: string[],
): WorkspaceApp[] {
  const hidden = new Set(hiddenUrls);
  return [...defaultApps.filter((app) => !hidden.has(app.url)), ...customApps];
}
