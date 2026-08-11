import { describe, expect, it } from 'vitest'
import {
  actionVal,
  adSetStatus,
  adStatus,
  batchFromDate,
  classifyAngle,
  ensureClientCosmetics,
  inferAudience,
  inferCampaignKind,
  inferCreativeFormat,
  mapCampaign,
  mapCreative,
  mapInsightRow,
  mapObjective,
  normalizeStatus,
  placeholderCreative,
  synthesizeBusinessManagers,
  type MapContext,
  type RawAdSet,
} from '../provider/liveMap'

/* Fixtures shaped like real Graph v26 responses (string numerics, nested action
   arrays, effective_status enums, learning_stage_info) — the mapper must turn
   these into Meridian's domain types without the UI/engine noticing a difference
   from demo-shaped data. */

const ctx: MapContext = { clientId: 'c_x', accountId: 'act_1', anchor: '2026-08-11', currencyOffset: 100 }

describe('normalizeStatus — Meta effective_status → 5-value EntityStatus', () => {
  it('maps the full enum, never crashing StatusBadge', () => {
    expect(normalizeStatus('ACTIVE', undefined)).toBe('ACTIVE')
    expect(normalizeStatus('PAUSED', undefined)).toBe('PAUSED')
    expect(normalizeStatus('CAMPAIGN_PAUSED', undefined)).toBe('PAUSED')
    expect(normalizeStatus('ADSET_PAUSED', undefined)).toBe('PAUSED')
    expect(normalizeStatus('WITH_ISSUES', undefined)).toBe('PAUSED')
    expect(normalizeStatus('DISAPPROVED', undefined)).toBe('PAUSED')
    expect(normalizeStatus('ARCHIVED', undefined)).toBe('ARCHIVED')
    expect(normalizeStatus('DELETED', undefined)).toBe('ARCHIVED')
    expect(normalizeStatus('IN_PROCESS', undefined)).toBe('LEARNING')
    expect(normalizeStatus('PENDING_REVIEW', undefined)).toBe('LEARNING')
    expect(normalizeStatus('PREAPPROVED', undefined)).toBe('LEARNING')
    expect(normalizeStatus('PENDING_BILLING_INFO', undefined)).toBe('LEARNING')
    // unknown future statuses land somewhere SAFE (never scaled)
    expect(normalizeStatus('SOME_FUTURE_STATUS', undefined)).toBe('PAUSED')
    expect(normalizeStatus(undefined, 'ACTIVE')).toBe('ACTIVE') // fallback to status
    expect(normalizeStatus(undefined, undefined)).toBe('PAUSED')
  })
})

describe('adSetStatus — learning_stage_info refinement', () => {
  const base: RawAdSet = { id: 'as1', effective_status: 'ACTIVE' }
  it('LEARNING → LEARNING; FAIL → LEARNING_LIMITED (Meta has no "learning limited" status — FAIL is the signal)', () => {
    expect(adSetStatus({ ...base, learning_stage_info: { status: 'LEARNING' } })).toBe('LEARNING')
    expect(adSetStatus({ ...base, learning_stage_info: { status: 'FAIL' } })).toBe('LEARNING_LIMITED')
    expect(adSetStatus({ ...base, learning_stage_info: { status: 'SUCCESS' } })).toBe('ACTIVE')
    expect(adSetStatus(base)).toBe('ACTIVE')
  })
  it('learning never overrides a non-ACTIVE effective_status', () => {
    expect(adSetStatus({ id: 'x', effective_status: 'PAUSED', learning_stage_info: { status: 'LEARNING' } })).toBe('PAUSED')
  })
})

