import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const project = dirname(fileURLToPath(import.meta.url));
const output = resolve(project, "dist/offline");

async function files(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]))).flat();
}

export default defineConfig({
  root: resolve(project, "personal"), base: "./", publicDir: resolve(project, "public"),
  plugins: [react(), {
    name: "paperink-offline-resources",
    async closeBundle() {
      await mkdir(join(output, "pdfjs"), { recursive: true });
      for (const name of ["cmaps", "standard_fonts", "wasm"]) await cp(resolve(project, `node_modules/pdfjs-dist/${name}`), join(output, "pdfjs", name), { recursive: true });
      const manifest = JSON.parse(await readFile(join(output, "manifest.webmanifest"), "utf8"));
      manifest.id = "./"; manifest.start_url = "./"; manifest.scope = "./";
      manifest.name = "墨读 · 个人离线版";
      manifest.icons = [{ src: "./icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" }, { src: "./icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" }];
      await writeFile(join(output, "manifest.webmanifest"), JSON.stringify(manifest, null, 2));
      await writeFile(join(output, ".nojekyll"), "");
      const paths = (await files(output)).filter(path => !path.endsWith("sw.js") && !path.endsWith(".nojekyll")).sort();
      const digest = createHash("sha256");
      for (const path of paths) { digest.update(relative(output, path)); digest.update(await readFile(path)); }
      const resources = paths.map(path => `./${relative(output, path).replaceAll("\\", "/")}`);
      const template = await readFile(resolve(project, "personal/service-worker.js"), "utf8");
      await writeFile(join(output, "sw.js"), template.replace("__CACHE_VERSION__", digest.digest("hex").slice(0, 20)).replace("__PRECACHE_FILES__", JSON.stringify(resources)));
    },
  }],
  build: { outDir: output, emptyOutDir: true, target: "es2022" },
  server: { host: "127.0.0.1", port: 5174 },
  preview: { host: "127.0.0.1", port: 4174 },
});
