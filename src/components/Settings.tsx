import { useState } from 'react';
import {
  DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, useSortable, verticalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { FeedSubstance } from '../lib/types';
import {
  LOG_ITEM_LABELS, useBabySettings,
  type BabySettings, type DashboardVisible, type LogItemKey,
} from '../lib/settings';

const INPUT = 'rounded-xl border border-slate-200 p-2.5 text-sm';

export default function Settings({ childId }: { childId: string }) {
  const { settings, loading, save } = useBabySettings(childId);
  // [OPEN FOR INTERPRETATION]: order + default open/closed state of the
  // collapsibles — Logging options open by default (it's the one people
  // reach for most), the rest collapsed.
  const [open, setOpen] = useState({ order: true, bottle: false, nextFeed: false, dashboard: false });

  if (loading) return <p className="pt-8 text-center text-slate-400">Loading…</p>;

  const bottleVisible = settings.log_items.find((i) => i.key === 'bottle')?.visible ?? false;
  const nextFeedVisible = settings.log_items.find((i) => i.key === 'next_feed')?.visible ?? false;

  return (
    <div className="space-y-4 pt-2 pb-8">
      <Collapsible title="Logging options and order" open={open.order}
        onToggle={() => setOpen((o) => ({ ...o, order: !o.order }))}>
        <LogItemsEditor settings={settings} save={save} />
      </Collapsible>

      {/* Section 1 → Section 2/3 linkage: hiding a log item hides its own
       * config collapsible too. */}
      {bottleVisible && (
        <Collapsible title="Bottle feeding config" open={open.bottle}
          onToggle={() => setOpen((o) => ({ ...o, bottle: !o.bottle }))}>
          <BottleConfig settings={settings} save={save} />
        </Collapsible>
      )}

      {nextFeedVisible && (
        <Collapsible title="Next-feed card config" open={open.nextFeed}
          onToggle={() => setOpen((o) => ({ ...o, nextFeed: !o.nextFeed }))}>
          <NextFeedConfig settings={settings} save={save} />
        </Collapsible>
      )}

      <Collapsible title="Dashboard" open={open.dashboard}
        onToggle={() => setOpen((o) => ({ ...o, dashboard: !o.dashboard }))}>
        <DashboardConfig settings={settings} save={save} />
      </Collapsible>
    </div>
  );
}

type Save = (patch: Partial<Omit<BabySettings, 'child_id'>>) => Promise<void>;

function Collapsible({ title, open, onToggle, children }: {
  title: string; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-100 bg-white shadow-sm">
      <button onClick={onToggle}
        className="flex w-full items-center justify-between p-4 text-left text-sm font-bold text-slate-700">
        {title}
        <span className="text-slate-400">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="border-t border-slate-100 p-4">{children}</div>}
    </section>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)} aria-pressed={on}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? 'bg-direct' : 'bg-slate-200'}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
        on ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}

// ---------------------------------------------------- Section 1: order --