describe('adStatus — ads inherit learning from the parent ad set', () => {
  it('ACTIVE ad in a learning ad set reads LEARNING (keeps the scale gate honest)', () => {
    expect(adStatus({ id: 'a1', effective_status: 'ACTIVE' }, 'LEARNING')).toBe('LEARNING')
    expect(adStatus({ id: 'a1', effective_status: 'ACTIVE' }, 'LEARNING_LIMITED')).toBe('LEARNING')
    expect(adStatus({ id: 'a1', effective_status: 'ACTIVE' }, 'ACTIVE')).toBe('ACTIVE')
    expect(adStatus({ id: 'a1', effective_status: 'ADSET_PAUSED' }, 'ACTIVE')).toBe('PAUSED')
  })
})

describe('mapObjective', () => {
  it('ODAX passes through; legacy maps; unknown defaults to sales', () => {
    expect(mapObjective('OUTCOME_SALES')).toBe('OUTCOME_SALES')
    expect(mapObjective('OUTCOME_APP_PROMOTION')).toBe('OUTCOME_APP_PROMOTION')
    expect(mapObjective('CONVERSIONS')).toBe('OUTCOME_SALES')
    expect(mapObjective('LINK_CLICKS')).toBe('OUTCOME_TRAFFIC')
    expect(mapObjective('APP_INSTALLS')).toBe('OUTCOME_APP_PROMOTION')
    expect(mapObjective('REACH')).toBe('OUTCOME_AWARENESS')
    expect(mapObjective('VIDEO_VIEWS')).toBe('OUTCOME_ENGAGEMENT')
    expect(mapObjective('SOMETHING_NEW')).toBe('OUTCOME_SALES')
  })
})

describe('mapCampaign — CBO/ABO from budget location, minor units via currencyOffset', () => {
  it('campaign-level budget → CBO with display-unit budget', () => {
    const c = mapCampaign({ id: '1', name: '[ASC] Advantage+ Shopping', objective: 'OUTCOME_SALES', effective_status: 'ACTIVE', daily_budget: '250000', bid_strategy: 'LOWEST_COST_WITHOUT_CAP', smart_promotion_type: 'AUTOMATED_SHOPPING_ADS', created_time: '2026-01-15T10:00:00+0000' }, ctx)
    expect(c.budgetType).toBe('CBO')
    expect(c.dailyBudget).toBe(2500)
    expect(c.kind).toBe('advantage_plus')
    expect(c.createdAt).toBe('2026-01-15')
  })
  it('no campaign budget → ABO, null dailyBudget', () => {
    const c = mapCampaign({ id: '2', name: 'Retargeting — Site + ATC', effective_status: 'ACTIVE' }, ctx)
    expect(c.budgetType).toBe('ABO')
    expect(c.dailyBudget).toBeNull()
    expect(c.kind).toBe('retargeting')
  })
  it('JPY-style accounts divide by offset 1, not 100', () => {
    const jpy = mapCampaign({ id: '3', name: 'JP Prospecting', daily_budget: '5000', effective_status: 'ACTIVE' }, { ...ctx, currencyOffset: 1 })
    expect(jpy.dailyBudget).toBe(5000) // ¥5000, NOT ¥50
  })
})

describe('inferCampaignKind', () => {
  it('reads agency naming conventions', () => {
    expect(inferCampaignKind('Prospecting — Broad + LLA', undefined)).toBe('prospecting')
    expect(inferCampaignKind('RT: ATC 14d Retargeting', undefined)).toBe('retargeting')
    expect(inferCampaignKind('Creative Testing — Q3', undefined)).toBe('testing')
    expect(inferCampaignKind('ASC — Evergreen', undefined)).toBe('advantage_plus')
    expect(inferCampaignKind('Random Name 123', undefined)).toBe('prospecting')
  })
})

