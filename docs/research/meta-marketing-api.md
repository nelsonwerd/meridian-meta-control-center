# Meta (Facebook) Marketing API — Technical Reference

> Internal engineering reference for the Autopilot Meta Control Center — an agency tool that reads from and writes to the Meta Marketing API for DTC/ecommerce clients optimizing for orders at low CPA.
>
> **Compiled:** 2026-06-17 · **Target API version:** **v25.0** (current GA) · Most field/enum content is version-stable.
>
> **Sourcing & honesty:** Field names and enum string values were drawn primarily from Meta's auto-generated **Business SDKs** (`facebook-python-business-sdk`, `facebook-nodejs-business-sdk` on GitHub) — the most reliable machine-readable mirror of Meta's internal schema — and cross-checked against the official `developers.facebook.com` docs and Meta's developer blog. Several official reference pages are JS-rendered SPAs that truncate or 404 to automated fetchers; where a detail could not be quoted verbatim it is flagged. Genuinely uncertain items are marked **⚠️** inline. Console UI labels drift over time; treat them as "current layout," not contractual.

---

## 0. Quick Facts (build-critical TL;DR)

| Fact | Value |
|---|---|
| Current GA version | **v25.0** (released Feb 18, 2026) |
| Also active | v24.0 (Oct 8 2025), v23.0 (May 29 2025), v22.0 (Jan 21 2025) |
| Base URL | `https://graph.facebook.com/v25.0/` |
| Version lifetime | ~2 years from release before deprecation; new version every ~3–4 months |
| Ad account ID format | `act_<numeric_id>` (only object with a prefix) |
| Auth for agency backend | **System User** access token (non-expiring or 60-day) |
| Budgets/bids unit | Account-currency **minor units** (cents) — but whole units for zero-decimal currencies (JPY, KRW…) |
| Purchases/revenue | **No scalar field** — extract by `action_type` from `actions`/`action_values` arrays |
| Default attribution | **7-day click + 1-day view** |
| Big recent change | **Jan 12, 2026: `7d_view` & `28d_view` removed** from Ads Insights API |

