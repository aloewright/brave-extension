import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readProjectFile = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");

describe("custom extension build path", () => {
  it("uses the custom Rolldown-Vite builder as the default build", () => {
    const pkg = JSON.parse(readProjectFile("package.json")) as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      pnpm?: { overrides?: Record<string, string> };
    };

    expect(pkg.scripts?.build).toBe("node scripts/build-extension.mjs");
    expect(pkg.scripts?.["build:extension"]).toBe(
      "node scripts/build-extension.mjs",
    );
    expect(pkg.scripts?.dev).toBe("node scripts/build-extension.mjs --watch");
    expect(pkg.scripts?.package).toBe(
      "node scripts/build-extension.mjs && node scripts/package-extension.mjs",
    );
    expect(pkg.scripts ?? {}).not.toHaveProperty("build:plasmo");
    expect(pkg.devDependencies?.vite).toBe("npm:rolldown-vite@7.3.1");
    expect(pkg.dependencies ?? {}).not.toHaveProperty("@plasmohq/storage");
    expect(pkg.devDependencies ?? {}).not.toHaveProperty("plasmo");
    expect(pkg.devDependencies ?? {}).not.toHaveProperty(
      "@plasmohq/prettier-plugin-sort-imports",
    );
    expect(pkg.pnpm?.overrides ?? {}).not.toHaveProperty("esbuild");
    expect(pkg.pnpm?.overrides ?? {}).not.toHaveProperty("vite");
  });

  it("builds content scripts as classic IIFEs and emits a module worker", () => {
    const script = readProjectFile("scripts/build-extension.mjs");

    expect(script).toContain('minify: "oxc"');
    expect(script).toContain('const outDir = resolve(rootDir, "build")');
    expect(script).toContain('formats: ["iife"]');
    expect(script).toContain("inlineDynamicImports: true");
    expect(script).toContain("`content/${script.name}.js`");
    expect(script).toContain('service_worker: "static/background/index.js"');
    expect(script).toContain('type: "module"');
  });

  it("uses explicit HTML entrypoints instead of framework-generated pages", () => {
    for (const path of [
      "sidepanel.html",
      "newtab.html",
      "popup.html",
      "media-preview.html",
      "tabs/offscreen.html",
    ]) {
      expect(readProjectFile(path)).toContain('script type="module"');
    }
  });

  it("keeps the readability injection path stable for the custom build", () => {
    expect(readProjectFile("src/lib/clip-extractors.ts")).toContain(
      'READABILITY_BUNDLE_PATH = "content/readability-bundle.js"',
    );
  });
});
