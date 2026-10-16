// Builds the public site into ./public with only the files the browser needs: the root *.html pages
// and the css/, js/, assets/ and img/ folders. Everything else in the repository (docs, SQL, Edge
// Function sources, tests, scripts, data files, editor/tool config) is never served (incident D1).
// Fails the build if anything other than a web asset would be published.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const root = process.cwd();
const out = join(root, "public");
const FOLDERS = ["css", "js", "assets", "img"];
const ALLOWED = new Set([".html", ".css", ".js", ".mjs", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico", ".woff", ".woff2", ".ttf", ".otf"]);

rmSync(out, { recursive: true, force: true });
mkdirSync(out);
for (const name of readdirSync(root)) {
  if (name.endsWith(".html") && statSync(join(root, name)).isFile()) cpSync(join(root, name), join(out, name));
}
for (const folder of FOLDERS) {
  if (existsSync(join(root, folder))) cpSync(join(root, folder), join(out, folder), { recursive: true });
}

const files = [];
const walk = (dir) => { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) walk(p); else files.push(p); } };
walk(out);
const rejected = files.filter((p) => !ALLOWED.has(extname(p).toLowerCase()) || /(^|[\\/])\./.test(relative(out, p)));
if (rejected.length) {
  console.error(`build-public: refusing to publish non-web files:\n${rejected.map((p) => `  ${relative(out, p)}`).join("\n")}`);
  process.exit(1);
}
if (!files.some((p) => relative(out, p) === "index.html")) { console.error("build-public: index.html missing"); process.exit(1); }
console.log(`build-public: ${files.length} files published to public/`);
