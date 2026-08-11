import { readFileSync } from "node:fs";

// Derive the server version from the package manifest at runtime so it can
// never drift from package.json. `../package.json` resolves correctly both
// from the source file (packages/mcp/src/version.ts) and from the bundled
// entry (packages/mcp/dist/index.js), since each sits one level below the
// package root.
type PackageManifest = { version: string };

const manifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as PackageManifest;

export const MCP_SERVER_VERSION = manifest.version;
