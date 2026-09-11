# Agent Note: Unified normalized attachments and inline request versions

Status: implemented

English | [中文](2026-08-20-unified-image-request-pipeline.zh.md)

## Problem

Durable image history, provider resolution, and inline request size have different limits. Treating an admitted image as the bytes sent on every later request forced one byte cap and one raster to serve all three concerns. Large but ordinary input was refused, clean 16-bit PNG could pass into history and fail at a provider, and repeated base64 expanded long requests until the request exceeded a gateway limit.

## Decision

The image path has two explicit versions. The attachment backend owns a provider-independent durable normalized attachment. Each image-capable model route owns a deterministic request policy, and the attachment backend derives and caches the exact request version from that attachment. Session history contains only the normalized attachment reference; inline bytes are transient request projections.

### Provider-independent normalized attachment

Admission accepts at most 20 images and 200MiB of encoded source bytes per message. Each source is fully decoded under configurable 20MiB, 64,000,000-pixel, and 8192px-per-side limits. Normalization applies EXIF orientation, removes metadata and color profiles, converts to 8-bit sRGB/sRGBA, and preserves aspect ratio while limiting the long edge to `normalizedImageMaxDimension`, 2048px by default. When scaling reduces the raster, `originalDimensions` records its orientation-applied width and height before normalization.

The normalized attachment has an independent `normalizedImageMaxBytes` safety cap, 4MiB by default. Alpha is never flattened. A nearest-neighbour bounded sample classifies color complexity without averaging high-frequency pixels. Confirmed low-color input tries PNG, with palette encoding only when no alpha channel is present, followed by WebP qualities 85, 80, and 75. Other alpha input tries WebP at those qualities; other opaque input tries JPEG. Candidates execute in order and stop at the first result within the cap. Dimensions shrink only after every candidate at one size exceeds the cap. The source extension does not classify a PNG as low color. A clean, single-frame 8-bit sRGB/sRGBA PNG, JPEG, or WebP within both normalization limits passes through byte-identically and retains content-addressed deduplication. GIF, animation, metadata, orientation, 16-bit PNG, and incompatible color spaces force conversion. The source and a converted output are each fully decoded once; the output must match its format, dimensions, depth, color space, and alpha facts before its digest enters the reference.

Batch admission prepares and verifies every normalized attachment once before publishing any member. Validation failure starts no writes. Publication uses those prepared bytes directly, so a large batch does not repeat full decoding and encoding during commit. A later storage failure returns no partial references; already published immutable objects may remain unreachable under the existing storage rule.

### Deterministic request versions

The `AttachmentStore.readImageRequest` method derives a request version under the route's configured total-pixel and encoded-byte budgets. Scaling is `min(1, sqrt(maxPixels / (width * height)))`, with no enlargement, followed by inward integer rounding so the encoded raster never exceeds the total-pixel cap. The default pi-ai policy uses 2048 by 2048 total pixels and a 1MiB raw encoded-byte cap. Request encoding uses the same color branches, with PNG (palette only without alpha) then WebP 85 and 80 for low-color input, WebP 85 then 80 for other alpha input, and JPEG 85 then 80 for other opaque input. Each fallback runs only after the previous result exceeds the byte cap, and dimensions shrink only after both quality attempts exceed it. The same derivation is used by normal agent turns, direct `ctx.llm.stream` calls, compaction, and other auxiliary streams.

The `variantId` and cache path cover the normalized attachment id, transform version, route pixel and byte budgets, and fixed encoder parameters. A new cache entry is fully decoded before publication. Cache hits use a header probe to check format, 8-bit sRGB/sRGBA facts, dimensions, alpha, and byte limits without decoding the complete raster again; a mismatch regenerates the entry. Inline base64 uses the same deterministic bytes for the same policy. Inline accounting uses the derived byte length after base64 expansion, not the normalized attachment byte count. Equal in-process `variantId` calls share one transform and cache write. Each caller can cancel its own wait; the shared transform is aborted only after every waiter has cancelled. Callers preserve order by applying `Promise.all` to singular `readImageRequest` calls. The local implementation runs normalization and request transforms through one FIFO limiter; `imageCompressionConcurrency` is configurable from 1 through 8 and defaults to 2. Batch publication remains sequential after every normalized attachment has been prepared.

