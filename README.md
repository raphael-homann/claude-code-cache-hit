# cache-hit pour Claude Code

Port pour Claude Code de [opencode-cache-hit](https://github.com/Lucas-Rosenzweig/opencode-cache-hit) (Lucas Rosenzweig).
Le mod affiche **la part des tokens relus depuis le cache** (prompt caching) pour la session ouverte.

Au-dessus du prompt, une ligne cliquable donne le taux total et les dernières requêtes :

```
cache 93% ●●●●●●●●●●●● · détails
```

Un clic dessus (ou `/cache`) ouvre la popup « Cache réutilisé » ; un second clic, Échap, `q` ou « Fermer » la referment.

![La popup « Cache réutilisé » dans Claude Code](docs/popup.png)

Pour chaque session (principale, puis sous-agents réunis) : le taux, une barre de remplissage, et dessous un point par requête récente, sur la largeur de la barre :

```
Session principale (67)          96%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━──
●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●

Sous-agents (2)                  65%
━━━━━━━━━━━━━━━━━━━━━━━━━━──────────────
●●●●●●●

● ≥ 80%  ● 50–80%  ● < 50% (cache perdu)
Total 96% · 8.1M sur 8.5M tokens relus
[ Fermer ]
```

Il sert à voir quand le cache se perd (pause de plus de 5 min, changement de modèle, de MCP ou de system prompt en cours de session…) : un taux bas veut dire plus de quota consommé et des réponses plus lentes.

## Utilisation

- Clic sur la ligne `cache …` au-dessus du prompt (ou Entrée quand elle a le focus, `ctrl+x tab`) : ouvre ou referme la popup.
- `/cache` : pareil, au clavier.
- Seuils : vert ≥ 80 %, orange 50–80 %, rouge < 50 %. Ils sont réglables dans `hooks/calc.ts` (`GOOD`, `MID`).

## Calcul

Pour chaque réponse du modèle, à partir de `message.usage` dans les transcripts de la session :

```
cache_read_input_tokens / (input_tokens + cache_read_input_tokens + cache_creation_input_tokens)
```

- Agent principal : `~/.claude/projects/<projet>/<session>.jsonl`. Sous-agents : `<session>/subagents/agent-*.jsonl`, leurs requêtes remises dans l'ordre chronologique.
- Claude Code écrit une ligne par bloc de contenu d'une même réponse : les appels sont dédoublonnés par `message.id`.

## Prérequis

`jq` et `sh` (`apt install jq` / `brew install jq`). Le script `hooks/scan.sh` ne relit que les lignes ajoutées depuis le dernier passage, ce qui tient sur des transcripts de plus de 100 Mo.

## Limites

- Les chiffres sont recalculés après chaque appel d'outil et en fin de tour, au plus une fois par seconde.

## Licence

MIT
