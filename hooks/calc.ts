// Cache hit rate computations, after opencode-cache-hit (tui.ts, Lucas Rosenzweig).
// Rate of a request: cache_read / (input + cache_read + cache_creation).
import type { Call, Stats } from '../types'

/** Below this size, a request without cache is not flagged as a lost cache (titles, small calls). */
export const MIN_TOKENS_FOR_WARNING = 5000
/** Requests kept for the dots. */
export const HISTORY = 40

export const EMPTY: Stats = {
  own: { read: 0, total: 0 },
  ownCount: 0,
  recent: [],
  subs: { read: 0, total: 0 },
  subCount: 0,
  subRecent: [],
}

export const sum = (list: readonly Call[]): Call =>
  list.reduce((a, c) => ({ read: a.read + c.read, total: a.total + c.total }), { read: 0, total: 0 })
export const pct = (c: Call) => (c.total > 0 ? Math.round((c.read / c.total) * 100) : 0)
export const k = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${n}`
export const missed = (c: Call) => c.total >= MIN_TOKENS_FOR_WARNING && c.read < c.total / 2

/** Color thresholds: green from GOOD %, orange from MID %, red below. */
export const GOOD = 80
export const MID = 50

export type Tone = 'success' | 'warning' | 'error'
export const tone = (c: Call): Tone =>
  missed(c) || pct(c) < MID ? 'error' : pct(c) < GOOD ? 'warning' : 'success'

/** Main agent and subagents together. */
export const overall = (s: Stats): Call => ({ read: s.own.read + s.subs.read, total: s.own.total + s.subs.total })

/**
 * A transcript read up to `from` lines: its requests, one entry per `message.id`.
 * `size` is the file's size in bytes when it was last read: an unchanged size is not read again.
 */
export type FileScan = { from: number; calls: Map<string, Call>; size?: number }

/**
 * Adds hooks/scan.sh's output to `scan`: first line = lines read, then
 * `[id, input, cache_read, cache_write, timestamp]` per response line. Claude Code
 * writes one line per content block of a response, all with the same usage:
 * one request is kept per id.
 */
export function absorb(scan: FileScan, stdout: string): FileScan {
  const lines = stdout.split('\n')
  const from = Number.parseInt(lines[0] ?? '', 10)
  if (!Number.isFinite(from)) return scan
  // File rewritten or shortened: scan.sh started over from the top.
  const calls = from < scan.from ? new Map<string, Call>() : new Map(scan.calls)
  for (const line of lines.slice(1)) {
    if (!line) continue
    let row: unknown
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (!Array.isArray(row) || row.length < 4) continue
    const [id, input, read, write, ts] = row as [unknown, unknown, unknown, unknown, unknown]
    const r = Number(read) || 0
    const total = (Number(input) || 0) + r + (Number(write) || 0)
    if (total <= 0) continue
    const key = String(id)
    const at = typeof ts === 'string' ? Date.parse(ts) || 0 : 0
    calls.delete(key) // a rewrite of the same id moves it last
    calls.set(key, { read: r, total, at })
  }
  return { from, calls }
}

/** The displayed stats, from the main transcript and the subagents' ones. */
export function stats(main: FileScan | undefined, subs: readonly FileScan[]): Stats {
  const own = main ? [...main.calls.values()] : []
  const withCalls = subs.filter(s => s.calls.size > 0)
  const subCalls = withCalls.flatMap(s => [...s.calls.values()])
  // Subagents run in parallel: their requests are put back in the order they happened.
  const ordered = subCalls.map((c, i) => ({ c, i })).sort((a, b) => (a.c.at ?? 0) - (b.c.at ?? 0) || a.i - b.i)
  return {
    own: sum(own),
    ownCount: own.length,
    recent: own.slice(-HISTORY),
    subs: sum(subCalls),
    subCount: withCalls.length,
    subRecent: ordered.slice(-HISTORY).map(o => o.c),
  }
}

/** Claude Code's project folder name for a directory. */
export const projectDirName = (dir: string) => dir.replace(/[^a-zA-Z0-9]/g, '-')
