import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SECTIONS, type SectionId } from "../src/sections/types";
import { SIGNAL_NATIVE_TYPES } from "../src/lib/signal-types";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Signal sidebar tab wiring", () => {
  it("registers Signal as a rail section with an existing Leo icon", () => {
    const ids = SECTIONS.map((section) => section.id);
    const railSource = source("src/components/SidebarRail.tsx");

    expect(ids).toContain<SectionId>("signal");
    expect(SECTIONS.find((section) => section.id === "signal")?.label).toBe(
      "Signal",
    );
    expect(railSource).toContain('signal: "radio-checked"');
  });

  it("renders SignalSection from the sidepanel", () => {
    const sidepanelSource = source("src/sidepanel.tsx");

    expect(sidepanelSource).toContain(
      'import { SignalSection } from "./sections/signal/SignalSection"',
    );
    expect(sidepanelSource).toContain(
      'active === "signal" && <SignalSection />',
    );
    expect(sidepanelSource).not.toContain('section === "signal"');
  });
});

describe("Signal section UI contract", () => {
  it("speaks the typed signal native-host protocol", () => {
    const signalSource = source("src/sections/signal/SignalSection.tsx");
    const typesSource = source("src/lib/signal-types.ts");

    expect(SIGNAL_NATIVE_TYPES).toEqual([
      "signal.status",
      "signal.link.start",
      "signal.link.finish",
      "signal.conversations.list",
      "signal.messages.list",
      "signal.message.send",
      "signal.message.received",
      "signal.attachments.get",
      "signal.lock",
      "signal.unlink",
    ]);

    for (const type of SIGNAL_NATIVE_TYPES) {
      expect(typesSource).toContain(`"${type}"`);
    }
    for (const requestType of [
      "signal.status",
      "signal.link.start",
      "signal.link.finish",
      "signal.conversations.list",
      "signal.messages.list",
      "signal.message.send",
      "signal.attachments.get",
      "signal.lock",
      "signal.unlink",
    ]) {
      expect(signalSource).toContain(`type: "${requestType}"`);
    }
    expect(signalSource).toContain('case "signal.message.received"');
  });

  it("keeps Signal message content out of extension storage", () => {
    const signalSource = source("src/sections/signal/SignalSection.tsx");
    const typesSource = source("src/lib/signal-types.ts");

    for (const src of [signalSource, typesSource]) {
      expect(src).not.toContain("chrome.storage.local");
      expect(src).not.toContain("ExtensionStorage");
      expect(src).not.toContain("localStorage");
      expect(src).not.toContain("ai-dev-signal");
    }
  });

  it("shows the expected conservative surfaces and security copy", () => {
    const signalSource = source("src/sections/signal/SignalSection.tsx");

    expect(signalSource).toContain('data-testid="signal-section"');
    expect(signalSource).toContain('data-testid="signal-status"');
    expect(signalSource).toContain('data-testid="signal-conversation-list"');
    expect(signalSource).toContain('data-testid="signal-message-list"');
    expect(signalSource).toContain('data-testid="signal-composer"');
    expect(signalSource).toContain("Local linked-device bridge");
    expect(signalSource).toContain("encrypted container profile");
    expect(signalSource).toContain("content scripts");
    expect(signalSource).toContain("QR placeholder");
    expect(signalSource).toContain("Historical messages may not be available");
  });
});
