import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { FeedSubstance } from '../lib/types';
import NotebookImport from './NotebookImport';

/** 3am-friendly logging: the common actions are ≤2 taps; every module can
 * also log retroactively via the "earlier" time picker. */
export default function QuickAdd({ childId }: { childId: string }) {
  const [toast, setToast] = useState('');

  async function insert(table: string, row: Record<string, unknown>, label: string) {
    const { error } = await supabase!.from(table).insert({ child_id: childId, ...row });
    setToast(error ? `⚠ ${error.message}` : `✓ ${label}`);
    setTimeout(() => setToast(''), 2500);
  }

  return (
    <div className="space-y-5 pt-2">
      {toast && (
        <div className="fixed left-1/2 top-3 z-10 -translate-x-1/2 rounded-full bg-slate-800 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
      <Bottle insert={insert} />
      <NextFeed childId={childId} />
      <SleepForm insert={insert} />
      <Caregivers childId={childId} />
      <DiaperForm insert={insert} />
      <GrowthForm insert={insert} />
      <PumpForm insert={insert} />
      <NotebookImport childId={childId} />
    </div>
  );
}

type Insert = (table: string, row: Record<string, unknown>, label: string) => void;

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

function Bottle({ insert }: { insert: Insert }) {
  const [substance, setSubstance] = useState<FeedSubstance>('formula');
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
    setMl(null);
    setCustom('');
  }

  return (
    <Card title="🍼 Bottle" color={color}>
      <div className="mb-3 flex gap-2">
        <Chip color="#E8973A" active={substance === 'formula'}
          onClick={() => setSubstance('formula')}>Formula</Chip>
        <Chip color="#2E86AB" active={substance === 'breast_milk'}
          onClick={() => setSubstance('breast_milk')}>Breast milk</Chip>
      </div>
      <WhenPicker value={when} onChange={setWhen} />
      {/* Picking an amount only selects it — nothing is logged until Save,
       * so fixing the time afterward doesn't leave a stray earlier entry. */}
      <div className="flex flex-wrap items-center gap-2">
        {[120, 150, 180, 210, 240].map((v) => (
          <Chip key={v} color={color} active={ml === v}
            onClick={() => { setMl(v); setCustom(''); }}>{v} mL</Chip>
        ))}
        <input inputMode="numeric" placeholder="custom mL" value={custom}
          onChange={(e) => { setCustom(e.target.value); setMl(null); }}
          className="w-24 rounded-xl border border-slate-200 p-2.5 text-center text-sm" />
        <Chip color={color} onClick={save}>Save{amount ? ` ${amount} mL` : ''}</Chip>
      </div>
    </Card>
  );
}

// Feeding window: a feed is due 3-4h after the last one, tracked only during
// waking hours — overnight gaps naturally run longer and aren't "overdue".
const DAY_START_HOUR = 7;
const DAY_END_HOUR = 23;
const FEED_MIN_H = 3;
const FEED_MAX_H = 4;

const isDaytime = (d: Date) => d.getHours() >= DAY_START_HOUR && d.getHours() < DAY_END_HOUR;

function todayWindow(d: Date) {
  const start = new Date(d); start.setHours(DAY_START_HOUR, 0, 0, 0);
  const end = new Date(d); end.setHours(DAY_END_HOUR, 0, 0, 0);
  return { start, end };
}

/** ms → "1h 10m" / "45m", for the countdown / overdue display. */
function fmtDuration(ms: number) {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Countdown to the next feed (3-4h after the last one) plus which feed-of-
 * the-day it'll be, counting within the 07:00-23:00 window only. */
function NextFeed({ childId }: { childId: string }) {
  const [lastFeedTs, setLastFeedTs] = useState<string | null>();
  const [todayCount, setTodayCount] = useState(0);
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    const { start, end } = todayWindow(new Date());
    const [last, today] = await Promise.all([
      supabase!.from('feeds').select('ts').eq('child_id', childId)
        .order('ts', { ascending: false }).limit(1),
      supabase!.from('feeds').select('id', { count: 'exact', head: true })
        .eq('child_id', childId).gte('ts', start.toISOString()).lte('ts', end.toISOString()),
    ]);
    setLastFeedTs(last.data?.[0]?.ts ?? null);
    setTodayCount(today.count ?? 0);
  }, [childId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const ch = supabase!
      .channel(`nextfeed-${childId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'feeds', filter: `child_id=eq.${childId}` },
        () => void load())
      .subscribe();
    return () => void supabase!.removeChannel(ch);
  }, [childId, load]);

  // tick the countdown forward without re-querying the database
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  if (lastFeedTs === undefined) return null; // still loading

  const now = new Date();
  const daytime = isDaytime(now);

  let status: React.ReactNode;
  if (!lastFeedTs) {
    status = <p className="text-sm text-slate-500">No feeds logged yet.</p>;
  } else if (!daytime) {
    status = (
      <p className="text-sm text-slate-500">
        Last feed at {new Date(lastFeedTs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </p>
    );
  } else {
    const last = +new Date(lastFeedTs);
    const earliest = last + FEED_MIN_H * 3600_000;
    const latest = last + FEED_MAX_H * 3600_000;
    const nowMs = +now;
    if (nowMs < earliest) {
      status = (
        <p className="text-sm text-slate-600">
          Next feed in{' '}
          <span className="font-bold">
            {fmtDuration(earliest - nowMs)} – {fmtDuration(latest - nowMs)}
          </span>
        </p>
      );
    } else if (nowMs < latest) {
      status = (
        <p className="text-sm font-semibold text-emerald-600">
          Feed window open — closes in {fmtDuration(latest - nowMs)}
        </p>
      );
    } else {
      status = (
        <p className="text-sm font-bold text-red-600">
          Overdue by {fmtDuration(nowMs - latest)}
        </p>
      );
    }
  }

  return (
    <Card title="⏰ Next feed" color="#C75B7A">
      {status}
      {daytime && (
        <p className="mt-1 text-xs text-slate-400">
          Feed #{todayCount + 1} today (07:00–23:00)
        </p>
      )}
    </Card>
  );
}

/** List of everyone with logging access to this baby (co-parents / caregivers). */
function Caregivers({ childId }: { childId: string }) {
  const [emails, setEmails] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase!.rpc('list_caregivers', { child: childId }).then(({ data, error }) => {
      if (cancelled) return;
      setEmails(error ? [] : ((data ?? []) as { email: string }[]).map((r) => r.email));
    });
    return () => { cancelled = true; };
  }, [childId]);

  return (
    <Card title="👪 Caregivers" color="#7A6FB3">
      {emails === null ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : emails.length === 0 ? (
        <p className="text-sm text-slate-400">No caregivers found.</p>
      ) : (
        <ul className="space-y-1 text-sm text-slate-600">
          {emails.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}
    </Card>
  );
}

function PumpForm({ insert }: { insert: Insert }) {
  const [left, setLeft] = useState('');
  const [right, setRight] = useState('');
  const [when, setWhen] = useState<string | null>(null);
  const total = (Number(left) || 0) + (Number(right) || 0);
  return (
    <Card title="🥛 Pump" color="#2E86AB">
      <WhenPicker value={when} onChange={setWhen} />
      <div className="flex items-center gap-2">
        <input inputMode="numeric" placeholder="L mL" value={left}
          onChange={(e) => setLeft(e.target.value)}
          className="w-20 rounded-xl border border-slate-200 p-2.5 text-center" />
        <input inputMode="numeric" placeholder="R mL" value={right}
          onChange={(e) => setRight(e.target.value)}
          className="w-20 rounded-xl border border-slate-200 p-2.5 text-center" />
        <Chip color="#2E86AB" onClick={() => {
          if (!total) return;
          insert('pumps', {
            ts: tsFrom(when),
            left_ml: Number(left) || null, right_ml: Number(right) || null, total_ml: total,
          }, `pumped ${total} mL${when ? ' (backdated)' : ''}`);
          setLeft(''); setRight('');
        }}>Save {total > 0 ? `${total} mL` : ''}</Chip>
      </div>
    </Card>
  );
}

function DiaperForm({ insert }: { insert: Insert }) {
  const [when, setWhen] = useState<string | null>(null);
  const log = (wet: boolean, dirty: boolean, label: string) =>
    insert('diapers', { ts: tsFrom(when), wet, dirty },
      `${label}${when ? ' (backdated)' : ''}`);
  return (
    <Card title="💩 Diaper" color="#8B6F47">
      <WhenPicker value={when} onChange={setWhen} />
      <div className="flex flex-wrap gap-2">
        <Chip color="#4C9BD4" onClick={() => log(true, false, 'wet diaper')}>Wet</Chip>
        <Chip color="#8B6F47" onClick={() => log(false, true, 'dirty diaper')}>Dirty</Chip>
        <Chip color="#6B5E3C" onClick={() => log(true, true, 'wet + dirty')}>Both</Chip>
      </div>
    </Card>
  );
}

function SleepForm({ insert }: { insert: Insert }) {
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  return (
    <Card title="😴 Sleep" color="#7A6FB3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Chip color="#7A6FB3" onClick={() =>
          insert('sleeps', { start_ts: new Date().toISOString(), end_ts: null }, 'sleep started')
        }>Falling asleep now</Chip>
        <span className="text-slate-400">or</span>
        <input type="datetime-local" value={start} max={nowLocal()}
          onChange={(e) => setStart(e.target.value)}
          className="rounded-xl border border-slate-200 p-2" />
        <span className="text-slate-400">→</span>
        <input type="datetime-local" value={end} max={nowLocal()}
          onChange={(e) => setEnd(e.target.value)}
          className="rounded-xl border border-slate-200 p-2" />
        <Chip color="#7A6FB3" onClick={() => {
          if (!start || !end) return;
          insert('sleeps', {
            start_ts: new Date(start).toISOString(), end_ts: new Date(end).toISOString(),
          }, 'sleep logged');
          setStart(''); setEnd('');
        }}>Save</Chip>
      </div>
      <p className="mt-2 text-xs text-slate-400">
        "Falling asleep now" starts an open sleep — end it from the Timeline.
      </p>
    </Card>
  );
}

function GrowthForm({ insert }: { insert: Insert }) {
  const [kg, setKg] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  return (
    <Card title="⚖️ Weigh-in" color="#66BB6A">
      <div className="flex flex-wrap items-center gap-2">
        <input inputMode="decimal" placeholder="kg (e.g. 3.42)" value={kg}
          onChange={(e) => setKg(e.target.value)}
          className="w-32 rounded-xl border border-slate-200 p-2.5" />
        <input type="date" value={date} max={new Date().toISOString().slice(0, 10)}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-xl border border-slate-200 p-2.5 text-sm" />
        <Chip color="#66BB6A" onClick={() => {
          const v = Number(kg.replace(',', '.'));
          if (!v || v < 1 || v > 30) return;
          insert('growth', {
            measured_at: date,
            weight_g: Math.round(v * 1000),
          }, `${v} kg — target updates`);
          setKg('');
        }}>Save</Chip>
      </div>
    </Card>
  );
}
