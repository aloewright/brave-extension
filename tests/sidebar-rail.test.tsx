import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { SECTIONS, type SectionId } from "../src/sections/types";

// ALO-471 — sidebar rail layout + section composition.
//
// The codebase avoids @testing-library/react and tests components via
// logical assertions on the same primitives the component consumes. The
// rail's three contracts that ALO-471 introduces are:
//
//   1. Tech is folded into Inspector instead of consuming rail space.
//   2. Session replaces Library as the snippets/links/feeds surface.
//   3. The bottom quick-action group covers capture/scrape/PiP/link/sidebar-window actions.
//
// We verify (1) and (2) via SECTIONS, and (3) via the lib that backs the
// rail's bottom group.

describe("SECTIONS reflects the current rail organization", () => {
  it("keeps Tech out of the rail because it lives inside Inspector", () => {
    const ids = SECTIONS.map((s) => s.id);
    expect(ids as string[]).not.toContain("tech");
    expect(ids).toContain<SectionId>("inspector");
  });

  it("keeps Eyedropper inside Inspector instead of the rail", () => {
    const ids = SECTIONS.map((s) => s.id);
    const inspectorSource = readFileSync(
      join(process.cwd(), "src/sections/inspector/InspectorSection.tsx"),
      "utf8",
    );
    const sidepanelSource = readFileSync(
      join(process.cwd(), "src/sidepanel.tsx"),
      "utf8",
    );

    expect(ids as string[]).not.toContain("eyedropper");
    expect(inspectorSource).toContain("<EyedropperSection embedded />");
    expect(sidepanelSource).toContain(
      'section === "tech" || section === "eyedropper"',
    );
    expect(sidepanelSource).not.toContain('active === "eyedropper"');
  });

  it("includes Session (renamed from Library, ALO-470)", () => {
    const ids = SECTIONS.map((s) => s.id);
    expect(ids).toContain<SectionId>("session");
    expect(ids as string[]).not.toContain("library");
  });

  it("includes Contact Enrichment as a dedicated Quick Info surface", () => {
    const ids = SECTIONS.map((s) => s.id);
    expect(ids).toContain<SectionId>("quickInfo");
    expect(SECTIONS.find((s) => s.id === "quickInfo")?.label).toBe(
      "Contact Enrichment",
    );
  });

  it("includes Passwords as the go vault launcher surface", () => {
    const ids = SECTIONS.map((s) => s.id);
    const sidepanelSource = readFileSync(
      join(process.cwd(), "src/sidepanel.tsx"),
      "utf8",
    );

    expect(ids).toContain<SectionId>("passwords");
    expect(SECTIONS.find((s) => s.id === "passwords")?.label).toBe(
      "Passwords",
    );
    expect(sidepanelSource).toContain("<PasswordVaultSection />");
    expect(sidepanelSource).not.toContain('section === "passwords"');
  });

  it("uses the lock icon for the Passwords rail entry", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/SidebarRail.tsx"),
      "utf8",
    );
    expect(source).toContain('passwords: "lock"');
  });

  it("uses the avatar icon for Contact Enrichment", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/SidebarRail.tsx"),
      "utf8",
    );
    expect(source).toContain('quickInfo: "avatar"');
  });

  it("uses a unique image stack icon for Page Captures", () => {
    const railSource = readFileSync(
      join(process.cwd(), "src/components/SidebarRail.tsx"),
      "utf8",
    );
    const iconSource = readFileSync(
      join(process.cwd(), "src/components/leo.tsx"),
      "utf8",
    );

    expect(railSource).toContain('captures: "image-stack"');
    expect(railSource).toContain('icon: "screenshot"');
    expect(iconSource).toContain('| "image-stack"');
    expect(iconSource).toContain('"image-stack":');
  });

  it("keeps Session near the top-level browsing tools", () => {
    const ids = SECTIONS.map((s) => s.id);
    const sessionIdx = ids.indexOf("session");
    const extensionsIdx = ids.indexOf("extensions");
    expect(sessionIdx).toBeGreaterThan(-1);
    expect(extensionsIdx).toBeGreaterThan(-1);
    expect(Math.abs(sessionIdx - extensionsIdx)).toBeLessThanOrEqual(1);
  });

  it("every section carries a non-empty label", () => {
    for (const s of SECTIONS) {
      expect(s.label.length).toBeGreaterThan(0);
    }
  });
});

