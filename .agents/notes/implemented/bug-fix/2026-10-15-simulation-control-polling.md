# Agent Note: Simulation control polling

Status: implemented

English | [中文](2026-10-15-simulation-control-polling.zh.md)

## Problem

The World header polls control hints independently from domain content. A cold read can replay enough retained history to outlast that interval. Cancelling the same selected read on every tick can starve the control observation and leave recovery actions unavailable.

## Decision

`SimulationRuntime.control()` shares the pending promise only for the same run, credential generation and active control request. After settlement, another call reads fresh state. Another run or retired request starts a new observation; the existing read owner still aborts old IO and refuses stale publication. The shared promise is installed before publishing loading state, so synchronous listeners cannot create a second poll. Completion releases only its own slot.

## Alternatives considered

A longer polling interval would tie correctness to replay speed and deployment history. Sharing unrelated reads would change independent selection and explicit refresh contracts. The control owner alone coalesces its repeated observation.

## Consequences

This changes read scheduling, with no new management command, writable owner, Native event or model call. Tests hold the original response across repeated polls, then verify settlement, a new run, credential replacement and late denied replies. Real browser acceptance uses retained long history and explicit paused recovery.
