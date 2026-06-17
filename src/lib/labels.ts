import type { CampaignKind, CampaignObjective, CreativePerformance, OptimizationGoal } from './types'

export const CAMPAIGN_KIND_LABEL: Record<CampaignKind, string> = {
  advantage_plus: 'Advantage+',
  prospecting: 'Prospecting',
  retargeting: 'Retargeting',
  testing: 'Creative Test',
}

export const OBJECTIVE_LABEL: Record<CampaignObjective, string> = {
  OUTCOME_SALES: 'Sales',
  OUTCOME_LEADS: 'Leads',
  OUTCOME_TRAFFIC: 'Traffic',
  OUTCOME_AWARENESS: 'Awareness',
  OUTCOME_ENGAGEMENT: 'Engagement',
}

export const OPT_GOAL_LABEL: Record<OptimizationGoal, string> = {
  OFFSITE_CONVERSIONS: 'Conversions',
  VALUE: 'Value',
  LINK_CLICKS: 'Link clicks',
  LANDING_PAGE_VIEWS: 'LP views',
}

export const DIAGNOSIS_META: Record<
  CreativePerformance['diagnosis'],
  { label: string; tone: 'success' | 'warning' | 'danger' | 'info' | 'default' | 'brand' }
> = {
  winner: { label: 'Winner', tone: 'success' },
  hook_weak: { label: 'Weak hook', tone: 'warning' },
  body_weak: { label: 'Weak body', tone: 'warning' },
  convert_weak: { label: 'Low CVR', tone: 'danger' },
  fatigued: { label: 'Fatigued', tone: 'danger' },
  unproven: { label: 'Unproven', tone: 'default' },
  steady: { label: 'Steady', tone: 'info' },
}
