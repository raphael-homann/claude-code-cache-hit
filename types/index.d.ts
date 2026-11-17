/** Un appel au modèle : tokens relus depuis le cache sur le total des tokens d'entrée. */
export type Call = { read: number; total: number; /** ms depuis l'époque, 0 si inconnu */ at?: number }

/** Ce que le panneau et la ligne de statut affichent. */
export type Stats = {
  /** Agent principal : somme de ses appels. */
  own: Call
  /** Nombre d'appels de l'agent principal. */
  ownCount: number
  /** Ses derniers appels, du plus ancien au plus récent. */
  recent: Call[]
  /** Sous-agents réunis. */
  subs: Call
  /** Nombre de sous-agents ayant au moins un appel. */
  subCount: number
  /** Derniers appels des sous-agents, tous ensemble, dans l'ordre chronologique. */
  subRecent: Call[]
  /** Raison pour laquelle rien n'est mesuré (jq absent, transcript introuvable). */
  problem?: string
}

declare module 'claude-code' {
  interface PluginState {
    'cache-hit': { stats: Shaped<Stats>; popupOpen: Shaped<boolean> }
  }
}
