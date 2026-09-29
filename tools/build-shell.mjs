/* =====================================================================
   The shell for the native app: the part of docs/ that goes inside the APK.

   The web app is one page and a few megabytes of map library, style, fonts
   and icons, sitting beside half a gigabyte of road, place, address and
   map packs in a quarter of a million files. Only the first part belongs in
   the APK. The packs stay on the site, fetched and stored by the app itself
   the way they always have been, and are the business of later steps -
   Play asset packs, a host of their own - not of this one.

   Which files are the shell is already written down, in the one place that
   has to be right about it: the service worker's SHELL list, which is what
   a phone with no signal is able to start from. It is read from docs/sw.js
   rather than copied here, so a file added to the shell for the web is in
   the APK too, and one missing from the APK is missing from the offline web
   app as well - which is where it would be noticed.

   Run: node tools/build-shell.mjs   (then npx cap sync android)
   ===================================================================== */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const DOCS = path.join(ROOT, "docs");
const OUT = path.join(ROOT, "native", "www");

/* The two array literals, MAP and SHELL, evaluated as the plain lists of
   strings they are. SHELL is MAP's entries plus its own. */
const sw = fs.readFileSync(path.join(DOCS, "sw.js"), "utf8");
const list = (name) => {
  const m = sw.match(new RegExp("const " + name + " = (\\[[\\s\\S]*?\\])"));
  if (!m) throw new Error("no " + name + " list in sw.js");
  return JSON.parse(m[1]);
};
const files = [...new Set(list("SHELL").concat(list("MAP")))]
  .map((f) => f.replace(/^\.\//, ""))
  .filter((f) => f && !f.endsWith("/"));

fs.rmSync(OUT, { recursive: true, force: true });
let bytes = 0;
for (const f of files) {
  const from = path.join(DOCS, f), to = path.join(OUT, f);
  if (!fs.existsSync(from)) throw new Error("the shell lists " + f + " and docs/ has no such file");
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  bytes += fs.statSync(to).size;
}
console.log("shell: " + files.length + " files, " + (bytes / 1048576).toFixed(2) + " MB -> native/www");
