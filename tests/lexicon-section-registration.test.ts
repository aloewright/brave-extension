import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SECTIONS, type SectionId } from "../src/sections/types";

describe("lexicon section registration", () => {
  it("adds Lexicon as the last tool tab before Settings", () => {
    const ids = SECTIONS.map((section) => section.id);

    expect(ids).toContain<SectionId>("lexicon");
    expect(SECTIONS.find((section) => section.id === "lexicon")?.label).toBe(
      "Lexicon",
    );
    expect(ids.indexOf("lexicon")).toBeLessThan(ids.indexOf("settings"));
    expect(ids.indexOf("lexicon")).toBe(ids.indexOf("settings") - 1);
  });

  it("wires the section into the sidepanel and siderail", () => {
    const sidepanelSource = readFileSync(
      join(process.cwd(), "src/sidepanel.tsx"),
      "utf8",
    );
    const railSource = readFileSync(
      join(process.cwd(), "src/components/SidebarRail.tsx"),
      "utf8",
    );
    const iconSource = readFileSync(
      join(process.cwd(), "src/components/leo.tsx"),
      "utf8",
    );

    expect(sidepanelSource).toContain("LexiconSection");
    expect(sidepanelSource).toContain(
      '{active === "lexicon" && <LexiconSection />}',
    );
    expect(railSource).toContain('lexicon: "book-open"');
    expect(iconSource).toContain('| "book-open"');
  });
});
