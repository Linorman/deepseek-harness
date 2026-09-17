# Agent Note: Durable activation binding

Status: implemented

English | [中文](2026-08-28-durable-local-activation-binding.zh.md)

## Problem

An AgentRuntime provider can publish an activation before a Team provider records its epoch. Delivery based only on Session provenance can therefore admit model-visible input before the Team identifies the epoch, and a rejected bind can leave a live raw handle without an owning Team lease. A projection keyed only by Participant also prevents a cold-resumed epoch from retaining the prior offline epoch.

## Decision

`clocky-team` defines `ActivationBindingSnapshot`, bind/status/read operations, and `TEAM_ACTIVATION_NOT_FOUND`. `clocky-team-hub` stores `activation/changed` records in the Team journal and indexes projections by `ActivationId`. An agent Participant retains its offline epochs, every epoch names the same Session, and at most one epoch is resident. Team journal format 7 and checkpoint format 8 persist this projection.

`clocky-team-activation-controller` is the Team Consumer that reads an active local-agent or remote-agent Participant, rejects another Session or a resident epoch before placement, asks `ctx.agentRuntimes` for a handle, records the returned epoch through `ctx.teams.bindActivation()`, and only then returns a `TeamActivationLease`. Binding failure disposes the raw handle. Failed cleanup stays keyed to the Team and Participant even without capacity reservations, preventing another startup until termination succeeds. Confirmed termination survives a failed reservation-release write so retries do not dispose the handle twice. Failed shutdown can retry retained cleanup while admission stays closed. Reservations whose provider was never called retain their release owner through storage failures. A bind error does not prove that the journal rejected the epoch: cleanup rereads the attempted identity and settles any committed binding through its controller-owned quiescence proof. Termination, readback and durable settlement retry independently, retaining the known termination result. The lease owns interruption, health reconciliation, and stopping/offline disposal. The controller subscribes to its exact handle's status stream and updates the durable epoch with serialized cursor-conflict retries.

The activation request cursor protects initial admission. Provider startup runs outside the Team queue, so another task can advance that journal while the handle is prepared. The controller therefore reads a fresh cursor before binding the prepared handle; Hub proof, membership and admission checks still run under the Team queue. Unrelated progress during startup does not require disposing and recreating the same residency.

`clocky-team-agent-client` reconciles Session provenance against the durable binding before Link connection or inbox admission. It accepts only the exact running or idle epoch and uses the Link claim as the final inbox authorization. The Link carries the exact activation and Session with post and receipt operations, so the Hub rejects a stopping, offline, or replaced epoch under its Team-to-channel lock.

## Alternatives considered

**Let Team Hub create AgentRuntime activations.** Rejected because the Hub owns replayable Team facts, while placement and handle teardown belong to AgentRuntime providers and their caller-owned handles.

**Bind from `agent-runtime/activation-changed`.** Rejected because the event is post-publication, does not carry the handle or Session binding, and cannot make durable binding a condition of a public lease.

**Trust Session provenance alone for delivery.** Rejected because provenance identifies a logical Participant but does not prove that a particular activation epoch reached the Team journal.

## Consequences

Local delivery may begin only after a durable activation binding exists. An offline epoch can cold-resume the same Session under a new ActivationId without losing prior auditability. The controller owns accepted handles and releases them during shutdown; provider unload still does not revoke handles already returned to the controller. Stale fencing verifies the full owned epoch identity before disposal. Without a local owner it requires the exact provider fencer or persisted termination evidence; a missing handle or offline status cannot authorize durable quiescence. Accepted stale fences own the Participant recovery slot through provider termination and journal writeback, including during close. Proof-source registration effects are collected by the same generator effect as shutdown, so plugin unload cannot retire them ahead of admitted cleanup.

`claimChannelDelivery()` now linearizes a local direct delivery against its exact durable activation and pending channel admission. A remote binding still does not authorize direct delivery; remote Links require their own authenticated framing and cross-process claim and receipt path.

## Verification

The concurrent-start regression advances the real Team journal while its actual in-process provider prepares a handle, then verifies one activation and one provider call. The runnable mixed-resource example starts a workflow before creating a reviewer, reaches simultaneous running/pending/review tasks and a pending approval, and verifies current-owner cancellation and resource settlement.

Core and Hub tests validate activation schemas, lifecycle edges, local-agent and remote-agent binding, immutable Session/provider binding, JSON and SQLite restart recovery, multiple offline epochs, malformed journal/checkpoint rejection, and delivery-claim causal receipts. Controller tests cover bind-or-dispose failure handling, concurrent joins, handle-status synchronization, shutdown, and fresh-to-resume epochs. Local client tests prove that an unbound provenance Agent receives neither inbox input nor receipt until the matching durable binding commits, and that a claim prevents a stopping epoch from winning a new direct admission.
