/** Forbidden structured proposals through the installed simulated external operation; all credential values are fixture markers. */
export const negativeCases = [
  'request-source', 'request-sink', 'request-create-resource', 'request-sender', 'request-url', 'request-network-adapter',
  'request-email', 'request-payment', 'request-credential', 'plan-source', 'plan-sink', 'plan-create-resource', 'plan-sender',
  'plan-url', 'plan-network-adapter', 'plan-email', 'plan-payment', 'plan-credential',
] as const
export type BoundaryCase = typeof negativeCases[number]
export function forbiddenPayload(name: BoundaryCase, original: Record<string, unknown>): Record<string, unknown> {
  const position = name.startsWith('request-') ? 'request' : 'plan', family = name.slice(position.length + 1)
  const field = family === 'source' ? { source: { resourceId: 'supplier-stock', quantity: '1', reason: 'uninstalled', grant: 'not-installed' } }
    : family === 'sink' ? { sink: { resourceId: 'supplier-money', quantity: '1', reason: 'uninstalled', grant: 'not-installed' } }
      : family === 'create-resource' ? { createResource: { id: 'forbidden-stock', owner: 'external-boundary-supplier',
        kind: 'inventory', unit: 'widget', quantity: '999', controllers: [] } }
        : family === 'sender' ? { sender: 'external-boundary-supplier' }
          : family === 'url' ? { url: 'https://supplier.example.invalid/execute' }
            : family === 'network-adapter' ? { adapter: { kind: 'network-adapter', provider: 'not-installed', endpoint: 'https://example.invalid' } }
              : family === 'email' ? { email: { to: 'supplier@example.invalid', subject: 'forbidden', body: 'fixture' } }
                : family === 'payment' ? { payment: { account: 'supplier-money', quantity: '1', currency: 'credit' } }
                  : { credentials: { token: 'fixture-marker-not-a-secret' } }
  if (position === 'plan' && ['source', 'sink', 'create-resource'].includes(family)) {
    return { ...original, outcome: { kind: family === 'create-resource' ? 'resource/create' : family, ...field } }
  }
  return { ...original, ...field }
}
