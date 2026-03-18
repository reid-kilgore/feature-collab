## How to Read the Transcript

Session transcripts are JSONL files. Each line is a JSON object.

**Performance:** Always use `grep` to pre-filter before `jq`. This applies to ALL transcripts, including short ones — there is no size exception:

```bash
# Human messages
grep '"type": *"user"' transcript.jsonl | jq -r 'select((.message.content | type) == "string") | "\(.timestamp): \(.message.content)"'

# Assistant text responses
grep '"type": *"assistant"' transcript.jsonl | jq -c '.message.content[]? | select(.type == "text") | .text' | head -50

# Tool calls (what actions were taken)
grep '"type": *"assistant"' transcript.jsonl | jq -c '.message.content[]? | select(.type == "tool_use") | .name' | sort | uniq -c | sort -rn

# Compaction summaries
grep '"type": *"summary"' transcript.jsonl | jq -r '.summary'
```

**Do not read the entire transcript line by line.** Use these patterns to extract, sample first, then deep-dive.