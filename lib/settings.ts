import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { FeedSubstance } from './types';

export type LogItemKey =
  | 'bottle' | 'next_feed' | 'vitamin_d' | 'direct_breastfeed' | 'sleep' | 'diaper'
  | 'weigh_in' | 'pump' | 'daily_remarks' | 'daycare_import';

export interface LogItemSetting {
  key: LogItemKey;
  visible: boolean;
}

export interface DashboardVisible {
  intake_today: boolean;
  formula_pct: boolean;
  diapers_today: boolean;
  pumped_24h: boolean;
  sleep_24h: boolean;
  chart_intake: boolean;
  chart_supply: boolean;
}

export interface BabySettings {
  child_id: string;
  log_items: LogItemSetting[];
  bottle_default_substance: FeedSubstance;
  bottle_presets_ml: number[];
  day_start_hour: number;
  day_end_hour: number;
  feed_min_interval_h: number;
  feed_max_interval_h: number;
  dashboard_visible: DashboardVisible;
  target_intake_ml_override: number | null;
}

// A fresh fork that never opens Settings must behave exactly like the app
// does today — these mirror the values that used to be hardcoded.
export const DEFAULT_LOG_ITEMS: LogItemSetting[] = [
  { key: 'bottle', visible: true },
  { key: 'next_feed', visible: true },
  { key: 'vitamin_d', visible: true },
  { key: 'sleep', visible: true },
  { key: 'diaper', visible: true },
  { key: 'weigh_in', visible: true },
  { key: 'pump', visible: true },
  { key: 'direct_breastfeed', visible: false }, // optional feature, off by default
  { key: 'daily_remarks', visible: true },
  { key: 'daycare_import', visible: true },
];

const DEFAULTS: Omit<BabySettings, 'child_id'> = {
  log_items: DEFAULT_LOG_ITEMS,
  bottle_default_substance: 'formula',
  bottle_presets_ml: [120, 150, 180, 210, 240],
  day_start_hour: 7,
  day_end_hour: 23,
  feed_min_interval_h: 3,
  feed_max_interval_h: 4,
  dashboard_visible: {
    intake_today: true,
    formula_pct: true,
    diapers_today: true,
    pumped_24h: true,
    sleep_24h: true,
    chart_intake: true,
    chart_supply: true,
  },
  target_intake_ml_override: null,
};

export const LOG_ITEM_LABELS: Record<LogItemKey, string> = {
  bottle: '🍼 Bottle',
  next_feed: '⏰ Next feed',
  vitamin_d: '💊 Vitamin D',
  direct_breastfeed: '🤱 Direct breastfeed',
  sleep: '😴 Sleep',
  diaper: '💩 Diaper',
  weigh_in: '⚖️ Weigh-in',
  pump: '🥛 Pump',
  daily_remarks: '📝 Daily remarks',
  daycare_import: '🏫 Daycare import',
};

// Items whose own config collapsible in Settings should hide/show along with
// their visibility toggle in Section 1.
export const CONFIGURABLE_LOG_ITEMS: LogItemKey[] = ['bottle', 'next_feed'];

interface DbRow {
  child_id: string;
  log_items: LogItemSetting[] | null;
  bottle_default_substance: FeedSubstance | null;
  bottle_presets_ml: number[] | null;
  day_start_hour: number | null;
  day_end_hour: number | null;
  feed_min_interval_h: number | null;
  feed_max_interval_h: number | null;
  dashboard_visible: Partial<DashboardVisible> | null;
  target_intake_ml_override: number | null;
}

/** DB row (possibly missing fields from an older client) merged over defaults. */
function normalize(childId: string, row: DbRow | null): BabySettings {
  if (!row) return { child_id: childId, ...DEFAULTS };
  const stored = row.log_items?.length ? row.log_items : DEFAULT_LOG_ITEMS;
  // Append any log item added to the app *after* this row was last saved
  // (e.g. a brand-new feature) — otherwise it silently never appears for
  // an account with pre-existing settings, since it's simply absent from
  // their saved array rather than "missing" in a way the fallback above
  // catches.
  const known = new Set(stored.map((i) => i.key));
  const log_items = [...stored, ...DEFAULT_LOG_ITEMS.filter((i) => !known.has(i.key))];
  return {
    child_id: childId,
    log_items,
    bottle_default_substance: row.bottle_default_substance ?? DEFAULTS.bottle_default_substance,
    bottle_presets_ml: row.bottle_presets_ml?.length ? row.bottle_presets_ml : DEFAULTS.bottle_presets_ml,
    day_start_hour: row.day_start_hour ?? DEFAULTS.day_start_hour,
    day_end_hour: row.day_end_hour ?? DEFAULTS.day_end_hour,
    feed_min_interval_h: row.feed_min_interval_h ?? DEFAULTS.feed_min_interval_h,
    feed_max_interval_h: row.feed_max_interval_h ?? DEFAULTS.feed_max_interval_h,
    dashboard_visible: { ...DEFAULTS.dashboard_visible, ...(row.dashboard_visible ?? {}) },
    target_intake_ml_override: row.target_intake_ml_override ?? null,
  };
}

/** Per-baby settings: loads, subscribes to Realtime, and exposes a save(). */
export function useBabySettings(childId: string) {
  const [settings, setSettings] = useState<BabySettings | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase!
      .from('baby_settings').select('*').eq('child_id', childId).maybeSingle();
    setSettings(normalize(childId, data as DbRow | null));
  }, [childId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const ch = supabase!
      .channel(`baby_settings-${childId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'baby_settings', filter: `child_id=eq.${childId}` },
        () => void load())
      .subscribe();
    return () => void supabase!.removeChannel(ch);
  }, [childId, load]);

  async function save(patch: Partial<Omit<BabySettings, 'child_id'>>) {
    const base = settings ?? { child_id: childId, ...DEFAULTS };
    const next = { ...base, ...patch };
    setSettings(next); // optimistic — Realtime will reconcile
    const { error } = await supabase!.from('baby_settings').upsert({ ...next });
    if (error) alert(`Settings save failed: ${error.message}`);
  }

  return {
    settings: settings ?? { child_id: childId, ...DEFAULTS },
    loading: settings === null,
    save,
  };
}
