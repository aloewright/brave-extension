import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EditQuickLinkModal, QuickLinks } from "../src/newtab";
import {
  DEFAULT_QUICK_LINKS,
  QUICK_LINKS_STORAGE_KEY,
  sanitizeQuickLinks,
} from "../src/newtab-quick-links";

describe("new tab quick links", () => {
  it("keeps default quick links with https urls and icon slugs", () => {
    expect(DEFAULT_QUICK_LINKS.map(({ label, url, icon }) => ({ label, url, icon }))).toEqual([
      { label: "Chat", url: "https://alex.chat", icon: "phosphor:chat-circle" },
      { label: "Email", url: "https://mail.fly.pm", icon: "mail" },
      { label: "Calendar", url: "https://cal.fly.pm", icon: "calendar" },
      { label: "Tasks", url: "https://alex.coffee", icon: "linear" },
      { label: "Link Shortener", url: "https://fly.pm", icon: "link" },
    ]);
  });

  it("sanitizes stored quick links and falls back to defaults when unset", () => {
    expect(sanitizeQuickLinks(undefined)).toEqual(DEFAULT_QUICK_LINKS);
    expect(sanitizeQuickLinks([{ id: "x", label: "Docs", url: "https://docs.example.com", icon: "article" }])).toEqual([
      { id: "x", label: "Docs", url: "https://docs.example.com", icon: "article" },
    ]);
    expect(sanitizeQuickLinks([])).toEqual([]);
    expect(
      sanitizeQuickLinks([
        { id: "bad", label: "Missing scheme", url: "example.com", icon: "link" },
        { id: "ok", label: "OK", url: "https://ok.example.com", icon: "not-an-icon" },
      ]),
    ).toEqual([{ id: "ok", label: "OK", url: "https://ok.example.com", icon: "link" }]);
  });

  it("persists quick links in chrome.storage.local", () => {
    const source = readFileSync(join(process.cwd(), "src/newtab.tsx"), "utf8");

    expect(source).toContain("QUICK_LINKS_STORAGE_KEY");
    expect(source).toContain("persistQuickLinks");
    expect(source).toContain("QuickLinksManagerModal");
    expect(source).toContain('aria-haspopup="dialog"');
    expect(source).toContain("newtab-quick-links-modal__list");
  });

  it("renders quick links with a manager modal trigger and no inline edit controls", () => {
    const markup = renderToStaticMarkup(
      createElement(QuickLinks, {
        links: DEFAULT_QUICK_LINKS.slice(0, 2),
        onChange: () => {},
      }),
    );

    expect(markup).toContain('aria-label="Quick links"');
    expect(markup).toContain('aria-label="Chat"');
    expect(markup).toContain('href="https://alex.chat"');
    expect(markup).toContain("Edit links");
    expect(markup).not.toContain("newtab-quick-link-item__action");
  });

  it("renders the quick link edit modal", () => {
    const markup = renderToStaticMarkup(
      createElement(EditQuickLinkModal, {
        link: DEFAULT_QUICK_LINKS[0],
        links: DEFAULT_QUICK_LINKS,
        onClose: () => {},
        onSave: () => {},
      }),
    );

    expect(markup).toContain("Edit quick link");
    expect(markup).toContain("Link name");
    expect(markup).toContain('value="Chat"');
    expect(markup).toContain('value="https://alex.chat"');
  });

  it("exports the quick links storage key for tests and docs", () => {
    expect(QUICK_LINKS_STORAGE_KEY).toBe("newtab.quickLinks");
  });
});
