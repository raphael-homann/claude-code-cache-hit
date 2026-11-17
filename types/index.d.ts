/** One model request: input tokens read from the cache, out of all input tokens. */
export type Call = { read: number; total: number; /** ms since the epoch, 0 when unknown */ at?: number }

/** Interface language. */
export type Lang = 'en' | 'fr'

/** What the band and the popup show. */
export type Stats = {
  /** Main agent: the sum of its requests. */
  own: Call
  /** The main agent's number of requests. */
  ownCount: number
  /** Its latest requests, oldest first. */
  recent: Call[]
  /** Subagents together. */
  subs: Call
  /** Subagents with at least one request. */
  subCount: number
  /** The subagents' latest requests, all together, in chronological order. */
  subRecent: Call[]
  /** Why nothing is measured: `jq`, `transcript`, or an error message. */
  problem?: string
}

declare module 'claude-code' {
  interface PluginState {
    'cache-hit': { stats: Shaped<Stats>; popupOpen: Shaped<boolean>; lang: Shaped<Lang> }
  }
}
