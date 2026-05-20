import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  getAll,
  getGroups,
  getLinks,
  getProfiles,
  getSettings,
  setProfiles,
} from "../src/sections/_lx/storage";
import type { CollectedLink, Group, Profile } from "../src/sections/_lx/types";

describe("_lx storage compatibility", () => {
  it("reads native chrome.storage objects without JSON parsing them", async () => {
    const profiles: Profile[] = [
      { id: "p1", name: "Work", extensionIds: ["a"] },
    ];
    const groups: Group[] = [
      { id: "g1", name: "Focus", extensionIds: ["b"], enabled: true },
    ];
    const links: CollectedLink[] = [
      {
        id: "l1",
        url: "https://example.com",
        title: "Example",
        tags: [],
        date: "2026-05-16T00:00:00.000Z",
      },
    ];

    await chrome.storage.local.set({
      lx_profiles: profiles,
      lx_groups: groups,
      lx_collectedLinks: links,
      lx_settings: { notebookMode: "new", alwaysEnabled: ["a"] },
      lx_extensionLastUsed: { a: "2026-05-16T00:00:00.000Z" },
    });

    expect(await getProfiles()).toEqual(profiles);
    expect(await getGroups()).toEqual(groups);
    expect(await getLinks()).toEqual(links);
    expect(await getSettings()).toMatchObject({
      notebookMode: "new",
      alwaysEnabled: ["a"],
      leanExtensionIds: [],
    });
    expect(await getAll()).toMatchObject({
      profiles,
      groups,
      collectedLinks: links,
      extensionLastUsed: { a: "2026-05-16T00:00:00.000Z" },
    });
  });

  it("still reads older JSON-string values written by the previous wrapper", async () => {
    const profiles: Profile[] = [
      { id: "p-json", name: "JSON", extensionIds: ["x"] },
    ];

    await chrome.storage.local.set({
      lx_profiles: JSON.stringify(profiles),
    });

    expect(await getProfiles()).toEqual(profiles);
  });

  it("writes native values so the sidepanel bundle no longer includes parseValue", async () => {
    const profiles: Profile[] = [
      { id: "p2", name: "Native", extensionIds: ["z"] },
    ];

    await setProfiles(profiles);
    const got = await chrome.storage.local.get("lx_profiles");

    expect(got.lx_profiles).toEqual(profiles);

    const source = readFileSync(
      join(process.cwd(), "src/sections/_lx/storage.ts"),
      "utf8",
    );
    expect(source).not.toContain("@plasmohq/storage");
    expect(source).not.toContain("new Storage");
  });
});
