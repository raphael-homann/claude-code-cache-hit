#!/bin/sh
# Lit la suite d'un transcript JSONL de Claude Code, à partir de la ligne $2 (0 = début).
# Première ligne de sortie : le nombre de lignes complètes du fichier (prochain $2).
# Puis une ligne par appel au modèle : [id, input, cache_read, cache_write, horodatage ISO].
# Seules les lignes terminées par un saut de ligne sont lues : une ligne en cours
# d'écriture l'est au passage suivant.
f=$1
from=${2:-0}
if [ ! -f "$f" ]; then echo 0; exit 0; fi
size=$(wc -c < "$f" | tr -d ' ')
lines=$(head -c "$size" "$f" | wc -l | tr -d ' ')
if [ "$lines" -lt "$from" ]; then from=0; fi
echo "$lines"
[ "$lines" -gt "$from" ] || exit 0
head -n "$lines" "$f" | tail -n +$((from + 1)) | jq -R -c '
  fromjson?
  | select(type == "object" and .type == "assistant" and (.message.usage | type) == "object")
  | [(.message.id // .uuid),
     (.message.usage.input_tokens // 0),
     (.message.usage.cache_read_input_tokens // 0),
     (.message.usage.cache_creation_input_tokens // 0),
     (.timestamp // "")]'
