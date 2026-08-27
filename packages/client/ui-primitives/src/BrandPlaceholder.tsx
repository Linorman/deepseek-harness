import type { IconProps } from './icons/props.ts'

interface RobotGlyphProps {
  /** Horizontal offset in the parent SVG viewBox. */
  x?: number
  /** Vertical offset in the parent SVG viewBox. */
  y?: number
  /** Scale relative to the 24 × 24 glyph viewBox. */
  scale?: number
}

/** Robot line art shared by the fallback brand placements. */
function RobotGlyph({ x = 0, y = 0, scale = 1 }: RobotGlyphProps) {
  return (
    <g
      transform={`translate(${x} ${y}) scale(${scale})`}
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 5V2.75" />
      <circle cx="12" cy="2" r="1" fill="currentColor" stroke="none" />
      <rect x="4.5" y="5.5" width="15" height="13" rx="3.5" />
      <path d="M4.5 10H2.75M19.5 10h1.75" />
      <circle cx="9" cy="11.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="11.5" r="1" fill="currentColor" stroke="none" />
      <path d="M8.5 15.5h7" />
    </g>
  )
}

/** Robot artwork used when a deployment does not provide a brand mark. */
export function BrandPlaceholderMark({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <RobotGlyph />
    </svg>
  )
}

/** Horizontal robot lockup used in a deployment's expanded brand row. */
export function BrandPlaceholderWordmark({ size = 24, className }: IconProps) {
  const width = (size * 156) / 24
  return (
    <svg width={width} height={size} viewBox="0 0 156 24" className={className} fill="none" aria-hidden="true">
      <RobotGlyph />
      <path d="M34 7h70M34 12h93M34 17h54" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <rect x="112" y="5" width="40" height="14" rx="3" fill="currentColor" />
      <path d="M119 9h26M119 13h18" stroke="var(--clocky-alias-label-primary-inverted)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

/** Compact robot artwork for local attribution and badge seats. */
export function BrandPlaceholderBadge({ size = 20, className }: IconProps) {
  const width = (size * 121) / 20
  return (
    <svg width={width} height={size} viewBox="0 0 121 20" className={className} fill="none" aria-hidden="true">
      <rect x="0.75" y="0.75" width="119.5" height="18.5" rx="4" stroke="currentColor" strokeWidth="1.5" />
      <RobotGlyph x={-0.85} y={2} scale={0.84} />
      <path d="M19 7h40M19 10h52M19 13h28" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M88 7h22M88 10h16M88 13h19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
