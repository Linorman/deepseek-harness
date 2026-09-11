/** Authenticated HTTP supervisor client and durable process-owner endpoint. */
export { createHttpActivationSupervisor } from './client.ts'
export { SdkProcessSupervisor, listenSupervisorEndpoint } from './endpoint.ts'
export type { SupervisorHttpEndpoint } from './endpoint.ts'
export { SUPERVISOR_HTTP_VERSION } from './protocol.ts'
