/** Native Simulation object identities without provider, Session or Cordis declarations. */
import type { Branded } from '@clocky/clocky-brand'

/** Stable run-local retry identity for a configured direct channel. */
export type SimulationChannelKey = Branded<'SimulationChannelKey'>

/** Durable entity identity within one run. */
export type SimulationEntityId = Branded<'SimulationEntityId'>
/** Stable business-decision identity within one run. */
export type SimulationDecisionId = Branded<'SimulationDecisionId'>
/** Canonical decimal serial decision position. */
export type SimulationDecisionSlot = Branded<'SimulationDecisionSlot'>
/** Stable operation retry identity within one run. */
export type SimulationOperationId = Branded<'SimulationOperationId'>
/** Stable run-wide identity for one immutable external-operation retry authorization. */
export type SimulationOutboxRetryId = Branded<'SimulationOutboxRetryId'>
/** Stable caller-retained checkpoint identity within one run. */
export type SimulationCheckpointId = Branded<'SimulationCheckpointId'>
/** Canonical decimal writer epoch, monotonically increasing for one entity. */
export type SimulationWriterEpoch = Branded<'SimulationWriterEpoch'>

/** Durable scheduled event identity within one run. */
export type SimulationEventId = Branded<'SimulationEventId'>
/** Original run-local external input identity. */
export type SimulationIngressId = Branded<'SimulationIngressId'>
/** Durable organization relation identity within one run. */
export type SimulationRelationId = Branded<'SimulationRelationId'>
