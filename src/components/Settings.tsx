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
  const [open, setOpen] = useState({
    order: true, bottle: false, nextFeed: false, paracetamol: false, dashboard: false,
  });

  if (loading) return <p className="pt-8 text-center text-slate-400">Loading…</p>;

  const bottleVisible = settings.log_items.find((i) => i.key === 'bottle')?.visible ?? false;
  const nextFeedVisible = settings.log_items.find((i) => i.key === 'next_feed')?.visible ?? false;
  const paracetamolVisible = settings.log_items.find((i) => i.key === 'paracetamol')?.visible ?? false;

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

      {paracetamolVisible && (
        <Collapsible title="Paracetamol config" open={open.paracetamol}
          onToggle={() => setOpen((o) => ({ ...o, paracetamol: !o.paracetamol }))}>
          <ParacetamolConfig settings={settings} save={save} />
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

// Pill button, same look as Chip elsewhere in the app — a plain inline
// button (not an absolutely-positioned slider) so it can't visually
// overflow its row the way the old iOS-style switch did.
function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)} aria-pressed={on}
      className={`shrink-0 rounded-xl border px-3 py-1.5 text-xs font-semibold ${
        on ? 'border-direct bg-direct text-white' : 'border-slate-200 text-slate-400'}`}>
      {on ? 'Visible' : 'Hidden'}
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
