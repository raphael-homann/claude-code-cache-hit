// Interface texts, in English and French. `l` in the popup switches between them.

export type { Lang } from '../types'
import type { Lang } from '../types'

export type Texts = {
  /** Popup title. */
  title: string
  /** Band suffix while the popup is closed / open. */
  details: string
  hide: string
  main: (calls: number) => string
  subs: (count: number) => string
  noSubs: string
  /** Legend for the red dot. */
  lost: string
  total: (pct: number, read: string, all: string) => string
  /** The total in a narrow pane. */
  totalShort: (pct: number, read: string, all: string) => string
  /** Session labels without their request count, for a narrow pane. */
  mainShort: string
  subsShort: string
  close: string
  /** Label of the language switch: the other language, in that language. */
  switchTo: string
  waiting: string
  /** Problems, by code. */
  jq: string
  noTranscript: string
  commandDescription: string
  opened: string
  closed: string
}

export const TEXTS: Record<Lang, Texts> = {
  en: {
    title: 'Cache hits',
    details: 'details',
    hide: 'hide',
    main: calls => `Main session (${calls})`,
    subs: count => `Subagents (${count})`,
    noSubs: 'Subagents: none in this session',
    lost: 'cache lost',
    total: (pct, read, all) => `Total ${pct}% · ${read} of ${all} from cache`,
    totalShort: (pct, read, all) => `Total ${pct}% · ${read}/${all}`,
    mainShort: 'Main session',
    subsShort: 'Subagents',
    close: 'Close',
    switchTo: 'Français',
    waiting: 'Waiting for a first response…',
    jq: 'jq is required (apt install jq / brew install jq)',
    noTranscript: 'transcript not found (no response yet?)',
    commandDescription: 'Show or hide the cache hit popup',
    opened: 'Cache hit popup opened (Escape to close).',
    closed: 'Cache hit popup closed.',
  },
  fr: {
    title: 'Cache réutilisé',
    details: 'détails',
    hide: 'fermer',
    main: calls => `Session principale (${calls})`,
    subs: count => `Sous-agents (${count})`,
    noSubs: 'Sous-agents : aucun dans cette session',
    lost: 'cache perdu',
    total: (pct, read, all) => `Total ${pct}% · ${read} sur ${all} tokens relus`,
    totalShort: (pct, read, all) => `Total ${pct}% · ${read}/${all}`,
    mainShort: 'Session principale',
    subsShort: 'Sous-agents',
    close: 'Fermer',
    switchTo: 'English',
    waiting: 'En attente d’une première réponse…',
    jq: 'jq est nécessaire (apt install jq / brew install jq)',
    noTranscript: 'transcript introuvable (pas encore de réponse ?)',
    commandDescription: 'Afficher ou masquer la popup « Cache réutilisé »',
    opened: 'Popup « Cache réutilisé » ouverte (Échap pour fermer).',
    closed: 'Popup « Cache réutilisé » fermée.',
  },
}

/** Language from the environment (LC_ALL, LC_MESSAGES, LANG): French for fr_*, else English. */
export const langFromLocale = (locale: string | undefined): Lang => (/^fr\b|^fr_/i.test(locale ?? '') ? 'fr' : 'en')

export const isLang = (value: unknown): value is Lang => value === 'en' || value === 'fr'

export const otherLang = (lang: Lang): Lang => (lang === 'en' ? 'fr' : 'en')

/** A problem stored in the stats: a known code, or a raw error message. */
export const problemText = (t: Texts, problem: string) =>
  problem === 'jq' ? t.jq : problem === 'transcript' ? t.noTranscript : problem
