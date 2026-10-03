import { useCallback, useEffect, useState } from 'react';
import { fmtDuration } from '../lib/format';
import { supabase } from '../lib/supabase';
import { useBabySettings, type BabySettings, type LogItemKey } from '../lib/settings';
import type { BreastSide, FeedSubstance } from '../lib/types';

/** 3am-friendly logging: the common actions are ≤2 taps; every module can
 * also log retroactively via the "earlier" time picker. */
export default function QuickAdd({ childId }: { childId: string }) {
  const [toast, setToast] = useState('');
  const { settings, loading } = useBabySettings(childId);

  async function insert(table: string, row: Record<string, unknown>, label: string) {
    const { error } = await supabase!.from(table).insert({ child_id: childId, ...row });
    setToast(error ? `⚠ ${error.message}` : `✓ ${label}`);
    setTimeout(() => setToast(''), 2500);
  }

  if (loading) return <p className="pt-8 text-center text-slate-400">Loading…</p>;

  // Also drops any leftover key from a removed feature (e.g. an old
  // notebook_import row still sitting in a baby_settings record) so a
  // stale DB value can't crash the render.
  const visible = settings.log_items.filter((i) => i.visible && i.key in LOG_COMPONENTS);

  return (
    <div className="space-y-5 pt-2">
      {toast && (
        <div className="fixed left-1/2 top-3 z-10 -translate-x-1/2 rounded-full bg-slate-800 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
      {visible.length === 0 && (
        <p className="rounded-2xl border border-slate-100 bg-white p-4 text-center text-sm text-slate-400">
          All log items are hidden — turn some back on in Settings.
        </p>
      )}
      {visible.map((item) => {
        const Comp = LOG_COMPONENTS[item.key];
        return <Comp key={item.key} insert={insert} childId={childId} settings={settings} />;
      })}
      {/* Fixed at the very bottom always — not part of the reorderable list. */}
      <Caregivers childId={childId} />
    </div>
  );
}

type Insert = (table: string, row: Record<string, unknown>, label: string) => void;
type ItemProps = { insert: Insert; childId: string; settings: BabySettings };

const LOG_COMPONENTS: Record<LogItemKey, React.ComponentType<ItemProps>> = {
  bottle: Bottle,
  next_feed: NextFeed,
  vitamin_d: VitaminD,
  paracetamol: Paracetamol,
  next_paracetamol: NextParacetamol,
  direct_breastfeed: Direct,
  sleep: SleepForm,
  last_sleep: LastSleep,
  diaper: DiaperForm,
  weigh_in: GrowthForm,
  pump: PumpForm,
  daily_remarks: DailyRemarks,
  daycare_import: DaycareImport,
};

export function Card({ title, color, children }: {
  title: string; color: string; children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-bold" style={{ color }}>{title}</h2>
      {children}
    </section>
  );
}

export function Chip({ active, onClick, children, color = '#C75B7A' }: {
  active?: boolean; onClick: () => void; children: React.ReactNode; color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-xl border px-4 py-2.5 text-sm font-semibold"
      style={
        active
          ? { background: color, borderColor: color, color: '#fff' }
          : { borderColor: '#e2e8f0', color: '#475569' }
      }
    >
      {children}
    </button>
  );
}

const nowLocal = () =>
  new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

/** "Now" vs an explicit local datetime — value null means "now". */
function WhenPicker({ value, onChange, label = 'When:' }: {
  value: string | null; onChange: (v: string | null) => void; label?: string;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
      <span>{label}</span>
      <button
        onClick={() => onChange(null)}
        className={`rounded-lg border px-2.5 py-1.5 font-semibold ${
          value === null ? 'border-slate-600 bg-slate-600 text-white' : 'border-slate-200'
        }`}
      >
        Now
      </button>
      <button
        onClick={() => value === null && onChange(nowLocal())}
        className={`rounded-lg border px-2.5 py-1.5 font-semibold ${
          value !== null ? 'border-slate-600 bg-slate-600 text-white' : 'border-slate-200'
        }`}
      >
        Earlier…
      </button>
      {value !== null && (
        <input
          type="datetime-local" value={value} max={nowLocal()}
          onChange={(e) => onChange(e.target.value)}
          className="rounded-lg border border-slate-200 p-1.5"
        />
      )}
    </div>
  );
}

/** Event timestamp: the picked time, or now minus an optional offset. */
function tsFrom(when: string | null, offsetMs = 0): string {
  return when ? new Date(when).toISOString() : new Date(Date.now() - offsetMs).toISOString();
}

function Bottle({ insert, settings }: ItemProps) {
  const [substance, setSubstance] = useState<FeedSubstance>(settings.bottle_default_substance);
  const [when, setWhen] = useState<string | null>(nowLocal());
  const [ml, setMl] = useState<number | null>(null);
  const [custom, setCustom] = useState('');
  const color = substance === 'formula' ? '#E8973A' : '#2E86AB';
  const amount = ml ?? Number(custom) ?? 0;

  function save() {
    if (!amount) return;
    insert('feeds', {
      ts: tsFrom(when), delivery: 'bottle', substance, volume_ml: amount,
    }, `bottle ${amount} mL${when ? ' (backdated)' : ''}`);
