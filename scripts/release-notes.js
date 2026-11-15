// Prints the CHANGELOG.md section for one version, for the GitHub release.
// Usage: node scripts/release-notes.js 1.1.0
const fs = require("node:fs");
const path = require("node:path");

const version = process.argv[2];
if (!version) {
  console.error("usage: node scripts/release-notes.js <version>");
  process.exit(1);
}
const lines = fs.readFileSync(path.join(__dirname, "..", "CHANGELOG.md"), "utf8").split(/\r?\n/);
const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
if (start === -1) {
  console.error(`No "## [${version}]" section in CHANGELOG.md`);
  process.exit(1);
}
let end = lines.findIndex((l, i) => i > start && /^## \[|^\[[^\]]+\]: /.test(l));
if (end === -1) end = lines.length;
const body = lines.slice(start + 1, end).join("\n").trim();

console.log(`${body}

## Install

- **Chrome / Edge:** unzip \`crunchyroll-autoskip-chrome-${version}.zip\`, open \`chrome://extensions\`, turn on **Developer mode** and use **Load unpacked** on the unzipped folder.
- **Firefox (128+):** open \`about:debugging#/runtime/this-firefox\`, click **Load Temporary Add-on** and pick \`crunchyroll-autoskip-firefox-${version}.zip\`.`);
