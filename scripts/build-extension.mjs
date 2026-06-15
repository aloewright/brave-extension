import { watch } from "node:fs";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, defineConfig } from "vite";

const rootDir = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const outDir = resolve(rootDir, "build");
const watchMode = process.argv.includes("--watch");
const packageJson = JSON.parse(
  await readFile(resolve(rootDir, "package.json"), "utf8"),
);

const contentScripts = [
  {
    name: "github",
    input: "src/contents/github.ts",
    matches: ["https://github.com/*"],
    run_at: "document_idle",
    all_frames: false,
  },
  {
    name: "go-vault-session",
    input: "src/contents/go-vault-session.ts",
    matches: ["https://go.lazee.workers.dev/*"],
    run_at: "document_idle",
    all_frames: false,
  },
  {
    name: "page-studio",
    input: "src/contents/page-studio.ts",
    matches: ["<all_urls>"],
    run_at: "document_idle",
    all_frames: false,
  },
  {
    name: "inspector",
    input: "src/contents/inspector.ts",
    matches: ["<all_urls>"],
    run_at: "document_idle",
    all_frames: false,
  },
  {
    name: "page-errors",
    input: "src/contents/page-errors.ts",
    matches: ["<all_urls>"],
    run_at: "document_start",
  },
  {
    name: "picker",
    input: "src/contents/picker.ts",
    matches: ["<all_urls>"],
    run_at: "document_idle",
    all_frames: false,
  },
  {
    name: "mail-2fa-autofill",
    input: "src/contents/mail-2fa-autofill.ts",
    matches: ["http://*/*", "https://*/*"],
    run_at: "document_idle",
    all_frames: false,
  },
  {
    name: "save-tabs-hotkey",
    input: "src/contents/save-tabs-hotkey.ts",
    matches: ["<all_urls>"],
    run_at: "document_start",
  },
  {
    name: "readability-bundle",
    input: "src/contents/readability-bundle.ts",
    matches: ["<all_urls>"],
  },
  {
    name: "pip",
    input: "src/contents/pip.ts",
    matches: ["<all_urls>"],
    run_at: "document_idle",
    all_frames: true,
  },
  {
    name: "scanner",
    input: "src/contents/scanner.ts",
    matches: ["<all_urls>"],
    run_at: "document_idle",
    all_frames: false,
  },
  {
    name: "tech-detector",
    input: "src/contents/tech-detector.ts",
    matches: ["<all_urls>"],
    run_at: "document_idle",
  },
  {
    name: "tts-player",
    input: "src/contents/tts-player.ts",
    matches: ["<all_urls>"],
    run_at: "document_idle",
    all_frames: false,
  },
];

const extensionPages = {
  sidepanel: resolve(rootDir, "sidepanel.html"),
  newtab: resolve(rootDir, "newtab.html"),
  popup: resolve(rootDir, "popup.html"),
  "media-preview": resolve(rootDir, "media-preview.html"),
  "tabs/offscreen": resolve(rootDir, "tabs/offscreen.html"),
  background: resolve(rootDir, "src/background.ts"),
};

function chunkNameForOutput(chunkInfo) {
  if (chunkInfo.name === "background") return "static/background/index.js";
  return "assets/[name].[hash].js";
}

function pageBuildConfig() {
  return defineConfig({
    root: rootDir,
    publicDir: false,
    cacheDir: resolve(rootDir, "node_modules/.vite-extension"),
    oxc: {
      jsx: {
        runtime: "automatic",
      },
    },
    build: {
      outDir,
      emptyOutDir: true,
      manifest: ".vite/manifest.json",
      minify: "oxc",
      target: "chrome120",
      rolldownOptions: {
        input: extensionPages,
        output: {
          entryFileNames: chunkNameForOutput,
          chunkFileNames: "assets/[name].[hash].js",
          assetFileNames: "assets/[name].[hash][extname]",
        },
      },
    },
  });
}

