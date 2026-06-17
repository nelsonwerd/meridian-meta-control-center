import { useState } from 'react'
import { Calendar, Check } from 'lucide-react'
import { cn } from '../../lib/cn'
import { useClickOutside } from '../../lib/useClickOutside'
import { useStore } from '../../app/store'
import { earliestDate, fmtShort, today } from '../../lib/metrics'
import type { RangePreset } from '../../lib/types'

const PRESETS: { preset: RangePreset; label: string }[] = [
  { preset: 'today', label: 'Today' },
  { preset: 'yesterday', label: 'Yesterday' },
  { preset: '7d', label: 'Last 7 days' },
  { preset: '14d', label: 'Last 14 days' },
  { preset: '28d', label: 'Last 28 days' },
  { preset: 'mtd', label: 'Month to date' },
]

export function DateRangeMenu() {
  const [open, setOpen] = useState(false)
  const ref = useClickOutside<HTMLDivElement>(() => setOpen(false))
  const range = useStore((s) => s.range)
  const setRangePreset = useStore((s) => s.setRangePreset)
  const [customStart, setCustomStart] = useState(range.start)
  const [customEnd, setCustomEnd] = useState(range.end)

  const applyCustom = () => {
    if (customStart && customEnd && customStart <= customEnd) {
      setRangePreset('custom', { start: customStart, end: customEnd })
      setOpen(false)
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Select date range"
        className="flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm font-medium text-ink transition-colors hover:border-line-strong hover:bg-surface-3 focus-ring"
      >
        <Calendar className="h-4 w-4 text-ink-subtle" />
        <span className="hidden sm:inline">{range.label}</span>
        <span className="text-2xs text-ink-subtle">{fmtShort(range.start)}–{fmtShort(range.end)}</span>
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[280px] overflow-hidden rounded-2xl border border-line bg-surface-2 p-1.5 shadow-pop animate-fade-in">
          {PRESETS.map((p) => (
            <button
              key={p.preset}
              onClick={() => {
                setRangePreset(p.preset)
                setOpen(false)
              }}
              className={cn(
                'flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-surface-3',
                range.preset === p.preset ? 'text-ink' : 'text-ink-muted',
              )}
            >
              {p.label}
              {range.preset === p.preset && <Check className="h-4 w-4 text-brand" />}
            </button>
          ))}
          <div className="mt-1 border-t border-line p-2">
            <div className="label-eyebrow mb-1.5">Custom range</div>
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={customStart}
                min={earliestDate()}
                max={today()}
                onChange={(e) => setCustomStart(e.target.value)}
                className="input px-2 py-1 text-xs [color-scheme:dark]"
              />
              <span className="text-ink-subtle">–</span>
              <input
                type="date"
                value={customEnd}
                min={earliestDate()}
                max={today()}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="input px-2 py-1 text-xs [color-scheme:dark]"
              />
            </div>
            <button onClick={applyCustom} className="btn-primary mt-2 w-full py-1.5 text-xs">
              Apply range
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
