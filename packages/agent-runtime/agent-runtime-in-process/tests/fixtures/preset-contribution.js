export const name = 'agent-runtime-in-process-preset-fixture'
export const inject = ['tools', 'systemPrompt']

export function apply(ctx) {
  ctx.effect(() => ctx.tools.register({
    name: 'coordinator',
    description: 'Coordinator preset fixture tool.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    execute: () => Promise.resolve('coordinator'),
  }))
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'preset:coordinator',
    order: 10,
    text: 'Coordinator preset guidance.',
  }))
}
