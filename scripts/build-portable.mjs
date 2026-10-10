import { build } from "vite";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { Script } from "node:vm";
import { embedAssets } from "./embed-assets.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
await embedAssets();
await build({ root, configFile: resolve(root, "vite.portable.config.ts") });
const [template, javascript, css, icon] = await Promise.all([
  readFile(resolve(root, "portable/index.html"), "utf8"),
  readFile(resolve(root, "dist/app.js"), "utf8"),
  readFile(resolve(root, "dist/app.css"), "utf8"),
  readFile(resolve(root, "public/favicon.png")),
]);
// A classic script must parse without any top-level module imports.
new Script(javascript, { filename: "makeslice-standalone.js" });
if (/<\/style/i.test(css)) throw new Error("Unexpected style closing tag.");
const html = template
  .replace("<!-- FAVICON -->", () => `<link rel="icon" type="image/png" href="data:image/png;base64,${icon.toString("base64")}" />`)
  .replace("<!-- STYLES -->", () => `<style>${css}</style>`)
  .replace("<!-- SCRIPT -->", () => `<script>${javascript.replace(/<\/script/gi, "<\\/script")}</script>`);
const output = resolve(root, "dist/index.html");
await writeFile(output, html);
console.log(`Built standalone page: ${output}`);
