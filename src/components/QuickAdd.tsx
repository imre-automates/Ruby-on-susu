import { useCallback, useEffect, useState } from 'react';
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
  direct_breastfeed: Direct,
  sleep: SleepForm,
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
        {settings.bottle_presets_ml.map((v) => (
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

/** ms → "1h 10m" / "45m", for the countdown / overdue display. */
function fmtDuration(ms: number) {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Countdown to the next feed (settings.feed_min/max_interval_h after the
 * last one) plus which feed-of-the-day it'll be, counting within the
 * settings.day_start/end_hour window only. */
function NextFeed({ childId, settings }: ItemProps) {
  const [lastFeedTs, setLastFeedTs] = useState<string | null>();
  const [todayCount, setTodayCount] = useState(0);
  const [, setTick] = useState(0);
  const { day_start_hour: dayStart, day_end_hour: dayEnd,
    feed_min_interval_h: minH, feed_max_interval_h: maxH } = settings;

  const isDaytime = useCallback(
    (d: Date) => d.getHours() >= dayStart && d.getHours() < dayEnd,
    [dayStart, dayEnd],
  );

  const load = useCallback(async () => {
    const now = new Date();
    const start = new Date(now); start.setHours(dayStart, 0, 0, 0);
    const end = new Date(now); end.setHours(dayEnd, 0, 0, 0);
    const [last, today] = await Promise.all([
      supabase!.from('feeds').select('ts').eq('child_id', childId)
        .order('ts', { ascending: false }).limit(1),
      supabase!.from('feeds').select('id', { count: 'exact', head: true })
        .eq('child_id', childId).gte('ts', start.toISOString()).lte('ts', end.toISOString()),
    ]);
    setLastFeedTs(last.data?.[0]?.ts ?? null);
    setTodayCount(today.count ?? 0);
  }, [childId, dayStart, dayEnd]);

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
    const earliest = last + minH * 3600_000;
    const latest = last + maxH * 3600_000;
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
          Feed #{todayCount + 1} today ({String(dayStart).padStart(2, '0')}:00–{String(dayEnd).padStart(2, '0')}:00)
        </p>
      )}
    </Card>
  );
}

// ---- nursing timer (per-side, pause, switch) — optional, hidden by default
interface NurseSeg { side: 'L' | 'R'; start: number; end: number | null }
const NURSE_KEY = 'babytracker.nurse.timer';

function loadNurseSegs(): NurseSeg[] {
  try {
    return JSON.parse(localStorage.getItem(NURSE_KEY) ?? '[]') as NurseSeg[];
  } catch {
    return [];
  }
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function Direct({ insert }: ItemProps) {
  const [segs, setSegs] = useState<NurseSeg[]>(loadNurseSegs);
  const [, setTick] = useState(0);
  const running = segs.find((s) => s.end === null);

  // survive tab switches / phone lock / accidental reloads (per device)
  useEffect(() => {
    localStorage.setItem(NURSE_KEY, JSON.stringify(segs));
  }, [segs]);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  const elapsed = (side: 'L' | 'R') =>
    segs.filter((s) => s.side === side)
      .reduce((ms, s) => ms + (s.end ?? Date.now()) - s.start, 0);
  const total = elapsed('L') + elapsed('R');

  function tap(side: 'L' | 'R') {
    setSegs((prev) => {
      const open = prev.find((s) => s.end === null);
      const closed = prev.map((s) => (s.end === null ? { ...s, end: Date.now() } : s));
      return open?.side === side
        ? closed // tapped the running side → pause
        : [...closed, { side, start: Date.now(), end: null }]; // start / switch
    });
  }

  function saveTimer() {
    if (total < 1000 || segs.length === 0) return;
    const min = Math.max(1, Math.round(total / 60000));
    const l = elapsed('L') > 0;
    const r = elapsed('R') > 0;
    insert('feeds', {
      ts: new Date(Math.min(...segs.map((s) => s.start))).toISOString(),
      delivery: 'breast', substance: 'breast_milk', duration_min: min,
      side: l && r ? 'both' : l ? 'L' : 'R',
    }, `${min} min at breast`);
    setSegs([]);
  }

  const sideBtn = (side: 'L' | 'R', label: string) => {
    const active = running?.side === side;
    return (
      <button
        onClick={() => tap(side)}
        className="flex-1 rounded-2xl border p-4 text-center"
        style={active
          ? { background: '#C75B7A', borderColor: '#C75B7A', color: '#fff' }
          : { borderColor: '#e2e8f0', color: '#475569' }}
      >
        <span className="block text-sm font-bold">{active ? `⏸ ${label}` : `▶ ${label}`}</span>
        <span className="block text-xl font-bold tabular-nums">{mmss(elapsed(side))}</span>
      </button>
    );
  };

  return (
    <Card title="🤱 Direct breastfeed" color="#C75B7A">
      <div className="flex gap-2">
        {sideBtn('L', 'Left')}
        {sideBtn('R', 'Right')}
      </div>
      {segs.length > 0 && (
        <div className="mt-3 flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-600">
            {running ? '● nursing' : '⏸ paused'} · {mmss(total)}
          </span>
          <Chip onClick={saveTimer}>Save feed</Chip>
          <button className="text-sm text-slate-400 underline"
            onClick={() => confirm('Discard this timer?') && setSegs([])}>
            discard
          </button>
        </div>
      )}
      <p className="mt-2 text-xs text-slate-400">
        Tap a side to start; tap the other side to switch; tap again to pause.
        The timer survives switching apps.
      </p>
      <RetroDirect insert={insert} />
    </Card>
  );
}

/** Collapsible manual entry for past direct feeds (the pre-timer flow). */
function RetroDirect({ insert }: { insert: Insert }) {
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<BreastSide>('both');
  const [when, setWhen] = useState<string | null>(null);
  const log = (min: number) =>
    insert('feeds', {
      // picked time = feed START; "now" mode backdates by the duration
      ts: tsFrom(when, min * 60000),
      delivery: 'breast', substance: 'breast_milk', duration_min: min, side,
    }, `${min} min at breast${when ? ' (backdated)' : ''}`);
  if (!open) {
    return (
      <button className="mt-2 text-xs text-slate-400 underline" onClick={() => setOpen(true)}>
        or log a past feed without the timer
      </button>
    );
  }
  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      <div className="mb-3 flex gap-2">
        {(['L', 'both', 'R'] as BreastSide[]).map((s) => (
          <Chip key={s} active={side === s} onClick={() => setSide(s)}>
            {s === 'both' ? 'Both' : s}
          </Chip>
        ))}
      </div>
      <WhenPicker value={when} onChange={setWhen} label="Started:" />
      <div className="flex flex-wrap gap-2">
        {[10, 15, 20, 30, 45].map((min) => (
          <Chip key={min} onClick={() => log(min)}>{min} min</Chip>
        ))}
        <CustomNumber unit="min" onSubmit={log} />
      </div>
    </div>
  );
}

type DaycareRow =
  | { type: 'sleep'; start: string; end: string }
  | { type: 'feed'; time: string; ml: string };

const FEED_ML_MIN = 30;
const FEED_ML_MAX = 400;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

interface ParsedRow {
  kind: 'sleep' | 'feed';
  start: string | null;
  end: string | null;
  time: string | null;
  ml: number | null;
}

/** Batch entry for a daycare's end-of-day summary — add a row per sleep or
 * feed (typed manually, or pre-filled by uploading a screenshot), fix any
 * flagged values, then one Save for everything at once. Nothing writes
 * until Save; picking/typing/uploading never logs on its own. */
function DaycareImport({ insert }: ItemProps) {
  const [rows, setRows] = useState<DaycareRow[]>([]);
  const [parsing, setParsing] = useState(false);
  const [parseMsg, setParseMsg] = useState('');

  function updateRow(i: number, patch: Partial<DaycareRow>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } as DaycareRow : r)));
  }
  function removeRow(i: number) {
    setRows((rs) => rs.filter((_, idx) => idx !== i));
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // lets the same file be picked again later
    if (!file) return;
    setParsing(true);
    setParseMsg('');
    try {
      const image = await fileToBase64(file);
      const { data: { session } } = await supabase!.auth.getSession();
      const resp = await fetch('/api/parse-daycare', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify({ image, mediaType: file.type || 'image/jpeg' }),
      });
      const result = await resp.json();
      if (!resp.ok) {
        setParseMsg(`⚠ ${result.error ?? 'Parse failed'}`);
        return;
      }
      const today = new Date().toISOString().slice(0, 10);
      const parsed: DaycareRow[] = ((result.rows ?? []) as ParsedRow[])
        .map((r): DaycareRow | null => (
          r.kind === 'sleep' && r.start && r.end
            ? { type: 'sleep', start: `${today}T${r.start}`, end: `${today}T${r.end}` }
            : r.kind === 'feed' && r.time && r.ml != null
              ? { type: 'feed', time: `${today}T${r.time}`, ml: String(r.ml) }
              : null
        ))
        .filter((r): r is DaycareRow => r !== null);
      setRows((rs) => [...rs, ...parsed]);
      // "fewer or more rows than expected → surface it, don't guess": we
      // don't know the expected count, so just always show what came back
      // and let a glance at the screenshot confirm nothing's missing.
      const warnings = (result.warnings ?? []) as string[];
      setParseMsg(
        `✓ Parsed ${parsed.length} row${parsed.length === 1 ? '' : 's'} — review before saving.` +
        (warnings.length ? ` ${warnings.length} thing${warnings.length === 1 ? '' : 's'} to check: ${warnings.join('; ')}` : ''),
      );
    } catch {
      setParseMsg('⚠ Upload failed — try again');
    } finally {
      setParsing(false);
    }
  }

  function saveAll() {
    const valid = rows.filter((r) =>
      r.type === 'sleep' ? r.start && r.end : r.time && Number(r.ml) > 0);
    if (!valid.length) return;
    for (const r of valid) {
      if (r.type === 'sleep') {
        insert('sleeps', {
          start_ts: new Date(r.start).toISOString(),
          end_ts: new Date(r.end).toISOString(),
        }, 'daycare sleep logged');
      } else {
        insert('feeds', {
          ts: new Date(r.time).toISOString(),
          delivery: 'bottle', substance: 'formula', volume_ml: Number(r.ml),
        }, 'daycare feed logged');
      }
    }
    setRows(rows.length === valid.length ? [] : rows.filter((r) => !valid.includes(r)));
  }

  const badFeed = (ml: string) => {
    const n = Number(ml);
    return n > 0 && (n < FEED_ML_MIN || n > FEED_ML_MAX);
  };
  const badSleep = (start: string, end: string) =>
    !!start && !!end && new Date(end) <= new Date(start);

  return (
    <Card title="🏫 Daycare import" color="#8B6F47">
      <p className="mb-3 text-xs text-slate-400">
        Upload a screenshot of the daycare's summary to pre-fill rows below,
        or add them manually — either way, nothing saves until you tap Save.
        Flagged values (in red) still save; double-check them first.
      </p>
      <div className="mb-3">
        <label className={`inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed px-3 py-2 text-xs font-semibold ${
          parsing ? 'border-slate-200 text-slate-300' : 'border-slate-300 text-slate-500'}`}>
          {parsing ? 'Reading…' : '📷 Upload daycare screenshot'}
          <input type="file" accept="image/*" capture="environment" className="hidden"
            onChange={(e) => void handleUpload(e)} disabled={parsing} />
        </label>
        {parseMsg && <p className="mt-1.5 text-xs text-slate-500">{parseMsg}</p>}
      </div>
      {rows.length > 0 && (
        <ul className="mb-3 space-y-2">
          {rows.map((r, i) => {
            const flagged = r.type === 'sleep'
              ? badSleep(r.start, r.end)
              : badFeed(r.ml);
            return (
              <li key={i} className={`rounded-xl border p-2.5 ${
                flagged ? 'border-red-300 bg-red-50' : 'border-slate-100'}`}>
                {r.type === 'sleep' ? (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span>😴</span>
                    <input type="datetime-local" value={r.start}
                      onChange={(e) => updateRow(i, { start: e.target.value })}
                      className="rounded-lg border border-slate-200 p-1.5 text-xs" />
                    <span className="text-slate-400">→</span>
                    <input type="datetime-local" value={r.end}
                      onChange={(e) => updateRow(i, { end: e.target.value })}
                      className="rounded-lg border border-slate-200 p-1.5 text-xs" />
                    <button onClick={() => removeRow(i)}
                      className="ml-auto px-1.5 text-slate-300 hover:text-red-400">✕</button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span>🍼</span>
                    <input type="datetime-local" value={r.time}
                      onChange={(e) => updateRow(i, { time: e.target.value })}
                      className="rounded-lg border border-slate-200 p-1.5 text-xs" />
                    <input inputMode="numeric" placeholder="mL" value={r.ml}
                      onChange={(e) => updateRow(i, { ml: e.target.value })}
                      className="w-16 rounded-lg border border-slate-200 p-1.5 text-center text-xs" />
                    <button onClick={() => removeRow(i)}
                      className="ml-auto px-1.5 text-slate-300 hover:text-red-400">✕</button>
                  </div>
                )}
                {flagged && (
                  <p className="mt-1 text-xs font-semibold text-red-500">
                    {r.type === 'sleep' ? 'End is before start' : `Outside ${FEED_ML_MIN}–${FEED_ML_MAX} mL`}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Chip color="#7A6FB3" onClick={() => setRows((rs) => [...rs, { type: 'sleep', start: '', end: '' }])}>
          + Sleep row
        </Chip>
        <Chip color="#2E86AB" onClick={() => setRows((rs) => [...rs, { type: 'feed', time: '', ml: '' }])}>
          + Feed row
        </Chip>
        {rows.length > 0 && (
          <Chip color="#8B6F47" onClick={saveAll}>Save all ({rows.length})</Chip>
        )}
      </div>
    </Card>
  );
}

interface Remark {
  id: string;
  remark_date: string;
  text: string;
  created_at: string;
  email: string;
}

/** Freestanding shared journal — not attached to individual log entries.
 * Both parents can add short remarks to a given date; shown chronologically
 * with who wrote what. */
function DailyRemarks({ childId, insert }: ItemProps) {
  const [remarks, setRemarks] = useState<Remark[] | null>(null);
  const [text, setText] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));

  const load = useCallback(async () => {
    const { data, error } = await supabase!.rpc('list_remarks', { child: childId });
    setRemarks(error ? [] : (data as Remark[]));
  }, [childId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const ch = supabase!
      .channel(`remarks-${childId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'daily_remarks', filter: `child_id=eq.${childId}` },
        () => void load())
      .subscribe();
    return () => void supabase!.removeChannel(ch);
  }, [childId, load]);

  function save() {
    if (!text.trim()) return;
    insert('daily_remarks', { remark_date: date, text: text.trim() }, 'remark added');
    setText('');
  }

  return (
    <Card title="📝 Daily remarks" color="#7A6FB3">
      <div className="mb-2">
        <input type="date" value={date} max={new Date().toISOString().slice(0, 10)}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-xl border border-slate-200 p-2 text-sm" />
      </div>
      <div className="mb-3 flex items-center gap-2">
        <input value={text} placeholder="Add a remark…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          className="min-w-0 flex-1 rounded-xl border border-slate-200 p-2.5 text-sm" />
        <Chip onClick={save}>Save</Chip>
      </div>
      {remarks === null ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : remarks.length === 0 ? (
        <p className="text-sm text-slate-400">No remarks yet.</p>
      ) : (
        <ul className="max-h-64 space-y-2 overflow-y-auto">
          {remarks.map((r) => (
            <li key={r.id} className="border-t border-slate-100 pt-2 text-sm">
              <div className="min-w-0 break-words text-slate-600">{r.text}</div>
              <div className="text-xs text-slate-400">{r.remark_date} · {r.email}</div>
            </li>
          ))}
        </ul>
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

function PumpForm({ insert }: ItemProps) {
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

function DiaperForm({ insert }: ItemProps) {
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

function SleepForm({ insert }: ItemProps) {
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
          // End is optional: start alone still saves — an open sleep with a
          // backdated start (the common case: baby actually fell asleep a
          // few minutes before you got to open the app).
          if (!start) return;
          if (end && new Date(end) <= new Date(start)) {
            return alert('End must be after start.');
          }
          insert('sleeps', {
            start_ts: new Date(start).toISOString(),
            end_ts: end ? new Date(end).toISOString() : null,
          }, end ? 'sleep logged' : 'sleep started (backdated)');
          setStart(''); setEnd('');
        }}>Save</Chip>
      </div>
      <p className="mt-2 text-xs text-slate-400">
        "Falling asleep now" starts an open sleep at the current time. To
        backdate the start (baby fell asleep a few minutes ago), set just a
        start time below and Save, leaving end blank — end it later from the
        Timeline.
      </p>
    </Card>
  );
}

function GrowthForm({ insert }: ItemProps) {
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

function CustomNumber({ unit, onSubmit }: { unit: string; onSubmit: (n: number) => void }) {
  const [v, setV] = useState('');
  return (
    <span className="inline-flex items-center gap-1">
      <input inputMode="numeric" placeholder={`custom ${unit}`} value={v}
        onChange={(e) => setV(e.target.value)}
        className="w-24 rounded-xl border border-slate-200 p-2.5 text-center text-sm" />
      <button className="text-sm font-semibold text-slate-500 underline"
        onClick={() => { const n = Number(v); if (n > 0) { onSubmit(n); setV(''); } }}>
        ok
      </button>
    </span>
  );
}
