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

export interface Snapshot {
  jobs: Job[];
  stats: Stats;
  workers: WorkerState[];
  throughput: number[];
}

export const JOB_TYPES: JobType[] = ["email", "invoice", "thumbnail", "flaky"];
