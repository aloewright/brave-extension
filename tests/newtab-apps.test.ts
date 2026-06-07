import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppCard, EditAppModal, QuickLinks } from "../src/newtab";
import { WORKSPACE_APPS } from "../src/newtab-apps";
import { DEFAULT_QUICK_LINKS } from "../src/newtab-quick-links";

describe("new tab workspace apps", () => {
  it("keeps the requested apps in order with https links", () => {
    expect(
      WORKSPACE_APPS.map(({ name, domain, url }) => ({ name, domain, url })),
    ).toEqual([
      {
        name: "Cloudflare",
        domain: "dash.cloudflare.com",
        url: "https://dash.cloudflare.com",
      },
      {
        name: "Google Cloud",
        domain: "console.cloud.google.com",
        url: "https://console.cloud.google.com",
      },
      {
        name: "App Store Connect",
        domain: "appstoreconnect.apple.com",
        url: "https://appstoreconnect.apple.com",
      },
      { name: "GitHub", domain: "github.com", url: "https://github.com" },
      {
        name: "Linear",
        domain: "linear.app",
        url: "https://linear.app/aloey",
      },
      {
        name: "Blog Editor",
        domain: "dev.aloewright.com",
        url: "https://dev.aloewright.com",
      },
      { name: "Blog", domain: "aloewright.com", url: "https://aloewright.com" },
      {
        name: "Book Editor",
        domain: "book-cook.com",
        url: "https://book-cook.com",
      },
      {
        name: "Design System Generator",
        domain: "so.makethe.app",
        url: "https://so.makethe.app",
      },
      { name: "Directory", domain: "makethe.app", url: "https://makethe.app" },
      {
        name: "Video Manager",
        domain: "spooool.com",
        url: "https://spooool.com",
      },
    ]);
  });

  it("registers the workspace as Chrome's new tab page", () => {
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    );

    expect(packageJson.manifest.chrome_url_overrides).toEqual({
      newtab: "newtab.html",
    });
  });

  it("does not use the old product title", () => {
    const source = readFileSync(join(process.cwd(), "src/newtab.tsx"), "utf8");

    expect(source).not.toContain("Aloewright Apps");
  });

  it("renders app cards without subtitle labels", () => {
    const source = readFileSync(join(process.cwd(), "src/newtab.tsx"), "utf8");

    expect(source).not.toContain("companyNameForDomain(app.domain)");
    expect(source).not.toContain("{app.domain}</span>");
    expect(source).not.toContain("workspace-app-card__domain");
  });

  it("lets workspace link cards be removed and keeps removals persisted", () => {
    const source = readFileSync(join(process.cwd(), "src/newtab.tsx"), "utf8");
    const styles = readFileSync(join(process.cwd(), "src/style.css"), "utf8");

    expect(source).toContain(
      'const HIDDEN_APPS_STORAGE_KEY = "newtab.hiddenApps"',
    );
    expect(source).toContain("const WORKSPACE_APP_STORAGE_KEYS = [");
    expect(source).toContain(
      "[...WORKSPACE_APP_STORAGE_KEYS, QUICK_LINKS_STORAGE_KEY]",
    );
    expect(source).toContain("const removeApp = (app: WorkspaceApp) =>");
    expect(source).toContain("aria-label={`Remove ${app.name}`}");
    expect(source).toContain("existingCustoms.filter");
    expect(source).toContain(
      "Array.from(new Set([...existingHidden, app.url]))",
    );
    expect(styles).toContain(".workspace-app-card__actions");
    expect(styles).toContain(
      ".workspace-app-card:hover .workspace-app-card__actions",
    );
  });

  it("uses app icons instead of monogram initials", () => {
    const source = readFileSync(join(process.cwd(), "src/newtab.tsx"), "utf8");

    expect(source).toContain("<AppIcon name={app.icon} />");
    expect(source).not.toContain("app.initials");
    expect(WORKSPACE_APPS.map(({ icon }) => icon)).toEqual([
      "cloud",
      "cloud",
      "app-store",
      "github",
      "linear",
      "pencil",
      "article",
      "book",
      "palette",
      "directory",
      "video",
    ]);
  });

  it("adds GitHub quick links for pull requests, repositories, and feed", () => {
    const github = WORKSPACE_APPS.find((app) => app.name === "GitHub");

    expect(github?.quickLinks).toEqual([
      { label: "Pull Requests", url: "https://github.com/pulls" },
      {
        label: "Repositories",
        url: "https://github.com/aloewright?tab=repositories",
      },
      { label: "Feed", url: "https://github.com/dashboard-feed" },
    ]);

    if (!github) throw new Error("GitHub app missing");
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(
      createElement(AppCard, {
        app: github,
        drag: {
          index: 0,
          isDragging: false,
          isDropTarget: false,
          onDragStart: () => {},
          onDragOver: () => {},
          onDragLeave: () => {},
          onDragEnd: () => {},
          onDrop: () => {},
        },
        onEdit: () => {},
        onRemove: () => {},
      }),
    );

    const mainLink = container.querySelector<HTMLAnchorElement>(
      ".workspace-app-card__link",
    );
    const quickLinkNav = container.querySelector(
      ".workspace-app-card__quick-links",
    );
    const quickLinks = Array.from(
      container.querySelectorAll<HTMLAnchorElement>(
        ".workspace-app-card__quick-link",
      ),
    );

    expect(mainLink?.getAttribute("aria-label")).toBe("GitHub");
    expect(mainLink?.tagName).toBe("A");
    expect(mainLink?.className).toContain("workspace-app-card__main");
    expect(mainLink?.querySelector(".workspace-app-card__mark")).toBeTruthy();
    expect(quickLinkNav?.getAttribute("aria-label")).toBe("GitHub quick links");
    expect(
      quickLinks.map((link) => ({
        label: link.textContent,
        url: link.getAttribute("href"),
      })),
    ).toEqual([
      { label: "Pull Requests", url: "https://github.com/pulls" },
      {
        label: "Repositories",
        url: "https://github.com/aloewright?tab=repositories",
      },
      { label: "Feed", url: "https://github.com/dashboard-feed" },
    ]);
  });

  it("lets users change card icons from the edit modal", () => {
    const source = readFileSync(join(process.cwd(), "src/newtab.tsx"), "utf8");
    const styles = readFileSync(join(process.cwd(), "src/style.css"), "utf8");
    const github = WORKSPACE_APPS.find((app) => app.name === "GitHub");

    expect(source).toContain(
      'const APP_ICON_STORAGE_KEY = "newtab.appIconOverrides"',
    );
    expect(source).toContain("function sanitizeIconOverrides");
    expect(source).toContain("function applyIconOverrides");
    expect(source).toContain("const saveAppEdits =");
    expect(source).toContain("Link name");
    expect(source).toContain("Link URL");
    expect(source).toContain('aria-label="Custom card color"');
    expect(source).toContain("setIcon(choice.icon)");
    expect(source).toContain('aria-label="Icon choices"');
    expect(styles).toContain(".newtab-icon-grid");
    expect(styles).toContain(".newtab-icon-choice");

    if (!github) throw new Error("GitHub app missing");
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(
      createElement(EditAppModal, {
        app: github,
        apps: WORKSPACE_APPS,
        onClose: () => {},
        onSave: () => {},
      }),
    );

    const search = container.querySelector<HTMLInputElement>(
      ".newtab-icon-search input",
    );
    const grid = container.querySelector(".newtab-icon-grid");
    const options = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".newtab-icon-choice"),
    );

    expect(search?.getAttribute("aria-label")).toBe(
      "Search Phosphor, Hero, or Lucide icons",
    );
    expect(grid?.getAttribute("aria-label")).toBe("Icon choices");
    expect(options).toHaveLength(30);
    expect(
      options.map((option) => option.getAttribute("aria-label")),
    ).toContain("Use Lucide Mail icon");
  });

  it("opens the quick links manager modal instead of inline edit controls", async () => {
    ;(globalThis as typeof globalThis & { React: typeof React }).React = React;
    const host = document.createElement("div");
    document.body.append(host);
    let root: Root | null = null;

    await act(async () => {
      root = createRoot(host);
      root.render(
        createElement(QuickLinks, {
          links: DEFAULT_QUICK_LINKS.slice(0, 1),
          onChange: () => {},
        }),
      );
    });

    try {
      expect(host.querySelector(".newtab-quick-link-item__action")).toBeNull();

      const editButton = host.querySelector<HTMLButtonElement>(
        ".newtab-quick-links__toggle",
      );
      expect(editButton).toBeTruthy();

      await act(async () => {
        editButton?.click();
      });

      const dialog = host.querySelector<HTMLElement>('[role="dialog"]');
      expect(dialog).toBeTruthy();
      expect(dialog?.textContent).toContain("Edit links");
      expect(dialog?.textContent).toContain("Add quick link");
      expect(dialog?.textContent).toContain("Edit");
      expect(dialog?.textContent).toContain("Remove");

      const closeButton = host.querySelector<HTMLButtonElement>(
        '[aria-label="Close edit links modal"]',
      );
      expect(closeButton).toBeTruthy();

      await act(async () => {
        closeButton?.click();
      });

      expect(host.querySelector('[role="dialog"]')).toBeNull();
    } finally {
      act(() => root?.unmount());
      host.remove();
    }
  });

  it("keeps the new tab layout grouped for search, cards, tabs, and history", () => {
    const source = readFileSync(join(process.cwd(), "src/newtab.tsx"), "utf8");
    const styles = readFileSync(join(process.cwd(), "src/style.css"), "utf8");
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    );

    expect(source).toContain("https://search.brave.com/search");
    expect(source).toContain("chrome.tabs.query");
    expect(source).toContain("chrome.history.search");
    expect(source).toContain("tab.autoDiscardable === false");
    expect(source).toContain(
      "chrome.tabs.update(item.tabId, { autoDiscardable: !keepActive })",
    );
    expect(source).toContain("aria-pressed={item.keepActive}");
    expect(source).toContain("Keep ${item.title} active");
    expect(source).toContain("Allow ${item.title} to sleep");
    expect(source).toContain("onToggleKeepActive={toggleKeepActive}");
    expect(source).toContain("maxResults: 0");
    expect(source).not.toContain("chrome.bookmarks.getRecent");
    expect(source).toContain('title="Open Tabs"');
    expect(source).toContain('title="History"');
    expect(source).toContain("newtab-panel--scroll");
    expect(styles).toContain(".newtab-panel--scroll .newtab-shortcut-list");
    expect(styles).toContain("overflow-y: auto;");
    expect(packageJson.manifest.permissions).toContain("history");
    expect(styles).toContain(".newtab-app-grid--top");
    expect(styles).toContain(
      "grid-template-columns: repeat(3, minmax(0, 1fr));",
    );
    expect(styles).toContain(".newtab-app-grid--focus");
    expect(styles).toContain(
      "grid-template-columns: repeat(4, minmax(0, 1fr));",
    );
    expect(styles).toContain(".newtab-app-grid--compact");
    expect(styles).toContain(
      "grid-template-columns: repeat(5, minmax(0, 1fr));",
    );
    expect(styles).toContain(".newtab-panels");
    expect(styles).toContain(
      "grid-template-columns: repeat(2, minmax(0, 1fr));",
    );
    expect(styles).toContain(
      ".newtab-shortcut-row--kept-active .newtab-shortcut",
    );
    expect(styles).toContain('.newtab-shortcut__action[aria-pressed="true"]');
  });
});
