import { JOB_TYPES, type Job, type JobType, type QueueEvent, type Snapshot, type Stats, type WorkerState } from "./types.js";

export interface JobQueueOptions {
  now?: () => number;
  /** Max jobs retained. Oldest terminal jobs are dropped first. */
  keep?: number;
  /** Base delay in ms; actual delay is base * 2^(attempts-1). */
  backoffBaseMs?: number;
}

function cloneJob(job: Job): Job {
  return { ...job };
}

function defaultPayload(type: JobType, seq: number): string {
  switch (type) {
    case "email":
      return `user${seq}@example.com`;
    case "invoice":
      return `INV-${1000 + seq}`;
    case "thumbnail":
      return `img_${seq.toString(16)}.png`;
    case "flaky":
      return `partner-call-${seq}`;
  }
}

/**
 * In-memory job queue with lease/complete/fail, exponential backoff, and a
 * dead-letter path. No HTTP or timers — the clock is injected so retry
 * scheduling is unit-testable.
 */
export class JobQueue {
  private readonly jobs = new Map<string, Job>();
  private readonly order: string[] = [];
  private readonly listeners = new Set<(event: QueueEvent) => void>();
  private readonly completions: number[] = [];
  private workers: WorkerState[] = [];
  private seq = 0;
  private readonly clock: () => number;
  private readonly keep: number;
  private readonly backoffBaseMs: number;

  constructor(opts: JobQueueOptions = {}) {
    this.clock = opts.now ?? Date.now;
    this.keep = opts.keep ?? 180;
    this.backoffBaseMs = opts.backoffBaseMs ?? 200;
  }

  subscribe(listener: (event: QueueEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  enqueue(input: { type: JobType; payload?: string; maxAttempts?: number }): Job {
    const now = this.clock();
    this.seq += 1;
    const job: Job = {
      id: `job_${String(this.seq).padStart(3, "0")}`,
      type: input.type,
      payload: input.payload ?? defaultPayload(input.type, this.seq),
      status: "queued",
      attempts: 0,
      maxAttempts: input.maxAttempts ?? 3,
      workerId: null,
      error: null,
      createdAt: now,
      startedAt: null,
      finishedAt: null,
      nextRunAt: now,
      durationMs: null,
    };
    this.jobs.set(job.id, job);
    this.order.push(job.id);
    this.emit({ type: "enqueued", job: cloneJob(job) });
    this.prune();
    return cloneJob(job);
  }

  enqueueBurst(count: number, types: JobType[] = JOB_TYPES): Job[] {
    return Array.from({ length: count }, (_, i) => this.enqueue({ type: types[i % types.length] }));
  }

  /** Take the oldest eligible queued job for this worker, or null if none. */
  lease(workerId: string): Job | null {
    const now = this.clock();
    for (const id of this.order) {
      const job = this.jobs.get(id);
      if (!job || job.status !== "queued" || job.nextRunAt > now) continue;
      job.status = "running";
      job.attempts += 1;
      job.workerId = workerId;
      job.startedAt = now;
      job.finishedAt = null;
      job.durationMs = null;
      this.emit({ type: "started", job: cloneJob(job) });
      return cloneJob(job);
    }
    return null;
  }

  complete(jobId: string, workerId: string): Job {
    const job = this.requireRunning(jobId, workerId);
    const now = this.clock();
    job.status = "succeeded";
    job.finishedAt = now;
    job.durationMs = job.startedAt != null ? now - job.startedAt : 0;
    job.error = null;
    this.completions.push(now);
    this.emit({ type: "succeeded", job: cloneJob(job) });
    this.prune();
    return cloneJob(job);
  }

  fail(jobId: string, workerId: string, error: string): Job {
    const job = this.requireRunning(jobId, workerId);
    const now = this.clock();
    job.error = error;
    job.finishedAt = now;
    job.durationMs = job.startedAt != null ? now - job.startedAt : 0;
    job.workerId = null;
    if (job.attempts >= job.maxAttempts) {
      job.status = "dead";
      this.emit({ type: "dead", job: cloneJob(job) });
    } else {
      job.status = "queued";
      job.nextRunAt = now + this.backoffBaseMs * 2 ** (job.attempts - 1);
      this.emit({ type: "retry", job: cloneJob(job) });
    }
    this.prune();
    return cloneJob(job);
  }

  clearTerminal(): number {
    let removed = 0;
    for (const id of [...this.order]) {
      const job = this.jobs.get(id);
      if (job && (job.status === "succeeded" || job.status === "dead")) {
        this.jobs.delete(id);
        removed += 1;
      }
    }
    this.order.splice(0, this.order.length, ...this.order.filter((id) => this.jobs.has(id)));
    this.emit({ type: "cleared" });
    return removed;
  }

  setWorkers(workers: WorkerState[]): void {
    this.workers = workers.map((w) => ({ ...w }));
    this.emit({ type: "workers", workers: this.workers.map((w) => ({ ...w })) });
  }

  snapshot(): Snapshot {
    return {
      jobs: this.order
        .map((id) => this.jobs.get(id))
        .filter((job): job is Job => Boolean(job))
        .map(cloneJob)
        .reverse(),
      stats: this.stats(),
      workers: this.workers.map((w) => ({ ...w })),
      throughput: this.throughputBuckets(),
    };
  }

  get size(): number {
    return this.jobs.size;
  }

  private stats(): Stats {
    const now = this.clock();
    let queued = 0;
    let running = 0;
    let retrying = 0;
    let succeeded = 0;
    let dead = 0;
    for (const job of this.jobs.values()) {
      if (job.status === "queued") {
        queued += 1;
        if (job.attempts > 0) retrying += 1;
      } else if (job.status === "running") running += 1;
      else if (job.status === "succeeded") succeeded += 1;
      else if (job.status === "dead") dead += 1;
    }
    const windowStart = now - 60_000;
    this.trimCompletions(windowStart);
    return {
      queued,
      running,
      retrying,
      succeeded,
      dead,
      processed: succeeded + dead,
      throughputPerMin: this.completions.length,
    };
  }

  private requireRunning(jobId: string, workerId: string): Job {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`unknown job ${jobId}`);
    if (job.status !== "running" || job.workerId !== workerId) {
      throw new Error(`job ${jobId} is not leased by ${workerId}`);
    }
    return job;
  }

  private prune(): void {
    if (this.jobs.size <= this.keep) return;
    for (const id of [...this.order]) {
      if (this.jobs.size <= this.keep) break;
      const job = this.jobs.get(id);
      if (job && (job.status === "succeeded" || job.status === "dead")) {
        this.jobs.delete(id);
      }
    }
    this.order.splice(0, this.order.length, ...this.order.filter((id) => this.jobs.has(id)));
  }

  private throughputBuckets(bucketCount = 24, windowMs = 60_000): number[] {
    const now = this.clock();
    const buckets = Array.from({ length: bucketCount }, () => 0);
    const cutoff = now - windowMs;
    this.trimCompletions(cutoff);
    const bucketMs = windowMs / bucketCount;
    for (const t of this.completions) {
      const idx = Math.min(bucketCount - 1, Math.max(0, Math.floor((t - cutoff) / bucketMs)));
      buckets[idx] += 1;
    }
    return buckets;
  }

  private trimCompletions(windowStart: number): void {
    const first = this.completions.findIndex((t) => t >= windowStart);
    if (first === -1) this.completions.length = 0;
    else if (first > 0) this.completions.splice(0, first);
  }

  private emit(event: QueueEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
