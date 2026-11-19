/** Brand artwork is not bundled in this site; the registry is empty. */
export type BrandAsset = {
  name: string
  category: 'Payments' | 'Banks' | 'Apps' | 'Crypto'
  light: string
  dark: string
  tileArtwork?: string
  tileBackground?: string
  proportion: number
  scale: number
}

export const brandMarks = {} as Record<string, BrandAsset>

export type BrandName = string
