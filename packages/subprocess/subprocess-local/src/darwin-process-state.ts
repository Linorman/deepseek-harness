/** Exact macOS process identity from libproc's proc_bsdinfo, shared by runtime fencing and subprocess teardown. */
import koffi from 'koffi'

/** A kernel-observed process generation and its current lifecycle state. */
export interface DarwinProcessState {
  /** Parent pid observed with the same process generation. */
  readonly parentPid: number
  /** Creation time including microseconds, independent of ps locale and second rounding. */
  readonly started: string
  /** False for a zombie awaiting collection. */
  readonly active: boolean
}

/** Native proc_pidinfo boundary; zero or a short result is not a process identity. */
export type DarwinProcessQuery = (pid: number, buffer: Buffer) => number

// Apple's public 64-bit proc_bsdinfo ABI: bsd/sys/proc_info.h. The SDK ABI test
// compares these offsets against sizeof/offsetof from the installed C headers.
const BSD_INFO_BYTES = 136
const STATUS_OFFSET = 4
const PID_OFFSET = 12
const PARENT_PID_OFFSET = 16
const START_SECONDS_OFFSET = 120
const START_MICROSECONDS_OFFSET = 128
const PROC_PIDTBSDINFO = 3
const SZOMB = 5

type ProcPidInfo = (pid: number, flavor: number, arg: bigint, buffer: Buffer, bytes: number) => number
let procPidInfo: ProcPidInfo | undefined

/** Bind only when a macOS process actually requests native inspection. */
function queryProcess(pid: number, buffer: Buffer): number {
  procPidInfo ??= koffi.load('/usr/lib/libproc.dylib').func(
    'int proc_pidinfo(int pid, int flavor, uint64_t arg, _Out_ void *buffer, int buffersize)',
  ) as ProcPidInfo
  return procPidInfo(pid, PROC_PIDTBSDINFO, 0n, buffer, buffer.length)
}

/**
 * Read a complete native process identity without falling back to second-rounded ps output.
 * @param pid - process id selected from the local process table or a persisted recovery descriptor.
 * @param query - native syscall boundary, injectable for incomplete and recycled-process observations.
 * @returns the exact creation identity and liveness, or undefined when no complete matching process is observable.
 */
export function readDarwinProcessState(pid: number, query: DarwinProcessQuery = queryProcess): DarwinProcessState | undefined {
  const buffer = Buffer.alloc(BSD_INFO_BYTES)
  if (query(pid, buffer) !== BSD_INFO_BYTES || buffer.readUInt32LE(PID_OFFSET) !== pid) return undefined
  const seconds = buffer.readBigUInt64LE(START_SECONDS_OFFSET)
  const micros = buffer.readBigUInt64LE(START_MICROSECONDS_OFFSET)
  const status = buffer.readUInt32LE(STATUS_OFFSET)
  if (seconds === 0n || micros >= 1_000_000n || status < 1 || status > SZOMB) return undefined
  return { parentPid: buffer.readUInt32LE(PARENT_PID_OFFSET), started: `${seconds}:${micros}`, active: status !== SZOMB }
}
