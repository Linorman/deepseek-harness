# @clocky/clocky-team-channel-summary

English | [中文](README.zh.md)

`ctx.teamChannelSummaries.summarize()` creates an explicit, deterministic extractive summary from a committed channel WAL range. The Hub remains the authority for requester identity, visibility, cursor checks, source fingerprint, idempotency and durable storage. The Consumer registers the canonical summary proof source and never calls a model.

## Calling and configuration

The coordinator tool `team_channel_summarize` accepts a channel id, current cursor, inclusive source sequence range and stable idempotency key. The authenticated Host API `team.channel.summarize` accepts the corresponding `ChannelSummarySelectionInput`; the human binder checks the caller's active membership and `send` grant. Both return the durable summary text and provenance. The default TeamRun coordinator tool works on its directed human channel; this does not shorten that channel's model history automatically.

Every deployment supplies `allowedPolicies`, `maxSourceEnvelopes`, `maxSourceBytes`, `maxSummaryBytes`, `maxHistorySpan` and `disposalTimeoutMs`. The assembled profiles allow `directed` and `summarized-window`, with 64 source Envelopes, 65,536 source JSON bytes, 4,096 output bytes, 128 WAL sequences and 5,000 ms disposal wait. The Hub's storage-page bound also applies. Limits reject oversized source selections before generation; output truncation retains a complete Unicode prefix within the UTF-8 allowance.

Extraction accepts plain `payload.text` or a nonempty `payload.content` array containing only text blocks. It normalizes whitespace and labels each source with its WAL sequence. Nontext source content fails explicitly. Source text remains quoted data: the extractor does not execute instructions or infer new facts.

## Authority and durability

Only a current active coordinator activation or authenticated active human channel member can request a summary. New work also requires an active Team and channel, no closure/cancellation intent, an allowed immutable view policy, and an exact channel cursor. Source ranges must contain messages visible to every immutable channel member; private subset ranges are rejected before any source content is returned for generation. The rejection exposes no hidden source text.

The Consumer retains the selected adapter and view-policy implementations through generation and commit. It binds an ephemeral proof to the complete output and source fingerprint; the Hub rereads the source and rechecks caller authority before append. Each durable record carries a SHA-256 fingerprint of its canonical ordered source Envelopes. WAL/checkpoint recovery validates that fingerprint, and compaction cannot remove a retained summary's source range.

The same idempotency key and range return the original record, including after restart or a stale-cursor retry. A conflicting range or low-level payload is rejected. A new key requires a fresh cursor. The `summarized-window` policy projects the latest durable summary followed by its uncovered raw tail; without a summary it projects raw messages. Reading never generates a summary.

## Model Experience

### Explicit coordinator summary

#### What the model sees

The current default coordinator receives the `team_channel_summarize` tool schema. Its generic tool card names the selected channel and sequence range; the result contains the durable summary id, sequence, range and text. Ordinary worker Agents do not receive this tool. The authenticated human API returns the same durable facts without making a model request.

#### Token effect

The tool schema and result add tokens to the coordinator Session. Summarized-window deliveries contain the persisted summary and selected raw tail. Extraction itself consumes no model tokens.

#### KV Cache effect

The scoped tool schema is stable for the coordinator. Tool results and channel-view events enter the dynamic Session suffix; they do not rewrite a prior request prefix.

## Known Limitations and Deferred Work

- Summaries are channel-wide. There is no private per-viewer summary storage.
- The deterministic extractor supports text only. Model-generated summaries and automatic threshold-triggered compaction are not provided.
- Retained summary provenance pins source storage; this package does not replace history with an unverified digest.
