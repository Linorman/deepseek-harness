/** Shared implementation exports for local Team workspace providers. */
export * from './files.ts'
export { integrateLocalDirectory, integrateSerializedLocalDirectory } from './integration.ts'
export type { LocalDirectoryIntegrationOptions } from './integration.ts'
export { localWorkspaceFileConfigFields } from './config-fields.ts'
