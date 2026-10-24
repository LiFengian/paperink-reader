// Run after build:offline when updating an existing static site.
import { readFile, readdir, copyFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const target = resolve("dist/offline"), sources = process.argv.slice(2);
if (!sources.length) throw Error("Usage: node scripts/retain-offline-assets.mjs <previous-offline-directory> [...]");
if (!(await readFile(join(target, "manifest.webmanifest"), "utf8")).includes("墨读")) throw Error("The destination is not a PaperInk offline build");
let retained = 0;
for (const source of sources) {
  const directory = resolve(source);
  if (!(await readFile(join(directory, "manifest.webmanifest"), "utf8")).includes("墨读")) throw Error("The source is not a PaperInk offline build");
  for (const entry of await readdir(join(directory, "assets"), { withFileTypes: true })) {
    if (!entry.isFile() || !/^.+-[\w-]{8,}\.(?:js|mjs|css|woff2?|ttf)$/.test(entry.name)) continue;
    const from = join(directory, "assets", entry.name), to = join(target, "assets", entry.name);
    let existing;
    try { existing = await readFile(to); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (existing) { if (!existing.equals(await readFile(from))) throw Error("An existing hashed asset has different content: " + entry.name); continue; }
    await copyFile(from, to); retained++;
  }
}
console.log(JSON.stringify({ retainedAssets: retained, destination: target }));
