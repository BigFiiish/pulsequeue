import type { JobType, Snapshot } from "./types";

export async function fetchSnapshot(): Promise<Snapshot> {
  const res = await fetch("/api/snapshot");
  if (!res.ok) throw new Error("Failed to load queue snapshot");
  return res.json();
}

export async function enqueue(type: JobType, count = 1): Promise<void> {
  const res = await fetch("/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, count }),
  });
  if (!res.ok) throw new Error("Failed to enqueue");
}

export async function enqueueDemo(): Promise<void> {
  const res = await fetch("/api/demo", { method: "POST" });
  if (!res.ok) throw new Error("Failed to start demo");
}

export async function enqueueChaos(): Promise<void> {
  const res = await fetch("/api/chaos", { method: "POST" });
  if (!res.ok) throw new Error("Failed to start chaos");
}

export async function clearTerminal(): Promise<void> {
  const res = await fetch("/api/jobs/terminal", { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to clear jobs");
}
