// The extension's countdown button, drawn the way content/overlay.js draws
// it: a dark face and an orange copy of the same face revealed left to
// right, so the label reads on both sides of the moving edge.

export const SKIP_ICON = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 5.2v13.6a.8.8 0 0 0 1.24.66L17 12.66a.8.8 0 0 0 0-1.32L7.24 4.54A.8.8 0 0 0 6 5.2Z" fill="currentColor" />
    <rect x="17.5" y="4.5" width="2.5" height="15" rx="1.25" fill="currentColor" />
  </svg>
)

export const NEXT_ICON = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 6.2v11.6a.8.8 0 0 0 1.25.66L12 13v4.8a.8.8 0 0 0 1.25.66l8.2-5.8a.8.8 0 0 0 0-1.32l-8.2-5.8A.8.8 0 0 0 12 6.2V11L4.25 5.54A.8.8 0 0 0 3 6.2Z" fill="currentColor" />
  </svg>
)

export function SkipButton({ label, kind, fill, pressed, duration = 3000 }: { label: string; kind: 'skip' | 'next'; fill: number; pressed?: boolean; duration?: number }) {
  const icon = kind === 'next' ? NEXT_ICON : SKIP_ICON
  return (
    <span className="sb">
      <span
        className="sb-skip"
        data-pressed={pressed || undefined}
        data-filling={fill > 0 || undefined}
        style={{ ['--p' as string]: String(fill), ['--sb-dur' as string]: `${duration}ms` }}
      >
        <span className="sb-face">{icon}<span>{label}</span></span>
        <span className="sb-face sb-fill" aria-hidden="true">{icon}<span>{label}</span></span>
      </span>
      <span className="sb-cancel" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
      </span>
    </span>
  )
}
