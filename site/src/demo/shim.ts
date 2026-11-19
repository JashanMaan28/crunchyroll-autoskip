// The overlay asks the extension runtime for its font URL. On the site the
// font lives in public/fonts.
const g = globalThis as unknown as { chrome?: { runtime?: { getURL?: (p: string) => string } } }
if (!g.chrome?.runtime?.getURL) {
  g.chrome = { runtime: { getURL: (p: string) => `${import.meta.env.BASE_URL}${p.replace('fonts/figtree-latin.woff2', 'fonts/figtree.woff2')}` } }
}
export {}
