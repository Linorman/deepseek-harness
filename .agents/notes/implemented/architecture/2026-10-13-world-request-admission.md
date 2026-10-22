# Agent Note: World request admission

Status: implemented

English | [中文](2026-10-13-world-request-admission.zh.md)

## Problem

An unchanged assignment relation does not establish current employment when its position or organization has terminated. Likewise, a permission relation cannot authorize work through inactive endpoints. Hiring policy checks deferred entirely to reservation allow requests outside an effective institution's position allowlist to become cases. A previously opened intent must not bypass the first real request's current admission checks.

## Decision

[Core request admission](../../../../packages/simulation/simulation-local/src/world.ts) derives authority from Native entities, current scoped assignments, installed operation pins and actual permission relations. Employment requires an active noncognitive position and organization. Grant endpoints must remain active and match their original declared relation kinds. A profile claiming another role, model-supplied identity, Session or proof cannot substitute for these sources.

[Hiring admission](../../../../packages/simulation/simulation-local/src/world-hire-approval.ts) checks the position allowlists of every currently effective validated policy. Availability and audience govern disclosure, not hard authorization. Future and advisory policies do not enforce this restriction. Generated hiring also checks its actual active noncognitive target and organization. A preopened intent without an accepted request re-enters the domain's admission at first goal submission; exact accepted request receipts retain their original semantics.

Fresh goal candidates re-enter admission without an `original` argument. Only an intent already retained in the authoritative Native prefix can be supplied as the original; a virtual candidate is not persisted execution evidence. Personnel domains keep their exact-original checks for preopened intents and execution.

Committee approval remains bound to one accepted request and is checked at reserve and commit. Requiring that approval before creating its request would create a circular prerequisite. Policy rejection uses a fixed reason without private policy body or identity. A model can abandon the refused proposal and submit no effects through the ordinary tools.

## Alternatives considered

**Trust relation dates alone.** A live interval can outlast its endpoint, making a historical relationship appear to authorize new work.

**Check policy only when creating identities.** A disallowed request already creates a case and private notification responsibility.

**Revalidate every receipt retry as new work.** This would turn reconciliation of an accepted original into a second business admission, violating idempotency.

## Consequences

Native stream 94 rejects prior streams instead of silently changing their request-admission interpretation. Compiler 9 remains unchanged. Dual-backend tests cover lifecycle revocation, identity/profile forgery, preopened intents, private effective policy, and exact receipt retries. Real Loader scenarios prove denied requests create no World case or financial effect, disclose no private policy body, and retain durable failed tool evidence; positive scenarios still obtain independent approval after case creation and hire once through cold recovery.
