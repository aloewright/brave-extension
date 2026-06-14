import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const rootDir = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const packageJson = JSON.parse(
  await readFile(resolve(rootDir, "package.json"), "utf8"),
);
const extensionDir = resolve(rootDir, "build");
const archiveName = `${packageJson.name}-${packageJson.version}.zip`;
const archivePath = resolve(rootDir, "dist", archiveName);

async function collectFiles(dir, entries = {}) {
  const children = await readdir(dir, { withFileTypes: true });
  for (const child of children) {
    const absolutePath = join(dir, child.name);
    if (child.isDirectory()) {
      await collectFiles(absolutePath, entries);
      continue;
    }
    if (!child.isFile()) continue;
    const archivePath = relative(extensionDir, absolutePath).replaceAll("\\", "/");
    entries[archivePath] = new Uint8Array(await readFile(absolutePath));
  }
  return entries;
}

const entries = await collectFiles(extensionDir);
await mkdir(dirname(archivePath), { recursive: true });
await writeFile(archivePath, zipSync(entries, { level: 9 }));

console.log(`Packaged ${Object.keys(entries).length} files -> ${archivePath}`);
