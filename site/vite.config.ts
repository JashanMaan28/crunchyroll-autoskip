import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { marked } from 'marked'

const site = __dirname
const repo = resolve(site, '..')
const BASE = '/crunchyroll-autoskip/'
const REPO_URL = 'https://github.com/JashanMaan28/crunchyroll-autoskip'

const manifest = JSON.parse(readFileSync(resolve(repo, 'extension/manifest.json'), 'utf8'))

// Renders one of the repo's Markdown files into a page, so the privacy policy
// and the changelog on the site are always the ones in the repo.
function markdown(file: string): string {
  let src = readFileSync(resolve(repo, file), 'utf8').replace(/\r\n/g, '\n')
  // The page has its own title and intro.
  src = src.replace(/^# .*\n+/, '')
  if (file === 'CHANGELOG.md') {
    src = src.replace(/^All notable changes[\s\S]*?\n\n/, '')
    src = src.replace(/^## \[Unreleased\]\n+(?=## )/m, '')
  }
  if (file === 'PRIVACY.md') src = src.replace(/^\*\*Autoskip for Crunchyroll\*\*.*\n+/, '')
  let html = marked.parse(src, { async: false }) as string
  html = html
    .replace(/href="CHANGELOG\.md"/g, `href="${BASE}changelog/"`)
    .replace(/href="PRIVACY\.md"/g, `href="${BASE}privacy/"`)
    .replace(/href="(?!https?:|#|\/)([^"]+)"/g, `href="${REPO_URL}/blob/master/$1"`)
    .replace(/<a href="https?:/g, '<a rel="noopener" href="https:')
  // Keep a Changelog headings: "[1.1.2] - 2026-11-19" becomes a version and a date.
  html = html.replace(/<h2>(?:<a [^>]*>)?([\d.]+)(?:<\/a>)? - (\d{4}-\d{2}-\d{2})<\/h2>/g, (_m, v, d) => {
    const date = new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
    return `<h2 id="v${v.replace(/\./g, '-')}"><span class="ver">${v}</span><time datetime="${d}">${date}</time></h2>`
  })
  return html
}

const content = (): Plugin => ({
  name: 'site-content',
  transformIndexHtml: {
    order: 'pre',
    handler: (html) => html
      .replace(/<!--\s*partial:(\w+)\s*-->/g, (_m, f) => readFileSync(resolve(site, 'partials', `${f}.html`), 'utf8'))
      .replace(/<!--\s*md:([\w.]+)\s*-->/g, (_m, f) => markdown(f))
      .replace(/%VERSION%/g, manifest.version)
      .replace(/%REPO%/g, REPO_URL)
      .replace(/%BASE%/g, BASE),
  },
})

export default defineConfig({
  base: BASE,
  plugins: [react(), content()],
  build: {
    rollupOptions: {
      output: { manualChunks: { react: ['react', 'react-dom'] } },
      input: {
        home: resolve(site, 'index.html'),
        demo: resolve(site, 'demo/index.html'),
        guide: resolve(site, 'guide/index.html'),
        privacy: resolve(site, 'privacy/index.html'),
        changelog: resolve(site, 'changelog/index.html'),
        notfound: resolve(site, '404.html'),
      },
    },
  },
})
