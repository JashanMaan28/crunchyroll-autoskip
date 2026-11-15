const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("manifest and package.json versions match", () => {
  const manifest = JSON.parse(read("extension/manifest.json"));
  const pkg = JSON.parse(read("package.json"));
  assert.equal(manifest.version, pkg.version);
});

test("the current version has a CHANGELOG entry", () => {
  const { version } = JSON.parse(read("package.json"));
  assert.match(read("CHANGELOG.md"), new RegExp(`^## \\[${version.replace(/\./g, "\\.")}\\] - \\d{4}-\\d{2}-\\d{2}$`, "m"));
});

test("every file the manifest references exists", () => {
  const m = JSON.parse(read("extension/manifest.json"));
  const files = [
    m.background.service_worker,
    m.action.default_popup,
    ...Object.values(m.icons),
    ...m.content_scripts.flatMap((c) => c.js),
    ...m.web_accessible_resources.flatMap((w) => w.resources)
  ];
  for (const f of files) assert.ok(fs.existsSync(path.join(root, "extension", f)), `missing extension/${f}`);
});
