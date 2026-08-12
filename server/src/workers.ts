import type { Job, JobType, WorkerState } from "./types.js";
import type { JobQueue } from "./queue.js";

const DURATION_MS: Record<JobType, [number, number]> = {
  email: [180, 320],
  invoice: [420, 720],
  thumbnail: [700, 1100],
  flaky: [160, 280],
};

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter([lo, hi]: [number, number]): number {
  return lo + Math.random() * (hi - lo);
}

/** Simulated job bodies — email/invoice/thumbnail always succeed; flaky fails ~55%. */
export async function executeJob(job: Job): Promise<void> {
  await sleep(jitter(DURATION_MS[job.type]));
  if (job.type === "flaky" && Math.random() < 0.55) {
    throw new Error("upstream timeout");
  }
}

export class WorkerPool {
  readonly workers: WorkerState[];
  private stopped = false;
  private loops: Promise<void>[] = [];

  constructor(
    private readonly queue: JobQueue,
    count: number,
    private readonly execute: (job: Job) => Promise<void> = executeJob,
  ) {
    this.workers = Array.from({ length: count }, (_, i) => ({
      id: `w${i + 1}`,
      status: "idle" as const,
      jobId: null,
      jobType: null,
    }));
    this.queue.setWorkers(this.workers);
  }

  start(): void {
    this.stopped = false;
    this.loops = this.workers.map((worker) => this.loop(worker));
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await Promise.all(this.loops);
  }

  private async loop(worker: WorkerState): Promise<void> {
    while (!this.stopped) {
      const job = this.queue.lease(worker.id);
      if (!job) {
        await sleep(40);
        continue;
      }
      worker.status = "busy";
      worker.jobId = job.id;
      worker.jobType = job.type;
      this.queue.setWorkers(this.workers);
      try {
        await this.execute(job);
        this.queue.complete(job.id, worker.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : "job failed";
        this.queue.fail(job.id, worker.id, message);
      }
      worker.status = "idle";
      worker.jobId = null;
      worker.jobType = null;
      this.queue.setWorkers(this.workers);
    }
  }
}