describe("Bottom quick-action group composition", () => {
  // The rail imports these handlers and exposes them as buttons in
  // the bottom group. Asserting the module surface keeps the rail's UI
  // honest about what it can do.
  it("exports the quick-action handlers the rail wires up", async () => {
    const mod = await import("../src/lib/quick-actions");
    expect(typeof mod.runScreenshotQuickAction).toBe("function");
    expect(typeof mod.runFullPagePdfQuickAction).toBe("function");
    expect(typeof mod.runScrapeCurrentPageQuickAction).toBe("function");
    expect(typeof mod.runPipQuickAction).toBe("function");
    expect(typeof mod.runSaveLinkQuickAction).toBe("function");
  });

  it("keeps scrape and sidebar-window actions in the bottom rail group", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/SidebarRail.tsx"),
      "utf8",
    );
    expect(source).toContain('label: "Scrape current page"');
    expect(source).toContain('label: "Open resizable sidebar window"');
    expect(source.indexOf('label: "Scrape current page"')).toBeLessThan(
      source.indexOf('label: "Picture-in-picture"'),
    );
  });

  it("renders quick-action loading and result feedback instead of swallowing clicks", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/SidebarRail.tsx"),
      "utf8",
    );

    expect(source).toContain("setRunningAction(def.label)");
    expect(source).toContain("aria-busy={isRunning ? true : undefined}");
    expect(source).toContain("animate-spin");
    expect(source).toContain("setTimeout(() => setFeedback(null), 1400)");
    expect(source).toContain("feedback?.label === def.label");
    expect(source).toContain("data-feedback-kind={currentFeedback?.kind}");
    expect(source).toContain("size={currentFeedback ? 12 : 16}");
    expect(source).toContain("name={iconName}");
    expect(source).toContain("showFeedback(def.label, await def.run())");
    expect(source).not.toContain(
      "quick actions intentionally do not render rail feedback",
    );
  });

  it("keeps bottom rail hover feedback simple and layout-neutral", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/SidebarRail.tsx"),
      "utf8",
    );

    expect(source).toContain("transition-colors duration-150");
    expect(source).toContain("h-8 w-8");
    expect(source).toContain("overflow-hidden");
    expect(source).toContain("active:bg-[rgba(136,192,208,0.22)]");
    expect(source).toContain("disabled:cursor-wait");
    expect(source).not.toContain("left-full");
    expect(source).not.toContain("hover:-translate-y");
    expect(source).not.toContain("hover:scale");
    expect(source).not.toContain("active:scale");
    expect(source).not.toContain('data-testid="sidebar-rail-toast"');
  });

  it("keeps the rail visually flush with adjacent extension surfaces", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/SidebarRail.tsx"),
      "utf8",
    );

    expect(source).toContain('data-testid="sidebar-rail"');
    expect(source).not.toContain("border-r border-border");
  });

  it("hides internal extension scrollbars without disabling scrolling", () => {
    const styles = readFileSync(join(process.cwd(), "src/style.css"), "utf8");

    expect(styles).toContain(".app-shell,\n.app-shell *");
    expect(styles).toContain("scrollbar-width: none;");
    expect(styles).toContain(".app-shell *::-webkit-scrollbar");
    expect(styles).toContain("display: none;");
  });

  it("exposes a resizable sidebar window action", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/SidebarRail.tsx"),
      "utf8",
    );

    expect(source).toContain("openResizableSidebarWindow");
    expect(source).toContain('label: "Open resizable sidebar window"');
    expect(source).toContain('icon: "file-export"');
  });

  it("persists custom rail ordering from drag and drop", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/SidebarRail.tsx"),
      "utf8",
    );

    expect(source).toContain("draggable");
    expect(source).toContain("onDragStart");
    expect(source).toContain("onDrop");
    expect(source).toContain("moveRailSection(sectionOrder");
    expect(source).toContain("setSettings({ railSectionOrder: nextOrder })");
    expect(source).toContain("data-drop-target");
  });
});
