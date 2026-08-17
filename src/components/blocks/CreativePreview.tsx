import { useEffect, useState } from 'react'
import { ExternalLink, Film, Image as ImageIcon, Layers } from 'lucide-react'
import { useStore } from '../../app/store'
import { cn } from '../../lib/cn'
import type { Creative, CreativeRatio } from '../../lib/types'
import type { CreativeAsset } from '../../lib/provider'

const ASPECT: Record<CreativeRatio, string> = { '1:1': 'aspect-square', '4:5': 'aspect-[4/5]', '9:16': 'aspect-[9/16]' }
const FORMAT_ICON = { video: Film, image: ImageIcon, carousel: Layers }

/** The creative itself, at the size you can actually judge it — a playable video
 *  where Meta gives us a source, the full-resolution still otherwise.
 *
 *  The asset is fetched on MOUNT, not with the snapshot: one Graph read for the
 *  one creative an operator opened. Everything here degrades rather than fails —
 *  a preview that can't load must never take a page down with it. */
export function CreativePreview({ creative, className }: { creative: Creative; className?: string }) {
  const provider = useStore((s) => s.provider)
  const [asset, setAsset] = useState<CreativeAsset | null>(null)
  const [loading, setLoading] = useState(false)
  const [imgFailed, setImgFailed] = useState(false)
  const canResolve = Boolean(provider.resolveCreativeAsset)

  useEffect(() => {
    // Demo has no real media and doesn't implement the method at all.
    if (!provider.resolveCreativeAsset) return
    let active = true
    setLoading(true)
    void provider
      .resolveCreativeAsset(creative)
      .then((a) => active && setAsset(a))
      .catch(() => active && setAsset(null))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [provider, creative])

  const [from, to] = creative.thumbnailGradient
  // Fall back to the card's own thumbnail so something is on screen immediately,
  // then upgrade in place when the full-resolution asset arrives.
  const still = (!imgFailed && (asset?.imageUrl ?? creative.thumbnailUrl)) || null
  const Icon = FORMAT_ICON[creative.format]

  return (
    <div className={className}>
      <div
        className={cn('relative w-full overflow-hidden rounded-xl border border-line', ASPECT[creative.ratio])}
        style={{ background: `linear-gradient(150deg, ${from}, ${to})` }}
      >
        {asset?.videoUrl ? (
          <video
            src={asset.videoUrl}
            poster={still ?? undefined}
            controls
            playsInline
            preload="metadata"
            className="absolute inset-0 h-full w-full bg-black object-contain"
          />
        ) : still ? (
          // object-CONTAIN, not cover: a preview exists to show the whole
          // creative, and cropping it is exactly what you don't want here.
          <img
            src={still}
            alt={creative.name}
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className="absolute inset-0 h-full w-full object-contain"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/80">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-white/15 ring-1 ring-white/25 backdrop-blur-sm">
              <Icon className="h-5 w-5" />
            </span>
            {/* Demo never had media to begin with, so "no preview available"
                would read as breakage rather than as the point. */}
            {canResolve && <span className="text-2xs">{loading ? 'Loading creative…' : 'No preview available'}</span>}
          </div>
        )}
        {loading && still && (
          <div className="absolute bottom-2 right-2 rounded-md bg-black/45 px-1.5 py-0.5 text-2xs text-white backdrop-blur-sm">
            Loading full size…
          </div>
        )}
      </div>

      <div className="mt-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-xs font-medium text-ink">{creative.headline}</div>
          {creative.primaryText && <div className="mt-0.5 line-clamp-2 text-2xs leading-relaxed text-ink-subtle">{creative.primaryText}</div>}
        </div>
        {asset?.permalinkUrl && (
          <a
            href={asset.permalinkUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line px-2 py-1 text-2xs text-ink-muted transition-colors hover:text-ink focus-ring"
          >
            <ExternalLink className="h-3 w-3" /> On Facebook
          </a>
        )}
      </div>
      {creative.format === 'carousel' && (
        // Carousels are N cards behind one creative; Graph gives us the spec, not
        // a rendered strip. Say so rather than showing card 1 as "the creative".
        <p className="mt-1.5 text-2xs text-ink-subtle">Carousel — showing the first card. Open on Facebook to page through the rest.</p>
      )}
    </div>
  )
}
