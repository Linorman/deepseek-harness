# Agent Note: Local object name mutation

Status: implemented

English | [中文](2026-10-19-local-object-mutation.zh.md)

## Problem

Whole-run maintenance interrupts unrelated actors for a name-only object change. Bypassing that barrier without a complete scope would let old model contexts cross a mutation boundary.

## Decision

The versioned `organization/rename-object/1` operation changes only a plain non-cognitive object's name. The target must be active, have no Participant, Session or writer, and contain only name and optional description metadata. The original target revision, strict request and accepted plan remain unchanged through retries; description and identity are preserved. The portable v1 compiler accepts non-cognitive `object` entities without changing existing entity projections.

Native computes the write footprint and rechecks the original plan's reads and authority inside its sole commit queue. The private Native mutation record retains target/revision, absent writer epoch, related relations, resources, channels and permission relations, independently recomputed on replay. Native stream 100 rejects earlier formats; the public business result does not disclose these private references. Exact authorization relations are read dependencies, not writes. Other target relationships, resource ownership/control or channel membership require whole-run maintenance. No cross-owner IO occurs in the local path, so there is one Native gate rather than a second lock protocol. Unrelated model execution outside that queue can continue while the append is durable.

An open or submitted decision permits local execution only when its prepared World context belongs to this exact immutable provider and carries a disjoint read set. This provider's planning context exposes only the original request and target name. A retained request receipt with no live reads remains immutable. Unknown domain contexts, missing reads and overlaps take the original canonical quiescence path; unsupported providers do likewise. The fallback reason is retained in its maintenance owner and atomic result. Only the matching plan's quiescent maintenance permits this mutation; cancellation does not discard accepted maintenance responsibility.

Checkpoint cuts retain priority over local commits under the existing [maintenance control-cut rules](2026-10-14-world-maintenance-control-cut.md). Native revalidates authority and target revision immediately before append. The atomic mutation uses the existing journal and result identity; exact retries do not duplicate effects. A crashed process never releases inherited writer responsibility merely because this name mutation completed. Personnel, cognition, representation, global institutions, arbitrary profiles and cross-owner resource changes remain outside this local capability.

## Alternatives considered

Increasing the global mutation limit provides no read-dependency proof. Treating every domain read set as complete would trust capabilities that never declared that guarantee. The existing whole-run path remains the conservative fallback.

## Consequences

The [B3c evidence](../../../plans/2026-10-16-world-post-mvp/evidence/b3c/) records two-backend canonical request/plan/window tests, cancellation and fallback, stale/revoked sources, checkpoint exclusion, SIGKILL before/after append and a real Loader snapshot. The fixed comparison uses the same rename request and accepted plan with a provider adapter that omits local eligibility for the control route. Its original limits, identities and history remain intact. This demonstrates the isolated-name optimization; it does not establish concurrent hiring, arbitrary domain safety or multi-owner gate support.
