# Storage Log

English | [中文](README.zh.md)

`@clocky/clocky-storage-log` mounts the routed `ctx.storage.log` form and injectable `ctx.storageLog` facility. Consumers declare a stream with `defineLogStream({ name, version })`, list materialized streams that remain owned by the active route table, open one handle, append whole batches with an expected tail sequence, page the durable records, store a monotonic projection checkpoint, and compact an obsolete prefix only behind an exact later checkpoint. Compacted cursors fail explicitly instead of returning a misleading gap. The selected backend owns atomicity and recovery; JSON and SQLite both implement the log facet.

`backend` is required. `routes` can select a named backend per stream; only own route keys override the default, so opaque names such as `constructor`, `team/<id>`, and `channel/<id>` remain safe. An unknown backend or one without a log facet fails when the consumer opens that stream. The returned handle is caller-owned and must be closed when its projection/runtime ends. Plugin unload closes admission, drains accepted opens, settles all returned handles, then unmounts the form; an aggregate cleanup failure is reported only after every owned handle settles.

## Model Experience

### Request context and condition

#### What the model sees

`ctx.storage.log` is a host-side data form and exposes no prompt section, tool, or model-visible event.

#### Token effect

Zero direct token effect.

#### KV Cache effect

No model request or prompt prefix is owned by this package.

## Known Limitations and Deferred Work

- **No Team-specific semantics** — [`@clocky/clocky-team-hub`](../../team/team-hub/README.md) owns Team and channel formats, projections, and recovery; this form only routes their durable streams. Delivery and scheduling remain outside both packages.
