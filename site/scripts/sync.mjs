// Copies what the site borrows from the extension, so there is one source of
// truth: the skip logic and the countdown button the demo runs, the font and
// the icon. The copies are gitignored.
import { cpSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const site = join(dirname(fileURLToPath(import.meta.url)), '..')
const ext = join(site, '..', 'extension')
const copy = (from, to) => {
  mkdirSync(dirname(join(site, to)), { recursive: true })
  cpSync(join(ext, from), join(site, to))
}

copy('shared/defaults.js', 'src/ext/defaults.js')
copy('content/planner.js', 'src/ext/planner.js')
copy('content/overlay.js', 'src/ext/overlay.js')
copy('fonts/figtree-latin.woff2', 'public/fonts/figtree.woff2')
copy('icons/icon.svg', 'public/icon.svg')
console.log('synced extension files')
