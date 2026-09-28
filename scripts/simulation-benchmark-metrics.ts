/** Raw-sample statistics and physical storage accounting for local benchmark workers. @module */
import { readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Compute nearest-rank latency percentiles without discarding the caller's raw samples.
 * @param latencies - Completed operation durations in milliseconds.
 * @param elapsedMs - Full phase duration, including overhead between operations.
 * @returns phase count, elapsed duration and zero-valued percentiles for an empty phase.
 */
export function benchmarkLatencySummary(latencies: readonly number[], elapsedMs: number): {
  count: number
  elapsedMs: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
} {
  const sorted = [...latencies].sort((a, b) => a - b)
  const percentile = (fraction: number) => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0
  return { count: latencies.length, elapsedMs, p50Ms: percentile(0.5), p95Ms: percentile(0.95), p99Ms: percentile(0.99) }
}

/**
 * Count regular-file bytes in an owned benchmark directory without following links.
 * @param directory - Existing isolated data root.
 * @returns total bytes, including live WAL files when present.
 */
export async function benchmarkDiskBytes(directory: string): Promise<number> {
  let bytes = 0
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) bytes += await benchmarkDiskBytes(path)
    else if (entry.isFile()) bytes += (await stat(path)).size
  }
  return bytes
}

/**
 * Save the validated checkpoint selector and expected projection for a fresh recovery process.
 * @param root - Owned workload data directory.
 * @param selection - Producer-validated run selection; the recovery worker parses it again.
 * @param request - Producer-validated checkpoint restore request.
 * @param fingerprint - SHA-256 of the exact checkpointed run projection.
 * @returns completion after the sibling recovery metadata file is written.
 */
export async function writeBenchmarkRecovery(root: string, selection: unknown, request: unknown, fingerprint: string): Promise<void> {
  await writeFile(join(root, '..', 'recovery.json'), `${JSON.stringify({ selection, request, fingerprint })}\n`)
}
