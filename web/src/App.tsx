import { useEffect, useState } from "react";
import { clearTerminal, enqueue, enqueueChaos, enqueueDemo, fetchSnapshot } from "./api";
import type { Job, JobStatus, JobType, Snapshot, Stats, WorkerState } from "./types";
import { JOB_TYPES } from "./types";

const EMPTY_STATS: Stats = {
  queued: 0,
  running: 0,
  retrying: 0,
  succeeded: 0,
  dead: 0,
  processed: 0,
  throughputPerMin: 0,
};

export default function App() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [type, setType] = useState<JobType>("email");
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setSnap(await fetchSnapshot());
      setError(null);
      setLive(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Backend unreachable");
      setLive(false);
    }
  }

  useEffect(() => {
    void refresh();
    const es = new EventSource("/api/events");
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    es.onmessage = () => {
      void refresh();
    };
    return () => es.close();
  }, []);

  const stats = snap?.stats ?? EMPTY_STATS;
  const jobs = snap?.jobs ?? [];
  const workers = snap?.workers ?? [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Pulse
            <span className="bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">
              Queue
            </span>
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Watch workers lease jobs, retry with backoff, and dead-letter the ones that never recover.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs font-medium">
          <span
            className={`h-2 w-2 rounded-full ${live ? "bg-emerald-400 shadow-[0_0_8px_#34d399]" : "bg-slate-600"}`}
          />
          <span className="text-slate-400">{live ? "live" : "connecting…"}</span>
        </div>
      </header>

      {error && (
        <p className="mb-4 rounded-lg border border-rose-900 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
          {error}. Locally, start <code>npm run dev</code> in <code>server/</code>. On the live
          site, the process may be waking up — wait a few seconds and refresh.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Queued" value={stats.queued} accent="text-slate-100" />
        <Stat label="Running" value={stats.running} accent="text-amber-300" />
        <Stat label="Retrying" value={stats.retrying} accent="text-orange-300" />
        <Stat label="Succeeded" value={stats.succeeded} accent="text-emerald-300" />
        <Stat label="Dead letter" value={stats.dead} accent="text-rose-300" />
        <Stat label="Jobs / min" value={stats.throughputPerMin} accent="text-sky-300" />
      </div>

      <WorkerStrip workers={workers} />

      <Controls type={type} onType={setType} onRefresh={refresh} />

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_220px]">
        <JobTable jobs={jobs} />
        <Throughput bars={snap?.throughput ?? []} />
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3">
      <div className="text-[11px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${accent}`}>{value}</div>
    </div>
  );
}

