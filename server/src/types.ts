export type JobType = "email" | "invoice" | "thumbnail" | "flaky";

export type JobStatus = "queued" | "running" | "succeeded" | "dead";

export interface Job {
  id: string;
  type: JobType;
  payload: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  workerId: string | null;
  error: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  nextRunAt: number;
  durationMs: number | null;
}

export interface WorkerState {
  id: string;
  status: "idle" | "busy";
  jobId: string | null;
  jobType: JobType | null;
}

export interface Stats {
  queued: number;
  running: number;
  retrying: number;
  succeeded: number;
  dead: number;
  processed: number;
  throughputPerMin: number;
}

export type QueueEvent =
  | { type: "enqueued"; job: Job }
  | { type: "started"; job: Job }
  | { type: "succeeded"; job: Job }
  | { type: "retry"; job: Job }
  | { type: "dead"; job: Job }
  | { type: "workers"; workers: WorkerState[] }
  | { type: "cleared" };

export interface Snapshot {
  jobs: Job[];
  stats: Stats;
  workers: WorkerState[];
  /** Completions in the last 60s, 24 buckets (~2.5s each). */
  throughput: number[];
}

export const JOB_TYPES: JobType[] = ["email", "invoice", "thumbnail", "flaky"];