function contentScriptConfig(script) {
  return defineConfig({
    root: rootDir,
    publicDir: false,
    cacheDir: resolve(rootDir, "node_modules/.vite-extension-content"),
    oxc: {
      jsx: {
        runtime: "automatic",
      },
    },
    build: {
      outDir,
      emptyOutDir: false,
      minify: "oxc",
      target: "chrome120",
      cssCodeSplit: false,
      lib: {
        entry: resolve(rootDir, script.input),
        formats: ["iife"],
        name: `__brave_dev_${script.name.replace(/[^a-z0-9]/gi, "_")}`,
        fileName: () => `content/${script.name}.js`,
      },
      rolldownOptions: {
        output: {
          inlineDynamicImports: true,
        },
      },
    },
  });
}

function contentScriptManifest(script) {
  return {
    matches: script.matches,
    js: [`content/${script.name}.js`],
    ...(script.run_at ? { run_at: script.run_at } : {}),
    ...(typeof script.all_frames === "boolean"
      ? { all_frames: script.all_frames }
      : {}),
  };
}

async function copyIcons() {
  await mkdir(outDir, { recursive: true });
  await copyFile(resolve(rootDir, "assets/icon.png"), resolve(outDir, "icon.png"));
}

function iconManifest(path = "icon.png") {
  return {
    16: path,
    32: path,
    48: path,
    64: path,
    128: path,
  };
}

async function writeManifest() {
  const baseManifest = packageJson.manifest ?? {};
  const manifest = {
    manifest_version: 3,
    name: packageJson.displayName ?? packageJson.name,
    version: packageJson.version,
    author: packageJson.author,
    description: packageJson.description,
    icons: iconManifest(),
    action: {
      default_icon: iconManifest(),
      default_popup: "popup.html",
    },
    background: {
      service_worker: "static/background/index.js",
      type: "module",
    },
    side_panel: baseManifest.side_panel,
    chrome_url_overrides: baseManifest.chrome_url_overrides,
    permissions: baseManifest.permissions ?? [],
    host_permissions: baseManifest.host_permissions ?? [],
    commands: baseManifest.commands ?? {},
    content_scripts: contentScripts.map(contentScriptManifest),
  };

  await writeFile(
    resolve(outDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

async function buildExtension() {
  await rm(outDir, { recursive: true, force: true });
  await build(pageBuildConfig());

  for (const script of contentScripts) {
    await build(contentScriptConfig(script));
  }

  await copyIcons();
  await writeManifest();
}

let building = false;
let queued = false;
let debounceTimer = null;

async function runWatchedBuild(reason = "initial build") {
  if (building) {
    queued = true;
    return;
  }

  building = true;
  const startedAt = Date.now();
  try {
    console.log(`[extension-build] ${reason}`);
    await buildExtension();
    console.log(`[extension-build] done in ${Date.now() - startedAt}ms`);
    process.exitCode = 0;
  } catch (error) {
    process.exitCode = 1;
    console.error("[extension-build] failed");
    console.error(error);
  } finally {
    building = false;
    if (queued) {
      queued = false;
      scheduleWatchedBuild("queued change");
    }
  }
}

function scheduleWatchedBuild(reason) {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void runWatchedBuild(reason);
  }, 150);
}

function startWatchMode() {
  const targets = [
    "src",
    "tabs",
    "assets/icon.png",
    "sidepanel.html",
    "newtab.html",
    "popup.html",
    "media-preview.html",
    "package.json",
  ];

  const watchers = targets.map((target) => {
    const absoluteTarget = resolve(rootDir, target);
    const recursive = target === "src" || target === "tabs";
    try {
      return watch(absoluteTarget, { recursive }, (_event, filename) => {
        scheduleWatchedBuild(`changed ${filename || target}`);
      });
    } catch (error) {
      if (!recursive) throw error;
      return watch(absoluteTarget, (_event, filename) => {
        scheduleWatchedBuild(`changed ${filename || target}`);
      });
    }
  });

  const closeWatchers = () => {
    for (const watcher of watchers) watcher.close();
  };
  process.once("SIGINT", () => {
    closeWatchers();
    process.exit(0);
  });
  process.once("SIGTERM", () => {
    closeWatchers();
    process.exit(0);
  });

  console.log("[extension-build] watching src/, tabs/, HTML entrypoints, package.json");
}

if (watchMode) {
  await runWatchedBuild();
  startWatchMode();
} else {
  await buildExtension();
}
