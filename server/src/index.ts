import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import type { Response } from "express";
import { JobQueue } from "./queue.js";
import type { JobType } from "./types.js";
import { JOB_TYPES } from "./types.js";
import { WorkerPool } from "./workers.js";

const PORT = Number(process.env.PORT) || 3002;
const WORKERS = Number(process.env.WORKERS) || 4;

const queue = new JobQueue();
const pool = new WorkerPool(queue, WORKERS);
pool.start();

const app = express();
app.use(express.json());

const sseClients = new Set<Response>();

queue.subscribe((event) => {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of sseClients) client.write(payload);
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", workers: pool.workers.length, jobs: queue.size });
});

app.get("/api/snapshot", (_req, res) => {
  res.json(queue.snapshot());
});

app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: "hello" })}\n\n`);
  sseClients.add(res);
  req.on("close", () => {
    sseClients.delete(res);
  });
});

app.post("/api/jobs", (req, res) => {
  const type = req.body?.type as JobType | undefined;
  const count = Math.min(Math.max(Number(req.body?.count) || 1, 1), 40);
  if (!type || !JOB_TYPES.includes(type)) {
    res.status(400).json({ error: `type must be one of ${JOB_TYPES.join(", ")}` });
    return;
  }
  const jobs = Array.from({ length: count }, () => queue.enqueue({ type }));
  res.status(201).json({ jobs });
});

app.post("/api/demo", (_req, res) => {
  const jobs = queue.enqueueBurst(16);
  res.status(201).json({ jobs });
});

app.post("/api/chaos", (_req, res) => {
  const jobs = queue.enqueueBurst(12, ["flaky", "flaky", "flaky", "email"]);
  res.status(201).json({ jobs });
});

app.delete("/api/jobs/terminal", (_req, res) => {
  res.json({ removed: queue.clearTerminal() });
});

const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist");
app.use(express.static(webDist));

app.listen(PORT, () => {
  console.log(`PulseQueue listening on http://localhost:${PORT} (${WORKERS} workers)`);
});
