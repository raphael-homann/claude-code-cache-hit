// Calculs du taux de cache, repris de opencode-cache-hit (tui.ts, Lucas Rosenzweig).
// Taux d'un appel : cache_read / (input + cache_read + cache_creation).
import type { Call, Stats } from '../types'

/** En dessous de cette taille, un appel sans cache n'est pas signalé (titres, petits appels). */
export const MIN_TOKENS_FOR_WARNING = 5000
/** Largeur des barres et du libellé + pourcentage. */
export const WIDTH = 24
/** Nombre d'appels affichés en points. */
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

/** Seuils des couleurs : vert à partir de GOOD %, orange à partir de MID %, rouge en dessous. */
export const GOOD = 80
export const MID = 50

export type Tone = 'success' | 'warning' | 'error'
export const tone = (c: Call): Tone =>
  missed(c) || pct(c) < MID ? 'error' : pct(c) < GOOD ? 'warning' : 'success'

/** Le total agent principal + sous-agents. */
export const overall = (s: Stats): Call => ({ read: s.own.read + s.subs.read, total: s.own.total + s.subs.total })

/** Un transcript lu jusqu'à `from` lignes : ses appels, une entrée par `message.id`. */
export type FileScan = { from: number; calls: Map<string, Call> }

/**
 * Ajoute à `scan` la sortie de hooks/scan.sh : première ligne = lignes lues,
 * puis `[id, input, cache_read, cache_write]` par ligne de réponse. Claude Code
 * écrit une ligne par bloc de contenu d'une même réponse, avec le même usage :
 * on garde un appel par id.
 */
export function absorb(scan: FileScan, stdout: string): FileScan {
  const lines = stdout.split('\n')
  const from = Number.parseInt(lines[0] ?? '', 10)
  if (!Number.isFinite(from)) return scan
  // Fichier réécrit ou raccourci : scan.sh est reparti du début.
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
    calls.delete(key) // une ré-écriture du même id le replace en dernier
    calls.set(key, { read: r, total, at })
  }
  return { from, calls }
}

/** Les stats affichées, à partir du transcript principal et de ceux des sous-agents. */
export function stats(main: FileScan | undefined, subs: readonly FileScan[]): Stats {
  const own = main ? [...main.calls.values()] : []
  const withCalls = subs.filter(s => s.calls.size > 0)
  const subCalls = withCalls.flatMap(s => [...s.calls.values()])
  // Sous-agents en parallèle : on remet leurs appels dans l'ordre où ils ont eu lieu.
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

/** Le nom du dossier de projet de Claude Code pour un répertoire. */
export const projectDirName = (dir: string) => dir.replace(/[^a-zA-Z0-9]/g, '-')