**The infamous internal-vs-UI node naming** (the #1 source of confusion):

| UI label | Internal API node | Reference URL path |
|---|---|---|
| Campaign | `campaign` | `/reference/ad-campaign-group/` |
| Ad Set | `adset` | `/reference/ad-campaign/` |
| Ad | `ad` | `/reference/adgroup/` |

So `ad-campaign` = **Ad Set**, and `ad-campaign-group` = **Campaign**. `adgroup` = **Ad**.

---

## 1. Object Hierarchy & Graph

The Marketing API is a **graph**: **nodes** (objects with IDs), **edges** (named connections accessed as URL path segments), and **fields** (properties). The advertising hierarchy runs vertically; Pages, Instagram accounts, and Pixels attach **sideways** by reference.

```
Business Manager (Business)
        │  owns / is-client-of
        ▼
   Ad Account  (act_<id>)              ← the ONLY prefixed ID in the chain
        │  /campaigns
        ▼
    Campaign  (node: ad-campaign-group)  ← objective, special_ad_categories,
        │  /adsets                          campaign budget (Advantage/CBO)
        ▼
     Ad Set  (node: ad-campaign)          ← targeting, budget, schedule, bid,
        │  /ads                              optimization_goal, billing_event,
        ▼                                    placements, promoted_object
       Ad  (node: adgroup)                ← BINDS an Ad Set ⟷ an Ad Creative
        │  creative reference
        ▼
   Ad Creative                           ← image/video/copy/CTA/destination
                                            + Page & Instagram identity
```

### 1.1 Referenced sideways (not children of the campaign chain)

- **Page** — Business-owned node. Referenced by creatives via `object_story_spec.page_id` (the ad's publishing identity); home of organic posts you can promote via `object_story_id`.
- **Instagram account** — referenced by creatives via `instagram_user_id` (current) / `instagram_actor_id` (legacy).
- **Pixel** (Ads Pixel / dataset) — Business-owned node. Referenced by the **Ad Set's** `promoted_object` (`pixel_id`) for conversion optimization, and by the **Ad's** `tracking_specs` for reporting.
- **Product Catalog / Product Set** — referenced by Dynamic Product Ad creatives (`product_set_id`, `template_data`).

### 1.2 Edges (read)

| Purpose | Edge / call |
|---|---|
| Ad accounts a Business **owns** | `GET /<business_id>/owned_ad_accounts` |
| Ad accounts a Business manages for **clients** | `GET /<business_id>/client_ad_accounts` |
| Pixels owned by a business | `GET /<business_id>/adspixels` |
| Campaigns in an account | `GET /act_<id>/campaigns` |
| Ad sets in a campaign | `GET /<campaign_id>/adsets` |
| Ad sets in an account | `GET /act_<id>/adsets` |
| Ads in an ad set | `GET /<adset_id>/ads` |
| Ads in a campaign / account | `GET /<campaign_id>/ads`, `GET /act_<id>/ads` |
| Read an ad's creative | `GET /<ad_id>?fields=creative{id,object_story_spec,asset_feed_spec,effective_object_story_id}` |
| Creatives in an account | `GET /act_<id>/adcreatives` |
| Insights (any node) | `GET /<node_id>/insights` |

**Creation edges** all hang off the **ad account**: `POST /act_<id>/campaigns`, `POST /act_<id>/adsets`, `POST /act_<id>/adcreatives`, `POST /act_<id>/ads`.

### 1.3 ID formats & prefix conventions

**Only the Ad Account carries a textual prefix (`act_`). Every other object ID is a bare numeric string.** Distinguish object types by *which edge returned the ID*, not by the ID's shape.

| Object | ID format | Prefix? | Notes |
|---|---|---|---|
| Ad Account | `act_1234567890123456` | **Yes — `act_`** | Required in all paths. `id` field is returned **with** the prefix; `account_id` is the same number **without** it → `id == "act_" + account_id`. |
| Business Manager / Business | 15–16 digit number | No | Bare numeric (`business_id=`). |
| Campaign | ~17-digit numeric string | No | Addressed as `/{campaign_id}`. |
| Ad Set | ~17-digit numeric string | No | Addressed as `/{adset_id}` (not sub-scoped under the campaign). |
| Ad (`adgroup`) | ~17-digit numeric string | No | Addressed as `/{ad_id}`. |
| Ad Creative | numeric string | No | Lives under the account. |
| Page | numeric | No | Bare numeric node ID. |

> **Gotcha:** different tools/SDKs expect different forms of the account ID — some want full `act_1234…`, some the bare `1234…`. The field name disambiguates (`id` = prefixed, `account_id` = bare). Never rely on a prefix to identify campaign/adset/ad type — there is none.

---

## 2. Object Field Reference

### 2.1 Campaign (`ad-campaign-group`) — `POST /act_<id>/campaigns`

#### `objective` — ODAX enums (6 valid values for new campaigns)

Since the ODAX (Outcome-Driven Ad Experience) migration (mandatory in the API since early 2024), only these 6 `OUTCOME_*` values are valid for **new** campaigns. A legacy enum on create returns `(#100) Objective X is invalid`.

| ODAX Objective | Purpose |
|---|---|
| `OUTCOME_AWARENESS` | Brand awareness, reach, ad recall |
| `OUTCOME_TRAFFIC` | Send people to a site, app, Messenger, WhatsApp, calls |
| `OUTCOME_ENGAGEMENT` | Messages, video views, post/page engagement, conversions-as-engagement |
| `OUTCOME_LEADS` | Lead forms, messages-as-leads, conversions-as-leads |
| `OUTCOME_APP_PROMOTION` | App installs and app events |
| `OUTCOME_SALES` | **Conversions, catalog sales** ← primary for DTC orders |

**Legacy → ODAX mapping** (reconstructed; some legacy objectives genuinely split across multiple outcomes by conversion location — **⚠️ verify the split cases**):

| Legacy | Maps to ODAX |
|---|---|
| `BRAND_AWARENESS`, `REACH`, `LOCAL_AWARENESS` | `OUTCOME_AWARENESS` |
| `VIDEO_VIEWS` | `OUTCOME_ENGAGEMENT` (primary); also Awareness |
| `LINK_CLICKS` | `OUTCOME_TRAFFIC` |
| `POST_ENGAGEMENT`, `PAGE_LIKES`, `EVENT_RESPONSES` | `OUTCOME_ENGAGEMENT` |
| `APP_INSTALLS` | `OUTCOME_APP_PROMOTION` |
| `LEAD_GENERATION` | `OUTCOME_LEADS` |
| `MESSAGES` | **Split:** `OUTCOME_ENGAGEMENT` or `OUTCOME_LEADS` |
| `CONVERSIONS` | **Split:** mainly `OUTCOME_SALES`; also `OUTCOME_LEADS`/`OUTCOME_ENGAGEMENT` |
| `PRODUCT_CATALOG_SALES` | `OUTCOME_SALES` |

> **`objective` is locked at creation** — you cannot change it later. To "change objective," create a new campaign (restarts learning).

#### `status` vs `effective_status`

`status` (a.k.a. `configured_status`) is your **intent** (writable). `effective_status` is the **computed reality** (read-only), factoring in review state and parent-object states.

| Field | Enum values |
|---|---|
| `status` / `configured_status` (writable) | `ACTIVE`, `PAUSED`, `DELETED`, `ARCHIVED` (only `ACTIVE`/`PAUSED` on create) |
| `effective_status` — campaign level (read-only) | `ACTIVE`, `PAUSED`, `DELETED`, `ARCHIVED`, `IN_PROCESS`, `WITH_ISSUES` |

Review-specific states (`PENDING_REVIEW`, `DISAPPROVED`, etc.) appear at the **Ad** level (§2.3), not the campaign level. Always read `effective_status` to know if a campaign is truly live.

#### Other key Campaign fields

| Field | Type | Notes / enums |
|---|---|---|
| `bid_strategy` | enum | `LOWEST_COST_WITHOUT_CAP`, `LOWEST_COST_WITH_BID_CAP`, `COST_CAP`, `LOWEST_COST_WITH_MIN_ROAS`. Applies at campaign level under a campaign-level budget. |
| `special_ad_categories` | array<enum> | **Required on create** (`[]` if none). Values: `NONE`, `EMPLOYMENT`, `HOUSING`, `CREDIT`, `ISSUES_ELECTIONS_POLITICS`, `ONLINE_GAMBLING_AND_GAMING`, `FINANCIAL_PRODUCTS_SERVICES`. Companion: `special_ad_category_country` (ISO codes). |
| `buying_type` | string | `AUCTION` (default) or `RESERVED` (reservation buying). **⚠️ No inner SDK enum** — from docs. |
| `daily_budget` / `lifetime_budget` | integer string | **Minor currency unit** (cents). **Mutually exclusive.** Budget at campaign level = **Advantage Campaign Budget (ACB / formerly CBO)**. `lifetime_budget` requires `stop_time`. |

### 2.2 Ad Set (`ad-campaign`) — `POST /act_<id>/adsets`

Owns targeting, budget, schedule, bidding, optimization.

#### `optimization_goal` — full SDK enum

`NONE`, `APP_INSTALLS`, `AD_RECALL_LIFT`, `ENGAGED_USERS`, `EVENT_RESPONSES`, `IMPRESSIONS`, `LEAD_GENERATION`, `QUALITY_LEAD`, `LINK_CLICKS`, `OFFSITE_CONVERSIONS`, `PAGE_LIKES`, `POST_ENGAGEMENT`, `QUALITY_CALL`, `REACH`, `LANDING_PAGE_VIEWS`, `VALUE`, `THRUPLAY`, `DERIVED_EVENTS`, `APP_INSTALLS_AND_OFFSITE_CONVERSIONS`, `CONVERSATIONS`, `IN_APP_VALUE`, `MEANINGFUL_CALL_ATTEMPT`, `PROFILE_VISIT`, `PROFILE_AND_PAGE_ENGAGEMENT`, `SUBSCRIBERS`, `REMINDERS_SET`, `MESSAGING_PURCHASE_CONVERSION`, `MESSAGING_APPOINTMENT_CONVERSION`, `ADVERTISER_SILOED_VALUE`, `AUTOMATIC_OBJECTIVE`, `ENGAGED_PAGE_VIEWS`, `MESSAGING_DEEP_CONVERSATION_AND_FOLLOW`, `VISIT_INSTAGRAM_PROFILE`.

> **For DTC orders:** use `OFFSITE_CONVERSIONS` (optimize for the purchase event) or `VALUE` (optimize for revenue / ROAS). The old umbrella `CONVERSIONS` goal was retired under ODAX. Each goal is valid only for specific campaign objectives.

#### `billing_event` — full SDK enum

`APP_INSTALLS`, `CLICKS`, `IMPRESSIONS`, `LINK_CLICKS`, `NONE`, `OFFER_CLAIMS`, `PAGE_LIKES`, `POST_ENGAGEMENT`, `THRUPLAY`, `PURCHASE`, `LISTING_INTERACTION`. Must be compatible with the chosen `optimization_goal` (e.g. bill on `IMPRESSIONS` when optimizing `OFFSITE_CONVERSIONS`).

#### Bidding, budgets, schedule

| Field | Type | Notes |
|---|---|---|
| `bid_strategy` | enum | `LOWEST_COST_WITHOUT_CAP` (omit `bid_amount`), `LOWEST_COST_WITH_BID_CAP` (cap required), `COST_CAP` (cap required), `LOWEST_COST_WITH_MIN_ROAS` (ROAS floor via `roas_average_floor`). |
| `bid_amount` | integer | Minor currency unit (cents). Required for bid-cap / cost-cap. |
| `daily_budget` / `lifetime_budget` | integer string | Minor unit; **mutually exclusive**; must be **omitted** if the campaign uses ACB/CBO. `lifetime_budget` requires `end_time`. |
| `start_time` / `end_time` | ISO 8601 | e.g. `"2026-07-01T00:00:00-0700"`. Interpreted in the account timezone. |

#### `attribution_spec`

A list of `{ event_type, window_days }`. `event_type`: `CLICK_THROUGH`, `VIEW_THROUGH`, `ENGAGED_VIDEO_VIEW`. Current: 1/7-day click + 1-day view (28-day **deprecated for new ad sets**).

```json
"attribution_spec": [
  { "event_type": "CLICK_THROUGH", "window_days": 7 },
  { "event_type": "VIEW_THROUGH",  "window_days": 1 }
]
```

#### `targeting` spec object

| Field | Type | Notes |
|---|---|---|
| `geo_locations` / `excluded_geo_locations` | object | Sub-keys: `countries` (ISO-2), `regions`, `cities` (`{key, radius, distance_unit}`), `zips` (`{key:"US:94025"}`), `geo_markets` (DMA), `location_types` (`["home","recent"]`). |
| `age_min` / `age_max` | int | Min 13, max 65 (65 = "65+"). |
| `genders` | array<int> | `1`=male, `2`=female; omit / `[1,2]`=all. |
| `interests`, `behaviors`, `life_events` | array<object> | `{id, name}` detailed-targeting entries. |
| `custom_audiences` / `excluded_custom_audiences` | array<object> | `[{ "id": "<audience_id>" }]`. |
| `flexible_spec` | array<object> | Top-level entries **AND**-ed; within one block **OR**-ed. |
| `publisher_platforms` | array<string> | `facebook`, `instagram`, `audience_network`, `messenger`, `threads`. |
| `facebook_positions` / `instagram_positions` / `audience_network_positions` / `messenger_positions` | array<string> | e.g. FB `feed`, `marketplace`, `story`, `facebook_reels`; IG `stream`, `story`, `reels`, `explore`. |
| `device_platforms` | array<string> | `mobile`, `desktop`, `connected_tv`. |
| `targeting_automation` | object | Advantage+ flags, e.g. `{"advantage_audience": 1}`. |

```json
"targeting": {
  "geo_locations": {
    "countries": ["US"],
    "cities": [{ "key": "2418779", "radius": 25, "distance_unit": "mile" }],
    "location_types": ["home", "recent"]
  },
  "age_min": 25, "age_max": 54, "genders": [2],
  "flexible_spec": [
    { "interests": [{ "id": "6003107902433", "name": "Association football (Soccer)" }] }
  ],
  "custom_audiences": [{ "id": "23847000000000001" }],
  "publisher_platforms": ["facebook", "instagram"],
  "facebook_positions": ["feed", "marketplace"],
  "instagram_positions": ["stream", "reels"],
  "device_platforms": ["mobile", "desktop"]
}
```

#### `promoted_object`

Ties the ad set to what it optimizes for. Fields: `pixel_id`, `custom_event_type`, `custom_conversion_id`, `page_id`, `application_id`, `object_store_url`, `product_set_id`, `product_catalog_id`, `offline_conversion_data_set_id`.

**`custom_event_type` enum:** `ACHIEVEMENT_UNLOCKED`, `ADD_PAYMENT_INFO`, `ADD_TO_CART`, `ADD_TO_WISHLIST`, `AD_IMPRESSION`, `COMPLETE_REGISTRATION`, `CONTACT`, `CONTENT_VIEW`, `CUSTOMIZE_PRODUCT`, `D2_RETENTION`, `D7_RETENTION`, `DONATE`, `FIND_LOCATION`, `INITIATED_CHECKOUT`, `LEAD`, `LEVEL_ACHIEVED`, `LISTING_INTERACTION`, `MESSAGING_CONVERSATION_STARTED_7D`, `OTHER`, `PURCHASE`, `RATE`, `SCHEDULE`, `SEARCH`, `SERVICE_BOOKING_REQUEST`, `SPENT_CREDITS`, `START_TRIAL`, `SUBMIT_APPLICATION`, `SUBSCRIBE`, `TUTORIAL_COMPLETION`.

```json
// Website purchase conversion (pair with optimization_goal OFFSITE_CONVERSIONS)
"promoted_object": { "pixel_id": "1234567890", "custom_event_type": "PURCHASE" }
```

### 2.3 Ad (`adgroup`) — `POST /act_<id>/ads`

The **join node**: links `adset_id` (up to the Ad Set) and `creative` (over to the Ad Creative). One creative can be reused across many ads; one ad → exactly one creative.

| Field | Type | Meaning |
|---|---|---|
| `creative` | object | On create pass `{ "creative_id": "<id>" }`; on read you get `{ "id": "<id>" }`, expandable via `?fields=creative{...}`. |
| `status` / `configured_status` (writable) | enum | `ACTIVE`, `PAUSED`, `DELETED`, `ARCHIVED`. |
| `effective_status` (read-only) | enum | See full list below. |
| `tracking_specs` | array | **Report-only** action-specs (log events without optimizing). |
| `conversion_specs` | array | Read-only since v2.4 — derived from the ad set. |

**Ad `effective_status` — full 12-value enum:** `ACTIVE`, `PAUSED`, `DELETED`, `PENDING_REVIEW`, `DISAPPROVED`, `PREAPPROVED`, `PENDING_BILLING_INFO`, `CAMPAIGN_PAUSED`, `ARCHIVED`, `ADSET_PAUSED`, `IN_PROCESS`, `WITH_ISSUES`.

> `effective_status` **rolls up the hierarchy**: an ad you set `ACTIVE` shows `CAMPAIGN_PAUSED` / `ADSET_PAUSED` if a parent is paused, or `PENDING_REVIEW` / `DISAPPROVED` from review. This is where review states live.

### 2.4 Ad Creative — `POST /act_<id>/adcreatives`

Holds **what the user sees** — media + copy + CTA + destination — plus the Page/Instagram identity.

| Field | Type | Notes |
|---|---|---|
| `object_story_spec` | object | **Primary modern way** to define a creative (inline unpublished post). |
| `object_story_id` | `"<page_id>_<post_id>"` | Reference to an **existing** published post (alternative to `object_story_spec`). |
| `asset_feed_spec` | object | **Flexible / Dynamic / Advantage+** creative — asset pools Meta mixes & optimizes. |
| `instagram_user_id` | numeric string | **Current** IG-identity field (prefer over legacy `instagram_actor_id`). |

#### `object_story_spec` structure

Supply identity + **exactly one** media block (`link_data` / `video_data` / `photo_data` / `template_data`).

| Field | Notes |
|---|---|
| `page_id` | **Required** — the publishing Facebook Page. |
| `instagram_user_id` | IG account for Instagram placements. |
| `link_data` | Single-image/video link post **or carousel** (`child_attachments`). Fields: `message`, `link`, `name` (headline), `description`, `image_hash`/`picture`, `call_to_action` (`{type, value:{link}}`), `child_attachments` (2–10 cards). |
| `video_data` | `video_id` (required), `image_hash`/`image_url` (thumb), `title`, `message`, `call_to_action`. |
| `photo_data` | `image_hash` (or `url`), `caption`. |

```json
// Single-image link ad
{
  "name": "Spring Sale — Single Image",
  "object_story_spec": {
    "page_id": "1099xxxxxxxxxxx",
    "instagram_user_id": "1784xxxxxxxxxxx",
    "link_data": {
      "message": "Spring is here. Up to 40% off everything.",
      "link": "https://shop.example.com/spring",
      "name": "Spring Sale Now On",
      "description": "Free shipping over $50. Ends Sunday.",
      "image_hash": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
      "call_to_action": {
        "type": "SHOP_NOW",
        "value": { "link": "https://shop.example.com/spring" }
      }
    }
  }
}
```

**Common `call_to_action_type` values:** `SHOP_NOW`, `LEARN_MORE`, `SIGN_UP`, `DOWNLOAD`, `BOOK_NOW`, `GET_OFFER`, `GET_QUOTE`, `CONTACT_US`, `SUBSCRIBE`, `APPLY_NOW`, `ORDER_NOW`, `MESSAGE_PAGE`, `WHATSAPP_MESSAGE`, `CALL_NOW`, `DONATE_NOW`, `NO_BUTTON`. (Full SDK enum has 100+; Meta validates the CTA against the ad's objective/destination at create time.)

#### `asset_feed_spec` (dynamic / flexible / Advantage+)

Supply **pools** of each asset; Meta mixes/optimizes per user/placement. Fields: `images`, `videos`, `bodies`, `titles`, `descriptions`, `link_urls`, `call_to_action_types`, `ad_formats` (`SINGLE_IMAGE`, `CAROUSEL`, `AUTOMATIC_FORMAT`), `optimization_type` (`ASSET_CUSTOMIZATION`, `PLACEMENT`, `REGULAR`, `FORMAT_AUTOMATION`). Identity (`page_id`/`instagram_user_id`) still lives in `object_story_spec`.

```json
"asset_feed_spec": {
  "ad_formats": ["SINGLE_IMAGE"],
  "optimization_type": "REGULAR",
  "images": [{ "hash": "aaaa1111..." }, { "hash": "bbbb2222..." }],
  "bodies": [{ "text": "Up to 40% off everything this spring." }],
  "titles": [{ "text": "Spring Sale Now On" }],
  "link_urls": [{ "website_url": "https://shop.example.com/spring" }],
  "call_to_action_types": ["SHOP_NOW"]
}
```

---

## 3. Insights API (`/insights`)

`/insights` is an **edge available on every ad-object node**. GET against the object you want; the API aggregates for that object and (optionally) its children.

| Endpoint | Reports on |
|---|---|
| `GET /act_<id>/insights` | Whole ad account |
| `GET /<campaign_id>/insights` | One campaign |
| `GET /<adset_id>/insights` | One ad set |
| `GET /<ad_id>/insights` | One ad |

### 3.1 The `level` parameter

`level` controls **row granularity** (`account`/`campaign`/`adset`/`ad`); the **node you query controls scope (filter)**. They are orthogonal. `level` must be at the **same or finer** granularity than the node queried. Omitting `level` defaults to the node's own level.

- **Most common DTC pattern:** `GET /act_<id>/insights?level=ad&time_increment=1` → daily, per-ad table you pivot up yourself.

### 3.2 Useful fields for a DTC/ecommerce tool

Numeric metrics are returned as **strings** (e.g. `"spend": "2352.45"`); array metrics are `list<AdsActionStats>`.

| Field | Type | Meaning |
|---|---|---|
| `spend` | numeric string | Total spent (account currency). |
| `impressions` | int string | Times ads were on screen. |
| `reach` | int string | Unique people (de-duplicated). |
| `frequency` | float string | `impressions / reach`. |
| `clicks` | int string | All clicks (broad — includes reactions, comments, page-likes). |
| `ctr` | % string | `clicks / impressions * 100`. |
| `cpc` | string | Cost per (all) click. |
| `cpm` | string | Cost per 1,000 impressions. |
| `cpp` | string | Cost per 1,000 people reached. |
| `actions` | `list<AdsActionStats>` | **Array** of `{action_type, value}` — counts of each event (purchases, ATC, link clicks). |
| `action_values` | `list<AdsActionStats>` | **Array** — monetary **value** (revenue) per action_type. |
| `purchase_roas` | `list<AdsActionStats>` | **Array** — ROAS from purchases across Business Tools. |
| `website_purchase_roas` | `list<AdsActionStats>` | **Array** — ROAS from **website (pixel) purchases**. |
| `cost_per_action_type` | `list<AdsActionStats>` | **Array** — `spend / count`. For purchases = your **CPA**. |
| `conversions` | `list<AdsActionStats>` | **Array** — conversion-event counts. |
| `conversion_values` | `list<AdsActionStats>` | **Array** — value per conversion type. |
| `cost_per_conversion` | `list<AdsActionStats>` | **Array** — cost per conversion type. |
| `outbound_clicks` | `list<AdsActionStats>` | **Array** — clicks that leave Meta (cleaner traffic signal). |
| `inline_link_clicks` | int string | Clicks on links within the ad to destinations. |
| `inline_link_click_ctr` | % string | `inline_link_clicks / impressions * 100`. |
| `cost_per_inline_link_click` | string | Effective CPC to the landing page. |
| `video_thruplay_watched_actions` | `list<AdsActionStats>` | **Array** — ThruPlays (full or ≥15s). The standard "real view" KPI. |
| `video_play_actions` | `list<AdsActionStats>` | **Array** — video starts. |
| `video_avg_time_watched_actions` | `list<AdsActionStats>` | **Array** — avg seconds watched. |
| `video_p25/p50/p75/p100_watched_actions` | `list<AdsActionStats>` | **Array** — viewers reaching each quartile. |
| `cost_per_thruplay` | `list<AdsActionStats>` | **Array** — `spend / thruplays`. |

Always-returned: `account_currency`, `date_start`, `date_stop`. Also useful: `campaign_name`, `adset_name`, `ad_name`, `objective`, `optimization_goal`.

> **Key gotcha:** anything typed `list<AdsActionStats>` is an **array keyed by `action_type`**. There is **no scalar `purchases` or `revenue` field** — you compute orders/revenue/CPA/ROAS yourself (§3.3).

### 3.3 CRITICAL — how orders and revenue are represented

Orders and revenue live inside the `AdsActionStats` arrays, looked up by `action_type`.

#### The `AdsActionStats` element shape

```jsonc
{
  "action_type": "omni_purchase",  // event identifier
  "value": "125",                  // metric for the DEFAULT attribution window
  // present only if you requested action_attribution_windows:
  "1d_view": "18",
  "1d_click": "97",
  "7d_click": "125"
}
```

#### Purchase `action_type` values — **do not sum them; they overlap/double-count**

| `action_type` | Counts | DTC note |
|---|---|---|
| `purchase` | Generic purchase rollup (UI "Purchases"). | Source depends on setup. |
| `offsite_conversion.fct.purchase` | Pixel / Conversions API purchases. | Modern off-Meta website signal; canonical for pixel/CAPI stores. |
| `omni_purchase` | **Omni-channel** (web + app + offline, de-duplicated). | **Usually the best single "orders" number**; matches Ads Manager most often. |
| `onsite_web_purchase` | Purchases completed **on Meta** (Shops). | Only if you sell via Meta Shops. |
| `web_in_store_purchase` | Web purchases in cross-channel context. | Niche / omni retailers. |

Legacy variant also seen: `offsite_conversion.fb_pixel_purchase`. For revenue, the matching `action_values` row uses the **same `action_type`** string.

**Recommendation:** standardize on `omni_purchase` for order count + ROAS; fall back to `offsite_conversion.fct.purchase` / `offsite_conversion.fb_pixel_purchase` for pixel-only accounts. Make the canonical type **configurable per account** and reconcile against Ads Manager (and first-party order data, e.g. Shopify).

#### Concrete response row

```jsonc
{
  "spend": "2352.45",
  "impressions": "184302",
  "reach": "151120",
  "inline_link_clicks": "6608",
  "actions": [
    { "action_type": "link_click",                     "value": "6608" },
    { "action_type": "landing_page_view",              "value": "5102" },
    { "action_type": "offsite_conversion.fct.add_to_cart",      "value": "812" },
    { "action_type": "offsite_conversion.fct.initiate_checkout","value": "390" },
    { "action_type": "offsite_conversion.fct.purchase","value": "121" },
    { "action_type": "omni_purchase",                  "value": "125" }
  ],
  "action_values": [
    { "action_type": "offsite_conversion.fct.purchase","value": "9180.50" },
    { "action_type": "omni_purchase",                  "value": "9420.75" }
  ],
  "purchase_roas":          [ { "action_type": "omni_purchase",                  "value": "4.004" } ],
  "website_purchase_roas":  [ { "action_type": "offsite_conversion.fct.purchase","value": "3.903" } ],
  "cost_per_action_type":   [ { "action_type": "omni_purchase",                  "value": "18.82" } ],
  "date_start": "2026-05-18",
  "date_stop": "2026-06-16"
}
```

Reading this row: **orders** = `omni_purchase` count = 125 · **revenue** = `action_values[omni_purchase]` = 9420.75 · **CPA** = `cost_per_action_type[omni_purchase]` = 18.82 (= spend/orders) · **ROAS** = `purchase_roas[omni_purchase]` = 4.004.

### 3.4 Parameters

#### `date_preset` (valid enum values)

`today`, `yesterday`, `last_3d`, `last_7d`, `last_14d`, `last_28d`, `last_30d`, `last_90d`, `this_week_mon_today`, `this_week_sun_today`, `last_week_mon_sun`, `last_week_sun_sat`, `this_month`, `last_month`, `this_quarter`, `last_quarter`, `this_year`, `last_year`, `maximum`, `data_maximum`.

> **⚠️ `last_60d` is NOT valid** — use a custom `time_range` for 60 days.

#### `time_range` / `time_increment`

```json
"time_range": { "since": "2026-05-01", "until": "2026-05-31" }  // YYYY-MM-DD, until inclusive, account TZ
```
- `time_increment`: `1`…`90` (days per row; `1`=daily), `monthly`, or `all_days` (default, single aggregated row).
- `time_ranges` (array) requests multiple windows in one call.

#### `breakdowns`

| Breakdown | Use |
|---|---|
| `age`, `gender` | Demographics (combine fine together). |
| `country`, `region`, `dma` | Geo. |
| `publisher_platform` | facebook / instagram / audience_network / messenger / threads. |
| `platform_position` | feed / story / reels / right_hand_column. |
| `impression_device`, `device_platform` | Device. |
| `hourly_stats_aggregated_by_advertiser_time_zone` | Day-parting. |

> **⚠️ Combination rules are under-documented and version-dependent.** Meta only precomputes certain permutations; many combos are rejected. The placement trio (`publisher_platform` + `platform_position` + `impression_device`) combines; mixing demographic + placement + device + geo often fails; action breakdowns generally can't combine with placement/device breakdowns. **Treat the matrix as runtime data — on rejection, auto-split into supported sub-requests and reconcile client-side.**

#### `action_breakdowns`

`action_type` (default — implicitly applied, which is why `actions` comes back keyed by type), `action_device`, `action_destination`, `conversion_destination`, `standard_event_content_type`. (`action_target_id` is supported but **⚠️ not in the SDK's primary enum** — verify per account.)

#### `filtering`, `sort`, paging

```json
"filtering": [{ "field": "spend", "operator": "GREATER_THAN", "value": 100 }]
```
Operators: `EQUAL`, `NOT_EQUAL`, `GREATER_THAN`, `LESS_THAN`, `IN`, `NOT_IN`, `CONTAIN`. `sort`: `"spend_descending"` etc. `limit`: rows/page (default ~25; large pulls 100–500). Cursor paging via `paging.cursors.after`.

#### Full request example

```
GET https://graph.facebook.com/v25.0/act_123456789/insights
  ?level=ad
  &fields=ad_name,spend,impressions,inline_link_clicks,actions,action_values,
          purchase_roas,cost_per_action_type,video_thruplay_watched_actions
  &date_preset=last_30d
  &time_increment=1
  &action_attribution_windows=['7d_click','1d_view']
  &breakdowns=publisher_platform,platform_position
  &filtering=[{"field":"spend","operator":"GREATER_THAN","value":50}]
  &sort=spend_descending
  &limit=200
  &access_token=<TOKEN>
```

### 3.5 Attribution windows

**`action_attribution_windows` values:** `1d_click`, `7d_click` (default), `28d_click`, `1d_view`, `dda`, `default`. Each requested window appears as a **sub-key** on each `AdsActionStats` element.

**Default:** **7-day click + 1-day view**. If you don't pass the param, `value` reflects that combined default.

> **⚠️ MAJOR CHANGE — effective Jan 12, 2026 (confirmed, Meta dev blog):** `7d_view` and `28d_view` were **removed** from the Ads Insights API and now return no data. Remaining: `1d_view`, `1d_click`, `7d_click`, `28d_click`. The default (7d_click + 1d_view) survived intact. `28d_click` was **not** removed. Same update changed data retention: aggregate values 37 months; unique-count & hourly breakdowns 13 months; frequency breakdowns 6 months; MMM breakdowns async-only.

> **⚠️ Effective June 10, 2025:** Meta **disregards** `use_unified_attribution_setting` and `action_report_time` — responses always mimic Ads Manager (attribution from ad-set settings; inline actions folded into `1d_click`/`1d_view`; `action_report_time=mixed`). Don't rely on these params to change behavior.

**Post-iOS-14 reality:** expect API-reported purchases to **undercount** true orders. Default to `7d_click` for click-led DTC, treat `1d_view` cautiously, and reconcile against first-party order data as ground truth.

---

## 4. Authentication for a Multi-Client Agency

### 4.1 Token model — use a System User token

| Token type | Represents | Lifetime | Server automation? |
|---|---|---|---|
| User (short-lived) | A person | ~1–2 hrs | No |
| User (long-lived) | A person | ~60 days | Marginal — still person-tied, still expires |
| Page | A Page | ~60 days | Page actions only |
| App | The app | Static | App settings only, not ad data |
| **System User** | Programmatic identity in a BM | **Non-expiring OR 60-day** | **Yes — the right one** |

**Use a System User access token for the agency backend.** Meta: system-user tokens "perform programmatic, automated actions on Ad objects or Pages without requiring input from an app user or re-authentication." Non-expiring by default; pass `set_token_expires_in_60_days=true` for the (more secure, refresh-required) 60-day variant.

#### Generating a System User token

```
# 1. Install the app for the system user (app + system user must be in the SAME BM)
POST /{SYSTEM-USER-ID}/applications
  business_app={APP-ID}
  access_token={ADMIN-OR-SYSTEM-USER-TOKEN}

# 2. Generate the token
POST /{SYSTEM-USER-ID}/access_tokens
  business_app={APP-ID}
  scope=ads_management,ads_read,business_management,read_insights,pages_show_list,pages_read_engagement
  appsecret_proof={HMAC-SHA256 of the calling token, keyed with the app secret}
  set_token_expires_in_60_days=true     # omit/false → non-expiring
  access_token={ADMIN-OR-SYSTEM-USER-TOKEN}
```
`appsecret_proof = hash_hmac('sha256', token_used_in_call, app_secret)`. The system user and token owner **must be in the same BM**. (Can also be generated in Business Settings UI → System Users → Generate New Token, but do it via API for automatable onboarding.)

### 4.2 System Users

- **Admin System User** — can create system users / ad accounts, assign permissions. Treat as root; provisioning only.
- **Regular System User** — accesses only the assets it's granted. Use for day-to-day backend automation.
- **Per-business limits:** Standard tier = 1 regular + 1 admin; Advanced tier = 10 regular + 1 admin (**⚠️ has changed historically — verify in dashboard**).
- **App binding:** a system user can hold a role on an app only if **both are in the same BM** → your app must be added to your agency's BM (Business Settings → Accounts → Apps → Add), then installed for the system user.
- **Asset assignment (task-based roles):** assign ad accounts / Pages / pixels with roles `ANALYZE`, `ADVERTISE`, `MANAGE`, `EDIT`, `UPLOAD` (by asset type):

```
POST /{AD-ACCOUNT-ID}/assigned_users
  user={SYSTEM-USER-ID}
  tasks=['MANAGE']          # or ['ANALYZE'] for read-only
  business={AGENCY-BUSINESS-ID}
  access_token={ADMIN-SYSTEM-USER-TOKEN}
```

### 4.3 Permissions & access tiers

The six scopes needed are all **Advanced Access** (require App Review to use against outside accounts):

| Scope | Grants |
|---|---|
| `ads_management` | Read **and write** ad objects |
| `ads_read` | Read-only Ads Insights / reporting |
| `business_management` | Manage business assets, claim/relate accounts, manage system users/partners |
| `read_insights` | Read Insights for owned Pages/apps/domains |
| `pages_read_engagement` | Read Page content/metadata |
| `pages_show_list` | List Pages a person manages |

(Add `pages_manage_ads` if creating Page-linked ads.)

> **Two independent "Standard vs Advanced" axes — don't conflate:**
> 1. **Permission Access Levels** — *Standard Access* (only app-role users; no review; fine for testing on your own account) vs *Advanced Access* (any user; **requires App Review per permission + Business Verification** [mandatory since Feb 1 2023] + annual Data Use Checkup). Required to act on clients' accounts.
> 2. **Marketing-API rate-limit tier** — *development* (default) vs *Standard* (via App Review). Per ad account/hour: `ads_management` ≈ Dev `300 + 40×ads`, Standard `100,000 + 40×ads`; read=1pt, write=3pts.

**App Review gotcha:** the "Request Advanced Access" button stays greyed out until the app has made **at least one successful call using each permission** (within 30 days of submission). Make real dev-mode calls first.

**Net:** agency needs (1) a Business app, (2) Business Verification, (3) App Review for the six scopes (Advanced Access), (4) ideally the Standard rate-limit tier.

### 4.4 The multi-BM problem (clients in separate Business Managers)

Two structurally different models; **most real agencies use Model B.**

**Model A — Agency owns the client's ad account (inside the agency's own BM).** Simple (system user owns it outright, no partnership), but client doesn't own their data, migration is painful, billing sits on the agency. Use only for net-new accounts the agency fully runs.

**Model B — Client owns their BM/assets; agency gets access via Partner sharing (the normal case).** The client keeps ownership of their own BM, ad account, Page, pixel, and grants the agency BM access as a **Partner**. The agency's **system user** reaches those client-owned assets *through the partnership* (the asset is shared **to the agency business**, and the system user is a member of that business).

Client-side workflow:
1. Client admin → **Business Settings → Partners → Add**.
2. Chooses **"Give a partner access to assets in your Business Manager"** and enters **the agency's Business (Partner) ID**.
3. Selects specific assets (ad account, Page, pixel/dataset) and assigns **task-level permissions** per asset.
4. Assets appear in the agency BM as **partner / shared assets** (distinct from **owned**).

Agency-side workflow:
5. Assign the **system user** to each shared client asset (`assigned_users`, role `MANAGE`/`ANALYZE`).
6. Reuse the existing **system-user token** — it now operates across **all** client ad accounts shared into the BM; target them by ad-account ID.

> **Owned vs Partner/shared matters.** *Claiming* an ad account **moves ownership** to you (Model A). *Partner sharing* **keeps it with the client** (Model B) — Meta: "Most marketing companies won't need to claim ad accounts from their clients." Use partner access, not claiming, for client-owned accounts.

**Practical net:** one agency BM → one (or few) system user(s) → one long-lived token → fanned out across N client ad accounts. Onboarding a client = "client adds us as Partner + shares assets" (ops/email step on their side) + "ops assigns the system user to the new asset" (one API/UI step on ours). No per-client token, no per-client re-auth.

### 4.5 Alternative — Facebook Login for Business / BISU (OAuth-per-client)

Instead of the manual Partners handshake, onboard clients via **Facebook Login for Business**: pre-build a **configuration** (token type + assets + permissions); the client clicks through one login dialog and grants assets. This mints **Business Integration System User (BISU)** tokens — system-user tokens **scoped per onboarded customer** (authorization-code grant; exchange `code` server-to-server).

| | System User + Partner sharing | FB Login for Business / BISU |
|---|---|---|
| Onboarding UX | Partner handshake (more friction, ops-guided) | One self-serve login dialog |
| Tokens | **One** agency token spans all clients | **One token per client** |
| Best fit | Hands-on agency with known roster | Self-serve SaaS / tech provider at scale |
| Revocation | Client removes BM as Partner | Client revokes app grant |

Both still require Advanced Access (App Review) + Business Verification. **Rule of thumb:** hands-on agency → System User + Partner sharing; self-serve SaaS → FB Login for Business + BISU.

---

## 5. Write Operations (Mutations)

All writes are HTTP `POST` to the object's own node; auth needs `ads_management`.

### 5.1 Pause / Activate (single-field POST)

`status` is writable; `effective_status` is read-only/derived (POSTing it is ignored). Same pattern at all three levels.

```bash
# Pause / activate a campaign (swap ID for adset/ad)
curl -X POST "https://graph.facebook.com/v25.0/<CAMPAIGN_ID>" \
  -d "status=PAUSED" -d "access_token=<TOKEN>"
curl -X POST "https://graph.facebook.com/v25.0/<CAMPAIGN_ID>" \
  -d "status=ACTIVE" -d "access_token=<TOKEN>"
```
Success: `{"success": true}`. `ARCHIVED`/`DELETED` are terminal — for normal stop/start use `PAUSED`/`ACTIVE`.

### 5.2 Change budget (single-field POST)

Budget lives **either at campaign level (CBO / Advantage) OR ad-set level — never both.** Integers in **minor currency units**.

```bash
# Campaign-level (CBO) daily budget → $50/day
curl -X POST "https://graph.facebook.com/v25.0/<CAMPAIGN_ID>" \
  -d "daily_budget=5000" -d "access_token=<TOKEN>"

# Ad-set lifetime budget → $500 (lifetime requires end_time)
curl -X POST "https://graph.facebook.com/v25.0/<ADSET_ID>" \
  -d "lifetime_budget=50000" \
  -d "end_time=2026-07-31T23:59:59-0700" -d "access_token=<TOKEN>"
```

**Minimum budgets** depend on currency + optimization/billing event — **read them live**, don't hard-code: `min_daily_budget` on the ad account node, or `GET /act_<id>/minimum_budgets` → `MinimumBudget` object with per-event floors (`min_daily_budget_imp`, `_high_freq`, `_low_freq`, `_video_views`) in minor units.

### 5.3 Adjust bid (single-field POST)

`bid_amount` on the **ad set**, in minor units; whether it's required depends on `bid_strategy`:

| `bid_strategy` | `bid_amount` |
|---|---|
| `LOWEST_COST_WITHOUT_CAP` (default) | **Not used** — invalid to set |
| `LOWEST_COST_WITH_BID_CAP` | **Required** (max bid) |
| `COST_CAP` | **Required** (cost-per-result cap) |
| `LOWEST_COST_WITH_MIN_ROAS` | Floor via **`roas_average_floor`**, not `bid_amount` |

```bash
# Bid Cap $2.00
curl -X POST "https://graph.facebook.com/v25.0/<ADSET_ID>" \
  -d "bid_strategy=LOWEST_COST_WITH_BID_CAP" \
  -d "bid_amount=200" -d "access_token=<TOKEN>"
```
`bid_strategy` lives on the **campaign** under CBO, or on each **ad set** with ad-set budgets.

### 5.4 Simple vs involved

**Simple single-field POSTs** (optimization-tool bread and butter): `status`, `daily_budget`/`lifetime_budget`, `bid_amount`/`bid_strategy`, `name`, `start_time`/`end_time`.

**Involved:** creating creatives (`POST /act_<id>/adcreatives` with `object_story_spec` → returns `creative_id`, attach via a new ad; creatives are largely immutable — change = new creative + new ad); **changing objective is effectively impossible** (create a new campaign — `objective` is locked at creation and restarts learning).

---

## 6. Rate Limits & Batching

### 6.1 `X-Business-Use-Case-Usage` (the authoritative current model)

Per **ad account, per business use case**. Every BUC-limited response carries this header — a JSON-encoded **map keyed by business-id**, each value an **array of per-`type` objects**:

| Field | Meaning | Unit |
|---|---|---|
| `type` | `ads_management`, `ads_insights`, `custom_audience`, `pages`, … | enum |
| `call_count` | % of allowed calls used (rolling 1-hr) | **0–100** |
| `total_cputime` | % of CPU allotment | **0–100** |
| `total_time` | % of wall-time allotment | **0–100** |
| `estimated_time_to_regain_access` | Time until throttle lifts | **minutes** (0 when fine) |
| `ads_api_access_tier` | `development_access` / `standard_access` | string |

**Throttling:** when **any** of `call_count`/`total_cputime`/`total_time` hits **100**, that `type` on that account is throttled (errors: code 613, or BUC code 17 / 80000-series); `estimated_time_to_regain_access` gives recovery in minutes. CPU-heavy Insights usually hit `total_cputime`/`total_time` first.

```http
X-Business-Use-Case-Usage: {
  "1234567890123456": [
    { "type": "ads_management", "call_count": 42, "total_cputime": 18,
      "total_time": 25, "estimated_time_to_regain_access": 0,
      "ads_api_access_tier": "standard_access" },
    { "type": "ads_insights", "call_count": 100, "total_cputime": 88,
      "total_time": 71, "estimated_time_to_regain_access": 19,
      "ads_api_access_tier": "standard_access" }
  ]
}
```
**Parse on every response; back off as any metric nears 100.** `ads_insights` and `ads_management` are **separate buckets** — exhausting one doesn't block the other.

**Older headers:** `X-App-Usage` (app-wide: `{call_count,total_cputime,total_time}`, throttle at 100); `X-Ad-Account-Usage` (legacy: `{acc_id_util_pct, reset_time_duration (SECONDS), ads_api_access_tier}`). BUC supersedes `X-Ad-Account-Usage`. Honor the **most restrictive** signal.

### 6.2 Async insights report jobs

Use when a sync pull would time out (large pulls, many rows, wide ranges, many breakdowns). Can take up to ~1 hour.

```bash
# 1. Create job (POST → report_run_id, NOT data)
curl -X POST "https://graph.facebook.com/v25.0/act_<id>/insights" \
  -d "level=campaign" -d "fields=campaign_name,impressions,spend" \
  -d 'time_range={"since":"2026-01-01","until":"2026-03-31"}' \
  -d "breakdowns=age,gender" -d "access_token=<TOKEN>"
# → { "report_run_id": "6042987654321098" }

# 2. Poll
curl -G "https://graph.facebook.com/v25.0/6042987654321098" -d "access_token=<TOKEN>"
# → { "async_status": "Job Completed", "async_percent_completion": 100 }

# 3. Fetch results
curl -G "https://graph.facebook.com/v25.0/6042987654321098/insights" -d "access_token=<TOKEN>"
```

**`async_status`:** `"Job Not Started"`, `"Job Started"`, `"Job Running"`, `"Job Completed"`, `"Job Failed"`, `"Job Skipped"`. **Gate on `Job Completed`** — not on `async_percent_completion` (can read 100 while still `Job Running`). On `Job Failed`/`Job Skipped`, re-submit (often narrower). **`report_run_id` expires after ~30 days** — don't persist; re-run.

### 6.3 Batch requests

`POST` to the API root with a `batch` param = JSON array of **up to 50 sub-requests** (`method`, `relative_url`, optional `body`/`name`/`omit_response_on_success`). Response is a JSON array (same order) of `{code, headers, body}` where `body` is a **JSON-encoded string**.

- **Not one call** — a batch of 10 counts as 10 calls against limits.
- **Not transactional** — sub-requests fail independently; partial results possible.
- **Dependencies:** tag with `name`, reference via JSONPath `{result=<name>:$.<path>}`; set `"omit_response_on_success": false` to force a referenced op's body back.

```bash
curl -X POST "https://graph.facebook.com/v25.0/" \
  --data-urlencode access_token="<TOKEN>" \
  --data-urlencode 'batch=[
    { "method":"POST", "name":"create-campaign",
      "relative_url":"act_<id>/campaigns",
      "body":"name=Batched&objective=OUTCOME_TRAFFIC&status=PAUSED&special_ad_categories=[]" },
    { "method":"POST", "relative_url":"act_<id>/adsets",
      "body":"name=AdSet&campaign_id={result=create-campaign:$.id}&daily_budget=1000&billing_event=IMPRESSIONS&optimization_goal=LINK_CLICKS&targeting={\"geo_locations\":{\"countries\":[\"US\"]}}&status=PAUSED" }
  ]'
```

### 6.4 Version landscape (verified against official changelog)

| Version | Released | Status |
|---|---|---|
| **v25.0** | **Feb 18, 2026** | **Current GA** |
| v24.0 | Oct 8, 2025 | Active |
| v23.0 | May 29, 2025 | Active |
| v22.0 | Jan 21, 2025 | Active |
| v20.0 | May 21, 2024 | Expires Sept 24, 2026 |

New version every ~3–4 months; supported ~2 years before deprecation. Always pin the version in the path.

---

## 7. Practical Gotchas

1. **Attribution default = 7d click + 1d view.** `7d_view`/`28d_view` removed Jan 12, 2026 (§3.5). `use_unified_attribution_setting` / `action_report_time` disregarded since June 10, 2025. Post-ATT, API purchases **undercount** — reconcile to first-party data.

2. **`actions` array nesting.** No flat "purchases" field — filter by `action_type`. With `action_attribution_windows`, each object gains per-window keys (`1d_view`, `7d_click`, …) while `value` stays the default window. With `action_breakdowns`, each object also carries the breakdown key, multiplying rows. Reliable reads may need a composite key `(action_type, breakdown, window)`; window keys are **absent when zero** — don't assume presence.

3. **Currency / minor units (classic 100× bug).** `daily_budget`, `lifetime_budget`, `bid_amount`, spend are in the account currency's **minor units**: $50.00 = `5000`. But **zero-decimal currencies (JPY, KRW, VND, CLP, …) are whole units** — ¥5000 = `5000`. **Don't hard-code ÷100.** Read **`currency_offset`** from the [Currency object](https://developers.facebook.com/docs/graph-api/reference/currency/) (USD→100, JPY→1): `display = api_int / currency_offset`; `api_int = round(display * currency_offset)`. **⚠️ TWD/HUF diverge from raw ISO-4217** — prefer per-account `currency_offset` over a hand-maintained list. Get account currency via `GET /act_<id>?fields=currency,timezone_name,timezone_id`.

4. **Async job polling.** `report_run_id` expires ~30 days. Use exponential backoff (convention: ~5–10s start, ×1.5–2, cap ~60s — backoff is documented, exact seconds are not). Gate on `Job Completed`.

5. **Ad-account timezone governs Insights date ranges.** `date_preset`/`time_range` are in the **account's timezone**, not UTC. Pull `timezone_id`/`timezone_name` and normalize, or daily totals will shift vs Ads Manager. Currency + timezone are locked at account creation.

6. **DELETED vs ARCHIVED.** ARCHIVED = kept for reporting, read-only. DELETED = effectively gone. **Standard list queries exclude BOTH by default** — to see them, filter `effective_status=['ARCHIVED']` or query by id. A frequent "my counts don't match" ETL bug.

7. **Pagination.** Prefer **cursor-based** (opaque `before`/`after`; don't store cursors — they invalidate on data change). **Time-based** (`since`/`until` Unix, ~6-month max window) is good for chunking large Insights pulls. **Offset-based** is least reliable (contents shift; deep paging silently caps). Follow `paging.next` rather than hand-building URLs.

---

## 8. Confidence & Honesty Notes

**High confidence (verified this session):** v25.0 version table + dates; the internal-vs-UI node naming; `act_`-only ID prefix rule; the 6 ODAX objectives; `status` vs read-only `effective_status` and their enums; the 4 `bid_strategy` values + how `bid_amount` applies only to capped strategies; objective immutability; single-field POST mutation pattern; the System-User auth model + `assigned_users` + token-generation calls; the six required scopes are Advanced Access; the multi-BM Partner-sharing model; BUC header structure (`estimated_time_to_regain_access` in minutes, throttle at 100); 50-sub-request non-transactional batch + `{result=name:$.path}`; `async_status` enum + ~30-day `report_run_id` expiry; `currency_offset` (USD 100 / JPY 1); the **Jan 12, 2026 removal of `7d_view`/`28d_view`**; ARCHIVED/DELETED default exclusion; that **no scalar purchases/revenue field exists**.

**Moderate / flagged ⚠️:** legacy→ODAX split mappings (`MESSAGES`, `CONVERSIONS`); `buying_type` values (no SDK enum); exact `effective_status` membership (well-established but Meta tables resisted scraping); precise rate-limit *constants* (a model, not an SLA — trust the headers); zero-decimal currency list membership (esp. TWD/HUF — verify per-account via `currency_offset`); exact async poll interval; system-user per-tier limits (have changed historically); breakdown-combination compatibility matrix (version-dependent — treat as runtime data); `last_60d` is not a valid preset; `action_target_id` supported but not in SDK's primary enum.

**Note:** enum/field strings were sourced from Meta's auto-generated Business SDKs (Python/Node on GitHub) where the JS-rendered official reference pages truncated to automated fetchers; all such items were cross-checked against official docs and the Meta developer blog.

### Key official sources

- Versions: https://developers.facebook.com/docs/graph-api/changelog/versions/
- Campaign / Ad Set / Ad / Creative: `/reference/ad-campaign-group/`, `/reference/ad-campaign/`, `/reference/adgroup/`, `/reference/ad-creative/`
- Object Story Spec: https://developers.facebook.com/docs/marketing-api/reference/ad-creative-object-story-spec/
- Promoted Object: https://developers.facebook.com/docs/marketing-api/reference/ad-promoted-object/
- Insights: https://developers.facebook.com/docs/marketing-api/insights/ · Ads Action Stats: `/reference/ads-action-stats/`
- Jan 2026 metric/attribution changes (blog): https://developers.facebook.com/blog/post/2025/10/16/ads-insights-api-metric-availability-updates/
- Access tokens: https://developers.facebook.com/docs/facebook-login/guides/access-tokens/
- System Users (install/generate tokens): https://developers.facebook.com/docs/business-management-apis/system-users/install-apps-and-generate-tokens/
- Permissions: https://developers.facebook.com/docs/permissions/ · Access levels: https://developers.facebook.com/docs/graph-api/overview/access-levels/
- Marketing API rate limiting: https://developers.facebook.com/docs/marketing-api/overview/rate-limiting/
- Batch requests: https://developers.facebook.com/docs/graph-api/batch-requests
- Add Partners: https://www.facebook.com/business/help/708679622611131 · FB Login for Business: https://developers.facebook.com/documentation/facebook-login/facebook-login-for-business/
- Currency object: https://developers.facebook.com/docs/graph-api/reference/currency/
- SDKs (enum/field source of truth): facebook/facebook-python-business-sdk · facebook/facebook-nodejs-business-sdk
