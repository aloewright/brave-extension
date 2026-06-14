import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("InspectorSection tool composition", () => {
  const source = () =>
    readFileSync(
      join(process.cwd(), "src/sections/inspector/InspectorSection.tsx"),
      "utf8",
    );

  it("embeds Eyedropper in the Inspector tab", () => {
    const inspector = source();

    expect(inspector).toContain('from "../eyedropper/EyedropperSection"');
    expect(inspector).toContain("<EyedropperSection embedded />");
  });

  it("keeps reverse image search behind an accordion", () => {
    const inspector = source();

    expect(inspector).toContain("aria-expanded={expanded}");
    expect(inspector).toContain('aria-controls="reverse-image-search-panel"');
    expect(inspector).toContain('id="reverse-image-search-panel"');
    expect(inspector).toContain('status ?? "Collapsed"');
  });

  it("defers page image scanning until the accordion is opened", () => {
    const inspector = source();

    expect(inspector).toContain(
      "const [expanded, setExpanded] = useState(false)",
    );
    expect(inspector).toContain(
      "if (nextExpanded && !hasScannedRef.current) scanPageImages()",
    );
    expect(inspector).not.toContain("scanPageImages()\n    return () =>");
  });
});