describe('inferAudience — gates EXPAND_AUDIENCE, so precision matters', () => {
  it('advantage_audience flag wins over everything', () => {
    const a = inferAudience({ targeting_automation: { advantage_audience: 1 }, interests: [{ id: '1', name: 'Yoga' }] })
    expect(a.type).toBe('advantage')
  })
  it('lookalike vs retargeting from custom audience names', () => {
    expect(inferAudience({ custom_audiences: [{ id: '1', name: 'LAL 1% Purchasers' }] }).type).toBe('lookalike')
    expect(inferAudience({ custom_audiences: [{ id: '1', name: 'Site visitors 30d' }] }).type).toBe('retargeting')
  })
  it('interests (incl. flexible_spec) → interest; none → broad with geo label', () => {
    expect(inferAudience({ interests: [{ id: '1', name: 'Skincare' }, { id: '2', name: 'Beauty' }] })).toEqual({ type: 'interest', label: 'Skincare +1', sizeEstimate: 0 })
    expect(inferAudience({ flexible_spec: [{ interests: [{ id: '9', name: 'Coffee' }] }] }).type).toBe('interest')
    const broad = inferAudience({ geo_locations: { countries: ['US', 'CA'] }, age_min: 25, age_max: 55 })
    expect(broad.type).toBe('broad')
    expect(broad.label).toContain('US, CA')
    expect(inferAudience(undefined).type).toBe('broad')
  })
})

describe('creative mapping', () => {
  it('detects format from the object_story_spec media block', () => {
    expect(inferCreativeFormat({ id: '1', object_story_spec: { video_data: { video_id: 'v1' } } })).toBe('video')
    expect(inferCreativeFormat({ id: '2', object_story_spec: { link_data: { child_attachments: [{}, {}, {}] } } })).toBe('carousel')
    expect(inferCreativeFormat({ id: '3', object_story_spec: { link_data: {} } })).toBe('image')
    expect(inferCreativeFormat({ id: '4', asset_feed_spec: { ad_formats: ['AUTOMATIC_FORMAT', 'CAROUSEL'] } })).toBe('carousel')
    expect(inferCreativeFormat({ id: '5', asset_feed_spec: { videos: [{}] } })).toBe('video')
    expect(inferCreativeFormat({ id: '6' })).toBe('image')
  })

  it('classifies angles from copy; neutral bucket is Lifestyle', () => {
    expect(classifyAngle('UGC mashup — real customers')).toBe('UGC Testimonial')
    expect(classifyAngle('Why I started this company')).toBe('Founder Story')
    expect(classifyAngle('Tired of dull skin? Say goodbye')).toBe('Problem / Solution')
    expect(classifyAngle('20% off summer sale')).toBe('Offer / Promo')
    expect(classifyAngle('Rated 4.9 by 12,000 reviews')).toBe('Social Proof')
    expect(classifyAngle('Morning routine at the lake')).toBe('Lifestyle')
  })

  it('maps a full creative with headline/copy + gradient + real batch quarter', () => {
    const c = mapCreative(
      { id: 'cr9', name: 'Summer promo video', object_story_spec: { video_data: { title: 'Big Summer Sale', message: '25% off everything', video_id: 'v' } } },
      ctx,
      '2026-05-03',
    )
    expect(c.format).toBe('video')
    expect(c.angle).toBe('Offer / Promo')
    expect(c.headline).toBe('Big Summer Sale')
    expect(c.thumbnailGradient).toHaveLength(2) // CreativeThumb destructures this
    expect(c.batch).toBe('Q2 2026') // from the referencing ad's date, not the anchor
    expect(c.createdAt).toBe('2026-05-03')
  })

  it('batchFromDate buckets by quarter', () => {
    expect(batchFromDate('2026-01-01', '2026-08-11')).toBe('Q1 2026')
    expect(batchFromDate('2026-08-11', '2026-08-11')).toBe('Q3 2026')
    expect(batchFromDate(undefined, '2026-11-30')).toBe('Q4 2026')
  })

  it('placeholderCreative satisfies every field CreativeThumb dereferences', () => {
    const p = placeholderCreative('cr_missing', 'UGC testimonial ad', ctx)
    expect(p.thumbnailGradient).toHaveLength(2)
    expect(p.angle).toBe('UGC Testimonial')
    expect(p.batch).toMatch(/^Q\d 20\d\d$/)
  })
})

