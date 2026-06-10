import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const pluginRoot = join(root, "..");
const dist = join(pluginRoot, "dist");

await mkdir(dist, { recursive: true });
await Promise.all([
  copyFile(join(pluginRoot, "manifest.json"), join(dist, "manifest.json")),
  copyFile(join(pluginRoot, "styles.css"), join(dist, "styles.css"))
]);
