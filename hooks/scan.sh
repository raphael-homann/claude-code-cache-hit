#!/bin/sh
# Reads the rest of a Claude Code JSONL transcript, from line $2 (0 = the top).
# First output line: the file's number of complete lines (the next $2).
# Then one line per model response: [id, input, cache_read, cache_write, ISO timestamp].
# Only lines ending with a newline are read: a line still being written is read
# on the next pass.
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