function LogItemsEditor({ settings, save }: { settings: BabySettings; save: Save }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const items = settings.log_items;
    const from = items.findIndex((i) => i.key === active.id);
    const to = items.findIndex((i) => i.key === over.id);
    if (from === -1 || to === -1) return;
    void save({ log_items: arrayMove(items, from, to) });
  }

  function setVisible(key: LogItemKey, visible: boolean) {
    void save({
      log_items: settings.log_items.map((i) => (i.key === key ? { ...i, visible } : i)),
    });
  }

  return (
    <div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={settings.log_items.map((i) => i.key)} strategy={verticalListSortingStrategy}>
          <ul className="space-y-1.5">
            {settings.log_items.map((item) => (
              <LogItemRow key={item.key} item={item} onVisibleChange={(v) => setVisible(item.key, v)} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <p className="mt-3 text-xs text-slate-400">
        Drag to reorder the Log tab. Hiding an item also hides its config
        section below, if it has one. Caregivers always stays at the bottom
        of the Log tab and isn't listed here.
      </p>
    </div>
  );
}

function LogItemRow({ item, onVisibleChange }: {
  item: { key: LogItemKey; visible: boolean }; onVisibleChange: (v: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.key });
  return (
    <li ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className="flex items-center gap-2 rounded-xl border border-slate-100 bg-white p-3">
      <button {...attributes} {...listeners} className="cursor-grab touch-none px-1 text-slate-300" aria-label="Drag to reorder">
        ⠿
      </button>
      <span className="flex-1 min-w-0 text-sm font-medium text-slate-600">{LOG_ITEM_LABELS[item.key]}</span>
      <Toggle on={item.visible} onChange={onVisibleChange} />
    </li>
  );
}

// ------------------------------------------------- Section 2: bottle --

function BottleConfig({ settings, save }: { settings: BabySettings; save: Save }) {
  const [presetInput, setPresetInput] = useState('');

  function addPreset() {
    const n = Number(presetInput);
    if (!Number.isInteger(n) || n <= 0) return;
    void save({ bottle_presets_ml: [...settings.bottle_presets_ml, n] });
    setPresetInput('');
  }

  function removePreset(i: number) {
    void save({ bottle_presets_ml: settings.bottle_presets_ml.filter((_, idx) => idx !== i) });
  }

  function movePreset(i: number, dir: -1 | 1) {
    const list = [...settings.bottle_presets_ml];
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    void save({ bottle_presets_ml: list });
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-xs font-semibold text-slate-500">
          Default milk type (pre-selected — the toggle on the log form still switches freely)
        </p>
        <div className="flex gap-2">
          {(['formula', 'breast_milk'] as FeedSubstance[]).map((s) => (
            <button key={s} onClick={() => void save({ bottle_default_substance: s })}
              className={`rounded-xl border px-4 py-2 text-sm font-semibold ${
                settings.bottle_default_substance === s
                  ? 'border-direct bg-direct text-white' : 'border-slate-200 text-slate-500'}`}>
              {s === 'formula' ? 'Formula' : 'Breast milk'}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold text-slate-500">
          mL presets shown on the Bottle card (the custom-amount field always stays too)
        </p>
        <ul className="mb-2 space-y-1.5">
          {settings.bottle_presets_ml.map((ml, i) => (
            <li key={i} className="flex items-center gap-2 rounded-xl border border-slate-100 p-2">
              <span className="flex-1 min-w-0 text-sm font-medium text-slate-600">{ml} mL</span>
              <button onClick={() => movePreset(i, -1)} disabled={i === 0}
                className="px-1.5 text-slate-400 disabled:opacity-30">↑</button>
              <button onClick={() => movePreset(i, 1)} disabled={i === settings.bottle_presets_ml.length - 1}
                className="px-1.5 text-slate-400 disabled:opacity-30">↓</button>
              <button onClick={() => removePreset(i)} className="px-1.5 text-slate-300 hover:text-red-400">✕</button>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2">
          <input inputMode="numeric" placeholder="new preset mL" value={presetInput}
            onChange={(e) => setPresetInput(e.target.value)}
            className={`${INPUT} w-32 text-center`} />
          <button onClick={addPreset}
            className="rounded-xl bg-direct px-3 py-2 text-sm font-semibold text-white">Add</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------- Section 3: next feed --

function NextFeedConfig({ settings, save }: { settings: BabySettings; save: Save }) {
  const [err, setErr] = useState('');

  function saveInterval(min: number, max: number) {
    if (min >= max) return setErr('Minimum interval must be less than the maximum.');
    setErr('');
    void save({ feed_min_interval_h: min, feed_max_interval_h: max });
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-xs font-semibold text-slate-500">
          Countdown active window (also drives the daily "Feed #N" counter)
        </p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-500">From</span>
          <HourSelect value={settings.day_start_hour} onChange={(h) => void save({ day_start_hour: h })} />
          <span className="text-slate-500">to</span>
          <HourSelect value={settings.day_end_hour} onChange={(h) => void save({ day_end_hour: h })} />
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold text-slate-500">Feed interval (hours after the last feed)</p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-500">Earliest</span>
          <input inputMode="decimal" value={settings.feed_min_interval_h}
            onChange={(e) => saveInterval(Number(e.target.value) || 0, settings.feed_max_interval_h)}
            className={`${INPUT} w-16 text-center`} />
          <span className="text-slate-500">Latest</span>
          <input inputMode="decimal" value={settings.feed_max_interval_h}
            onChange={(e) => saveInterval(settings.feed_min_interval_h, Number(e.target.value) || 0)}
            className={`${INPUT} w-16 text-center`} />
        </div>
        {err && <p className="mt-1 text-xs font-semibold text-red-500">{err}</p>}
      </div>
    </div>
  );
}

function HourSelect({ value, onChange }: { value: number; onChange: (h: number) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))} className={INPUT}>
      {Array.from({ length: 24 }, (_, h) => (
        <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
      ))}
    </select>
  );
}

// ------------------------------------------------- Section 4: dashboard --

const DASHBOARD_LABELS: Record<keyof DashboardVisible, string> = {
  intake_today: 'Intake today',
  formula_pct: 'Formula vs breastfeeding %',
  diapers_today: 'Diapers today',
  pumped_24h: 'Pumped (last 24h)',
  sleep_24h: 'Sleep (last 24h)',
  chart_intake: 'Chart: daily intake by source vs target',
  chart_supply: 'Chart: breast-milk supply',
};

function DashboardConfig({ settings, save }: { settings: BabySettings; save: Save }) {
  const [override, setOverride] = useState(settings.target_intake_ml_override?.toString() ?? '');

  function setVisible(key: keyof DashboardVisible, v: boolean) {
    void save({ dashboard_visible: { ...settings.dashboard_visible, [key]: v } });
  }

  function saveOverride() {
    const n = Number(override);
    void save({ target_intake_ml_override: override.trim() && n > 0 ? Math.round(n) : null });
  }

  return (
    <ul className="space-y-1.5">
      {(Object.keys(DASHBOARD_LABELS) as (keyof DashboardVisible)[]).map((key) => (
        <li key={key} className="rounded-xl border border-slate-100 p-3">
          <div className="flex items-center gap-2">
            <span className="flex-1 min-w-0 text-sm font-medium text-slate-600">{DASHBOARD_LABELS[key]}</span>
            <Toggle on={settings.dashboard_visible[key]} onChange={(v) => setVisible(key, v)} />
          </div>
          {/* Deliberately a separate control beneath the visibility toggle,
           * not next to it, so it reads as "this tunes the card" rather than
           * "this is another way to turn it off". */}
          {key === 'intake_today' && (
            <div className="mt-2 border-t border-slate-100 pt-2">
              <label className="text-xs text-slate-400">
                Manual target override (mL/day) — leave blank to use the automatic
                weight-based target
              </label>
              <div className="mt-1 flex items-center gap-2">
                <input inputMode="numeric" placeholder="e.g. 750" value={override}
                  onChange={(e) => setOverride(e.target.value)} onBlur={saveOverride}
                  className={`${INPUT} w-28 text-center`} />
                {settings.target_intake_ml_override != null && (
                  <button onClick={() => { setOverride(''); void save({ target_intake_ml_override: null }); }}
                    className="text-xs text-slate-400 underline">clear</button>
                )}
              </div>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
