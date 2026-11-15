// Builds installable packages from extension/:
//   dist/chrome/   + dist/crunchyroll-autoskip-chrome-<version>.zip
//   dist/firefox/  + dist/crunchyroll-autoskip-firefox-<version>.zip
// The source manifest is Chrome's. Firefox gets a background page instead of
// a service worker, plus its add-on id. No dependencies (Node 22+).
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "extension");
const DIST = path.join(ROOT, "dist");

function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, base));
    else out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out.sort();
}

// Minimal zip writer (deflate), enough for browser extension packages.
function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, "utf8");
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt32LE(0x00210000, 10); // 1980-01-01 00:00, so builds are reproducible
    local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(useDeflate ? 8 : 0, 10);
    central.writeUInt32LE(0x00210000, 12);
    central.writeUInt32LE(crc >>> 0, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + body.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

function firefoxManifest(m) {
  const out = { ...m };
  delete out.minimum_chrome_version;
  out.background = { scripts: ["shared/defaults.js", "background.js"] };
  out.browser_specific_settings = {
    gecko: {
      id: "crunchyroll-autoskip@autoskip.extension",
      // 128+: host permissions are granted at install for MV3 add-ons.
      strict_min_version: "128.0",
      data_collection_permissions: { required: ["none"] }
    }
  };
  return out;
}

function build(target, manifest) {
  const dir = path.join(DIST, target);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(SRC, dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  const files = listFiles(dir).map((name) => ({ name, data: fs.readFileSync(path.join(dir, name)) }));
  const zipPath = path.join(DIST, `crunchyroll-autoskip-${target}-${manifest.version}.zip`);
  fs.writeFileSync(zipPath, zip(files));
  console.log(`${target.padEnd(8)} ${path.relative(ROOT, dir)}/  ${path.relative(ROOT, zipPath)}  (${files.length} files)`);
}

const manifest = JSON.parse(fs.readFileSync(path.join(SRC, "manifest.json"), "utf8"));
fs.mkdirSync(DIST, { recursive: true });
const only = process.argv[2];
if (!only || only === "chrome") build("chrome", manifest);
if (!only || only === "firefox") build("firefox", firefoxManifest(manifest));