Request-size offload is a deterministic oldest-first projection. Before reading attachments, each route uses `min(attachmentBytes, requestVersionMaxBytes)` as a conservative upper bound and removes the oldest over-budget prefix. Only retained attachments are read and transformed, so an omitted missing or corrupt object cannot block the request. A second projection uses exact derived lengths without bringing omitted images back. A pi-ai route retains a configurable base64 request bound. Its removed prefix is stable until the accumulated request crosses the next configured threshold. A text-only route receives deterministic attachment placeholders, including nested tool-result images, while append-only session history keeps the original references.

### Stable handles

Every retained request image is preceded by its complete attachment id and actual request dimensions. User messages, tool results, agent-loop requests, compaction, and direct `ctx.llm.stream` calls share this projection.

### Provider request projection

`clocky-llm-pi-ai` resolves durable image references at request time and converts each retained request version into a text handle followed by an inline base64 image block. It recursively handles images nested in tool results, applies the configured request-size bound by replacing the oldest omitted images with deterministic text placeholders, and sends no remote file identifier. The provider's response remains responsible for reporting any rejection; the durable attachment reference and normalized metadata stay authoritative in session history.

### Diagnostics

A 16-bit RGB or RGBA PNG is normal admitted input and converts to 8-bit sRGB/sRGBA. If local conversion fails, `read_image` names the path, detected 16-bit PNG, required normalized form, and manual conversion remedy. If a configured provider rejects a normalized request version, the primary error names the attachment or display name, durable message and image position, normalized media type, 8-bit sRGB/sRGBA depth, dimensions, and provider message. An ambiguous multi-image rejection lists every candidate. The raw provider body remains the error cause rather than the only visible message.

Historical attachment objects that later disappear or fail integrity verification remain fail-loud. Durable quarantine and verified recovery require session events and are tracked by [Quarantine unreadable historical attachments](../../proposed/bug-fix/2026-08-20-attachment-read-quarantine.md).

## Alternatives considered

**Use one 1MiB normalized attachment for storage and requests.** This makes model resolution determine durable image detail and combines local storage, inline expansion, and model pixels into one setting. Independent normalization and request policies keep those responsibilities explicit.

**Reject images above provider dimensions or at the encoding quality floor.** A provider limit is route-specific and future requests may use another model. Proportional normalization and request projection accept ordinary large images while bounding each later representation.

**Treat PNG as a screenshot and reject 16-bit PNG.** File format does not reveal pixel complexity, and 16-bit RGB/RGBA is a convertible sample depth rather than an unsupported image type. Pixel sampling and post-conversion probes give the required facts.

**Keep normalized attachment bytes as the request payload.** A durable representation is too detailed for every provider route and makes request-size limits affect storage history. Deriving route-sized inline bytes keeps durable data stable while making request limits explicit.

**Derive request bytes on every call without a cache.** This avoids cache files, but repeats decoding and encoding for the same attachment and route policy. The deterministic cache reuses work without changing the request identity.

**Refuse text-only model selection after any image.** Durable history can outlive the model that first consumed it. Request-local placeholders keep the session usable without rewriting history.

**Remove one image whenever a request crosses its limit.** That changes an early request message after nearly every new upload. Quantized removed prefixes keep cache invalidation occasional while honoring the configured high bound.

## Verification

Package tests generate 16-bit RGB and RGBA PNG fixtures, prove 8-bit conversion and clean 8-bit passthrough, retain alpha under byte pressure, distinguish high-frequency and ordinary photos from low-color graphics, stop lazy encoding after the first fitting candidate, cover square and wide 640,000-pixel projections, enforce request byte budgets, singleflight equal variants without shared-cancellation leaks, bound transform concurrency, preserve cache identity, skip attachment reads for conservatively offloaded history, prepare batches once, normalize provider diagnostics, project text-only history, and share normal/compaction request bytes. Keyless assembled snapshots cover the real tool schemas and image request path. Provider tests cover configured routes and inline image conversion.

## Consequences

Normalized attachments consume up to the independent local safety cap, while request caches consume additional derived storage. Deterministic identities and singleflight make that work reusable across turns and sessions sharing the same Clocky home. Two simultaneous transforms reduce batch latency while increasing peak RSS relative to serial execution; deployments with tighter memory can set the limit to one. Encoder or transform-version changes create new future identities without rewriting existing history. Missing or corrupt durable attachments still require the separate quarantine design.
