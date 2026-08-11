import { describe, expect, it } from 'vitest'
import { generateDataset } from '../demo/generate'
import { aggregate, filterByRange, makeRange } from '../metrics'

/* ============================================================================
   Demo-dataset GOLDENS.

   These inline snapshots were captured from generateDataset() BEFORE the
   assembleDataset() extraction (live-integration P2). The refactor moves the
   index-building + derived-status logic into a shared builder used by both demo
   and live — these numbers prove the demo output is unchanged by that move.

   If a snapshot here changes, the demo dataset changed. That is only correct
   when the generator itself was deliberately edited — never as a side effect of
   provider/live work.
   ========================================================================== */

describe('demo dataset goldens (pre-assembleDataset refactor)', () => {
  const ds = generateDataset()

  it('entity counts are stable', () => {
    expect({
      clients: ds.clients.length,
      accounts: ds.accounts.length,
      campaigns: ds.campaigns.length,
      adSets: ds.adSets.length,
      ads: ds.ads.length,
      creatives: ds.creatives.length,
      insightRows: ds.insights.length,
    }).toMatchInlineSnapshot(`
      {
        "accounts": 7,
        "adSets": 52,
        "ads": 169,
        "campaigns": 26,
        "clients": 7,
        "creatives": 103,
        "insightRows": 12798,
      }
    `)
  })

  it('28d portfolio KPIs are stable', () => {
    const agg = aggregate(filterByRange(ds.insights, makeRange('28d')))
    expect({
      spend: Math.round(agg.spend),
      orders: agg.purchases,
      cpa: +agg.cpa.toFixed(2),
      roas: +agg.roas.toFixed(2),
      ctr: +agg.ctr.toFixed(2),
      frequency: +agg.frequency.toFixed(3),
    }).toMatchInlineSnapshot(`
      {
        "cpa": 41.98,
        "ctr": 1.18,
        "frequency": 2.434,
        "orders": 21269,
        "roas": 1.95,
        "spend": 892899,
      }
    `)
  })

  it('index shapes are stable (sizes + status post-pass results)', () => {
    const statusCounts = (xs: Array<{ status: string }>) => {
      const m: Record<string, number> = {}
      for (const x of xs) m[x.status] = (m[x.status] ?? 0) + 1
      return m
    }
    expect({
      clientById: ds.clientById.size,
      accountByClient: ds.accountByClient.size,
      campaignsByClient: ds.campaignsByClient.size,
      adSetsByCampaign: ds.adSetsByCampaign.size,
      adsByAdSet: ds.adsByAdSet.size,
      adsByClient: ds.adsByClient.size,
      adById: ds.adById.size,
      adSetById: ds.adSetById.size,
      campaignById: ds.campaignById.size,
      creativeById: ds.creativeById.size,
      creativesByClient: ds.creativesByClient.size,
      insightsByAd: ds.insightsByAd.size,
      campaignStatuses: statusCounts(ds.campaigns),
      adSetStatuses: statusCounts(ds.adSets),
      adStatuses: statusCounts(ds.ads),
    }).toMatchInlineSnapshot(`
      {
        "accountByClient": 7,
        "adById": 169,
        "adSetById": 52,
        "adSetStatuses": {
          "ACTIVE": 46,
          "LEARNING_LIMITED": 6,
        },
        "adSetsByCampaign": 26,
        "adStatuses": {
          "ACTIVE": 147,
          "LEARNING": 14,
          "PAUSED": 8,
        },
        "adsByAdSet": 52,
        "adsByClient": 7,
        "campaignById": 26,
        "campaignStatuses": {
          "ACTIVE": 26,
        },
        "campaignsByClient": 7,
        "clientById": 7,
        "creativeById": 103,
        "creativesByClient": 7,
        "insightsByAd": 169,
      }
    `)
  })

  it('per-client 28d spend is stable', () => {
    const rows = ds.clients.map((c) => {
      const ads = ds.adsByClient.get(c.id) ?? []
      const ins = filterByRange(
        ads.flatMap((a) => ds.insightsByAd.get(a.id) ?? []),
        makeRange('28d'),
      )
      const agg = aggregate(ins)
      return { client: c.id, spend: Math.round(agg.spend), orders: agg.purchases }
    })
    expect(rows).toMatchInlineSnapshot(`
      [
        {
          "client": "c_lumiere",
          "orders": 6661,
          "spend": 201125,
        },
        {
          "client": "c_forge",
          "orders": 4292,
          "spend": 245241,
        },
        {
          "client": "c_hearthwell",
          "orders": 2175,
          "spend": 120526,
        },
        {
          "client": "c_vela",
          "orders": 2915,
          "spend": 116676,
        },
        {
          "client": "c_nomad",
          "orders": 2572,
          "spend": 72338,
        },
        {
          "client": "c_atlas",
          "orders": 1913,
          "spend": 110081,
        },
        {
          "client": "c_bloom",
          "orders": 741,
          "spend": 26913,
        },
      ]
    `)
  })
})
