import { describe, expect, it } from "vitest";
import { JobQueue } from "../src/queue.js";

function queueWithClock(start = 0) {
  let now = start;
  const q = new JobQueue({ now: () => now, backoffBaseMs: 100, keep: 5 });
  return {
    q,
    get now() {
      return now;
    },
    advance(ms: number) {
      now += ms;
    },
  };
}

describe("JobQueue", () => {
  it("leases jobs FIFO and only once", () => {
    const { q } = queueWithClock();
    q.enqueue({ type: "email", payload: "a" });
    q.enqueue({ type: "email", payload: "b" });

    const first = q.lease("w1");
    const second = q.lease("w2");
    const third = q.lease("w3");

    expect(first?.payload).toBe("a");
    expect(first?.status).toBe("running");
    expect(first?.attempts).toBe(1);
    expect(first?.workerId).toBe("w1");
    expect(second?.payload).toBe("b");
    expect(third).toBeNull();
  });

  it("complete marks a job succeeded and records duration", () => {
    const clock = queueWithClock();
    clock.q.enqueue({ type: "invoice" });
    const leased = clock.q.lease("w1");
    clock.advance(250);
    const done = clock.q.complete(leased!.id, "w1");

    expect(done.status).toBe("succeeded");
    expect(done.durationMs).toBe(250);
    expect(done.error).toBeNull();
    expect(clock.q.snapshot().stats.succeeded).toBe(1);
    expect(clock.q.snapshot().throughput.reduce((a, b) => a + b, 0)).toBe(1);
  });

  it("retries with exponential backoff until maxAttempts, then dead-letters", () => {
    const clock = queueWithClock();
    const job = clock.q.enqueue({ type: "flaky", maxAttempts: 3 });

    clock.q.lease("w1");
    clock.q.fail(job.id, "w1", "boom");
    expect(clock.q.snapshot().jobs[0].status).toBe("queued");
    expect(clock.q.snapshot().jobs[0].nextRunAt).toBe(100);
    expect(clock.q.lease("w1")).toBeNull();

    clock.advance(100);
    clock.q.lease("w1");
    clock.q.fail(job.id, "w1", "boom");
    expect(clock.q.snapshot().jobs[0].nextRunAt).toBe(100 + 200);

    clock.advance(200);
    clock.q.lease("w1");
    const dead = clock.q.fail(job.id, "w1", "boom");
    expect(dead.status).toBe("dead");
    expect(dead.attempts).toBe(3);
    expect(clock.q.lease("w1")).toBeNull();
    expect(clock.q.snapshot().stats.dead).toBe(1);
  });

  it("rejects complete/fail from the wrong worker", () => {
    const { q } = queueWithClock();
    q.enqueue({ type: "email" });
    const leased = q.lease("w1");
    expect(() => q.complete(leased!.id, "w2")).toThrow(/not leased/);
    expect(() => q.fail(leased!.id, "w2", "nope")).toThrow(/not leased/);
  });

  it("counts retrying jobs separately from fresh queued jobs", () => {
    const { q } = queueWithClock();
    q.enqueue({ type: "email" });
    q.enqueue({ type: "flaky", maxAttempts: 3 });
    const flaky = q.lease("w1");
    q.fail(flaky!.id, "w1", "timeout");

    const stats = q.snapshot().stats;
    expect(stats.queued).toBe(2);
    expect(stats.retrying).toBe(1);
    expect(stats.running).toBe(0);
  });

  it("emits lifecycle events in order", () => {
    const { q } = queueWithClock();
    const types: string[] = [];
    q.subscribe((event) => types.push(event.type));

    const job = q.enqueue({ type: "email", maxAttempts: 1 });
    q.lease("w1");
    q.fail(job.id, "w1", "nope");

    expect(types).toEqual(["enqueued", "started", "dead"]);
  });

  it("prunes oldest terminal jobs when over the keep limit", () => {
    const { q } = queueWithClock();
    for (let i = 0; i < 6; i++) {
      q.enqueue({ type: "email" });
      const leased = q.lease("w1");
      q.complete(leased!.id, "w1");
    }
    expect(q.size).toBe(5);
    const ids = q.snapshot().jobs.map((j) => j.id);
    expect(ids).not.toContain("job_001");
    expect(ids).toContain("job_006");
  });

  it("clearTerminal drops succeeded and dead jobs but keeps in-flight work", () => {
    const { q } = queueWithClock();
    q.enqueue({ type: "email" });
    q.enqueue({ type: "email" });
    q.enqueue({ type: "flaky", maxAttempts: 1 });

    const a = q.lease("w1");
    q.complete(a!.id, "w1");
    const b = q.lease("w1");
    const c = q.lease("w2");
    q.fail(c!.id, "w2", "dead");

    expect(q.clearTerminal()).toBe(2);
    const snap = q.snapshot();
    expect(snap.jobs).toHaveLength(1);
    expect(snap.jobs[0].id).toBe(b!.id);
    expect(snap.jobs[0].status).toBe("running");
  });
});
