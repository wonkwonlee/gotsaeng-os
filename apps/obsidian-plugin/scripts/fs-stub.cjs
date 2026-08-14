// Build-time stand-in for `node:fs`, aliased in by tsup.config.ts so that
// `fs` never resolves to the real module inside this bundle. gray-matter's
// `index.js` does `const fs = require('fs')` unconditionally at module load,
// but only calls it (`fs.readFileSync`) from `matter.read(filePath)` — the
// file-path overload of its API. This plugin only ever calls `matter(raw)`
// with an already-read string (packages/core/src/parser.ts), so that path is
// unreachable; if it were ever reached, throwing here is more honest than a
// silent no-op.
//
// This is what makes "no node:fs import remains reachable from
// apps/obsidian-plugin/dist/main.js" true for real, rather than only true of
// this plugin's own source: every direct node:fs call in this codebase
// already goes through FileSystemAdapter (see obsidian-file-system.ts), and
// this closes the one remaining transitive-dependency exception.
module.exports = new Proxy(
  {},
  {
    get(_target, property) {
      return () => {
        throw new Error(
          `node:fs is stubbed out of the GotSaeng OS Obsidian plugin bundle; ` +
            `"${String(property)}" is unavailable. All storage access must go ` +
            `through FileSystemAdapter (see obsidian-file-system.ts).`,
        );
      };
    },
  },
);