describe('client cosmetics + BM synthesis', () => {
  it('fills monogram/accent/targets without overwriting operator values', () => {
    const c = ensureClientCosmetics({ id: 'c_lum', name: 'Lumière Skincare', targetCPA: 32 }, '2026-08-11', 60, 'EUR')
    expect(c.monogram).toBe('LS')
    expect(c.accentColor).toMatch(/^#/)
    expect(c.targetCPA).toBe(32) // operator value kept
    expect(c.currency).toBe('EUR')
    expect(c.startDate).toBe('2026-06-13') // anchor - (windowDays-1)
  })
  it('is deterministic (same id → same accent across reloads)', () => {
    expect(ensureClientCosmetics({ id: 'c_a', name: 'A' }, '2026-08-11', 90, 'USD').accentColor)
      .toBe(ensureClientCosmetics({ id: 'c_a', name: 'A' }, '2026-08-11', 90, 'USD').accentColor)
  })
  it('synthesizes one BM per unique business id', () => {
    const bms = synthesizeBusinessManagers([
      { clientId: 'a', adAccountId: 'act_1', businessId: 'biz_1', businessName: 'Northbeam Collective', businessType: 'agency' },
      { clientId: 'b', adAccountId: 'act_2', businessId: 'biz_1' },
      { clientId: 'c', adAccountId: 'act_3', businessId: 'biz_2', businessType: 'partner' },
    ])
    expect(bms).toHaveLength(2)
    expect(bms[0]).toEqual({ id: 'biz_1', name: 'Northbeam Collective', type: 'agency', metaBusinessId: 'biz_1' })
    expect(bms[1].type).toBe('partner')
  })
})

describe('mapInsightRow — Graph action arrays → additive Insight facts', () => {
  const row = {
    ad_id: '120210001',
    date_start: '2026-08-10',
    spend: '184.55',
    impressions: '10450',
    reach: '6120',
    clicks: '210',
    inline_link_clicks: '150',
    actions: [
      { action_type: 'omni_purchase', value: '12' },
      { action_type: 'offsite_conversion.fct.purchase', value: '11' },
      { action_type: 'add_to_cart', value: '41' },
      { action_type: 'landing_page_view', value: '119' },
    ],
    action_values: [
      { action_type: 'omni_purchase', value: '744.60' },
      { action_type: 'offsite_conversion.fct.purchase', value: '700.10' },
    ],
    video_play_actions: [{ action_type: 'video_view', value: '9100' }],
    video_3_sec_watched_actions: [{ action_type: 'video_view', value: '3300' }],
    video_thruplay_watched_actions: [{ action_type: 'video_view', value: '1210' }],
  }

  it('extracts the configured purchase action (NOT a sum of overlapping types)', () => {
    const i = mapInsightRow(row, 'c_x', 'omni_purchase')
    expect(i.purchases).toBe(12)
    expect(i.revenue).toBe(744.6)
    expect(i.spend).toBe(184.55)
    expect(i.linkClicks).toBe(150)
    expect(i.video3s).toBe(3300)
  })

  it('falls back to the pixel action only when the primary is absent', () => {
    const pixelOnly = { ...row, actions: row.actions.filter((a) => a.action_type !== 'omni_purchase'), action_values: row.action_values.filter((a) => a.action_type !== 'omni_purchase') }
    const i = mapInsightRow(pixelOnly, 'c_x', 'omni_purchase')
    expect(i.purchases).toBe(11)
    expect(i.revenue).toBe(700.1)
  })

  it('a custom per-account action type is honoured', () => {
    const i = mapInsightRow(row, 'c_x', 'offsite_conversion.fct.purchase')
    expect(i.purchases).toBe(11)
  })

  it('actionVal returns 0 for absent types and tolerates undefined arrays', () => {
    expect(actionVal(undefined, 'omni_purchase')).toBe(0)
    expect(actionVal([], 'omni_purchase')).toBe(0)
  })
})