function WorkerStrip({ workers }: { workers: WorkerState[] }) {
  if (workers.length === 0) return null;
  return (
    <div className="mt-5 flex flex-wrap gap-2">
      {workers.map((w) => (
        <div
          key={w.id}
          className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${
            w.status === "busy"
              ? "border-amber-700/60 bg-amber-500/10 text-amber-200"
              : "border-slate-800 bg-slate-900/60 text-slate-400"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${w.status === "busy" ? "bg-amber-400" : "bg-slate-600"}`}
          />
          <span className="font-mono">{w.id}</span>
          <span className="text-slate-500">
            {w.status === "busy" && w.jobType ? w.jobType : "idle"}
          </span>
        </div>
      ))}
    </div>
  );
}

function Controls({
  type,
  onType,
  onRefresh,
}: {
  type: JobType;
  onType: (t: JobType) => void;
  onRefresh: () => Promise<void>;
}) {
  async function run(action: () => Promise<void>) {
    await action();
    await onRefresh();
  }

  return (
    <div className="mt-5 flex flex-wrap items-center gap-2">
      <select
        value={type}
        onChange={(e) => onType(e.target.value as JobType)}
        className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-amber-500"
      >
        {JOB_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <button
        onClick={() => void run(() => enqueue(type, 1))}
        className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-400"
      >
        Enqueue 1
      </button>
      <button
        onClick={() => void run(() => enqueue(type, 8))}
        className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm hover:border-amber-600"
      >
        Enqueue 8
      </button>
      <button
        onClick={() => void run(enqueueDemo)}
        className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm hover:border-amber-600"
      >
        Demo load
      </button>
      <button
        onClick={() => void run(enqueueChaos)}
        className="rounded-lg border border-orange-800 bg-orange-950/40 px-3 py-2 text-sm text-orange-200 hover:border-orange-500"
      >
        Chaos (flaky)
      </button>
      <button
        onClick={() => void run(clearTerminal)}
        className="rounded-lg px-3 py-2 text-sm text-slate-400 hover:text-slate-200"
      >
        Clear finished
      </button>
    </div>
  );
}

const STATUS_STYLE: Record<JobStatus, string> = {
  queued: "bg-slate-800 text-slate-300",
  running: "bg-amber-500/15 text-amber-300",
  succeeded: "bg-emerald-500/15 text-emerald-300",
  dead: "bg-rose-500/15 text-rose-300",
};

const TYPE_STYLE: Record<JobType, string> = {
  email: "text-sky-300",
  invoice: "text-violet-300",
  thumbnail: "text-teal-300",
  flaky: "text-orange-300",
};

function JobTable({ jobs }: { jobs: Job[] }) {
  if (jobs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-800 px-6 py-16 text-center text-sm text-slate-500">
        Queue is empty. Hit <span className="text-amber-400">Demo load</span> to watch four workers chew through a mixed batch.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-800">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-900/80 text-[11px] uppercase tracking-wider text-slate-500">
          <tr>
            <th className="px-3 py-2 font-medium">Job</th>
            <th className="px-3 py-2 font-medium">Type</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Attempts</th>
            <th className="px-3 py-2 font-medium">Worker</th>
            <th className="px-3 py-2 font-medium">Duration</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/80">
          {jobs.slice(0, 40).map((job) => (
            <tr key={job.id} className="bg-slate-900/40">
              <td className="px-3 py-2">
                <div className="font-mono text-xs text-slate-300">{job.id}</div>
                <div className="max-w-[180px] truncate text-[11px] text-slate-500" title={job.error ?? job.payload}>
                  {job.error ?? job.payload}
                </div>
              </td>
              <td className={`px-3 py-2 font-medium ${TYPE_STYLE[job.type]}`}>{job.type}</td>
              <td className="px-3 py-2">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[job.status]}`}>
                  {job.status}
                </span>
              </td>
              <td className="px-3 py-2">
                <Attempts attempts={job.attempts} max={job.maxAttempts} />
              </td>
              <td className="px-3 py-2 font-mono text-xs text-slate-400">{job.workerId ?? "—"}</td>
              <td className="px-3 py-2 tabular-nums text-xs text-slate-400">
                {job.durationMs != null ? `${job.durationMs} ms` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Attempts({ attempts, max }: { attempts: number; max: number }) {
  return (
    <div className="flex gap-1" title={`${attempts}/${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <span
          key={i}
          className={`h-1.5 w-3 rounded-sm ${i < attempts ? "bg-amber-400" : "bg-slate-700"}`}
        />
      ))}
    </div>
  );
}

function Throughput({ bars }: { bars: number[] }) {
  const max = Math.max(1, ...bars);

  return (
    <aside className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <div className="text-[11px] uppercase tracking-wider text-slate-500">Throughput · 60s</div>
      <div className="mt-4 flex h-36 items-end gap-1">
        {bars.map((n, i) => (
          <div
            key={i}
            className="flex-1 rounded-t-sm bg-amber-400/80"
            style={{ height: `${Math.max(6, (n / max) * 100)}%`, opacity: n === 0 ? 0.2 : 1 }}
          />
        ))}
      </div>
      <p className="mt-3 text-[11px] text-slate-500">Each bar is ~2.5 seconds of completed jobs.</p>
    </aside>
  );
}
