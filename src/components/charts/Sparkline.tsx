import { useId } from 'react'

/** Tiny dependency-free sparkline (line + soft area fill). */
export function Sparkline({
  data,
  width = 96,
  height = 28,
  tone = 'rgb(var(--brand))',
  strokeWidth = 1.5,
  fill = true,
}: {
  data: number[]
  width?: number
  height?: number
  tone?: string
  strokeWidth?: number
  fill?: boolean
}) {
  const id = useId()
  if (!data.length) return <svg width={width} height={height} />
  const min = Math.min(...data)
  const max = Math.max(...data)
  const span = max - min || 1
  const pad = strokeWidth
  const stepX = (width - pad * 2) / Math.max(1, data.length - 1)
  const points = data.map((v, i) => {
    const x = pad + i * stepX
    const y = pad + (height - pad * 2) * (1 - (v - min) / span)
    return [x, y] as const
  })
  const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const area = `${line} L${points[points.length - 1][0].toFixed(1)},${height} L${points[0][0].toFixed(1)},${height} Z`
  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={tone} stopOpacity="0.28" />
          <stop offset="100%" stopColor={tone} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={area} fill={`url(#spark-${id})`} />}
      <path d={line} fill="none" stroke={tone} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={points[points.length - 1][0]} cy={points[points.length - 1][1]} r={strokeWidth + 0.5} fill={tone} />
    </svg>
  )
}
