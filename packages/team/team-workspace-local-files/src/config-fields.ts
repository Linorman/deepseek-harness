/** Shared local file publication and portable integration schema fields. */
import z from '@clocky/schemastery'

/** Validators shared by local file publication and portable integration configuration. */
export interface LocalWorkspaceFileConfigFields {
  /** Optional artifact-store provider identity. */
  artifactProvider: z<string>
  /** Integral positive file publication bound with the provider-selected default. */
  maxArtifactBytes: z<number>
  /** Optional integration-root string, canonicalized by the calling provider. */
  integrationRoot: z<string>
  /** Explicit integration authority, disabled by default. */
  integrationEnabled: z<boolean>
  /** Integral positive portable patch bound with the provider-selected default. */
  maxIntegrationBytes: z<number>
}

/** Build the shared field validators with defaults selected explicitly by each provider.
 * @param maxArtifactBytes - Owning provider's default regular-file publication bound.
 * @param maxIntegrationBytes - Owning provider's default portable patch bound.
 * @returns schema fields; root normalization and provider-specific fields remain with the consumer.
 */
export function localWorkspaceFileConfigFields(maxArtifactBytes: number, maxIntegrationBytes: number): LocalWorkspaceFileConfigFields {
  return {
    artifactProvider: z.string().min(1),
    maxArtifactBytes: z.number().step(1).min(1).default(maxArtifactBytes),
    integrationRoot: z.string(),
    integrationEnabled: z.boolean().default(false),
    maxIntegrationBytes: z.number().step(1).min(1).default(maxIntegrationBytes),
  }
}
