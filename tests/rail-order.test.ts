import { describe, expect, it } from "vitest";
import {
  moveRailSection,
  normalizeRailSectionOrder,
} from "../src/lib/rail-order";
import { SECTIONS, type SectionId } from "../src/sections/types";

describe("rail order helpers", () => {
  it("returns the default section order when no preference is stored", () => {
    expect(normalizeRailSectionOrder(undefined)).toEqual(
      SECTIONS.map((section) => section.id),
    );
  });

  it("dedupes stored ids, drops stale ids, and appends new sections", () => {
    const order = normalizeRailSectionOrder([
      "lexicon",
      "missing-section",
      "terminal",
      "lexicon",
    ]);

    expect(order.slice(0, 2)).toEqual<SectionId[]>(["lexicon", "terminal"]);
    expect(order).not.toContain("missing-section");
    expect(order).toHaveLength(SECTIONS.length);
    expect(new Set(order)).toHaveLength(SECTIONS.length);
  });

  it("moves a dragged section before the drop target", () => {
    const initial = normalizeRailSectionOrder(undefined);
    const next = moveRailSection(initial, "lexicon", "terminal");

    expect(next[0]).toBe("lexicon");
    expect(next[1]).toBe("terminal");
    expect(new Set(next)).toHaveLength(SECTIONS.length);
  });

  it("leaves the order unchanged for a missing target", () => {
    const initial = normalizeRailSectionOrder(undefined);
    const next = moveRailSection(
      initial,
      "lexicon",
      "missing-section" as SectionId,
    );

    expect(next).toEqual(initial);
  });
});
