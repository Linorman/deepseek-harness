/** Model-visible parameters for complete declarative workflow plans. @module @clocky/clocky-tool-team-task/workflow-schema */

const strings = { type: 'array', items: { type: 'string' }, required: true } as const
const extension = {
  name: { type: 'string', required: true },
  version: { type: 'integer', required: true },
  config: { type: 'json', required: true },
} as const
const target = {
  oneOf: [
    { type: 'object', additionalProperties: false, properties: {
      kind: { type: 'string', const: 'participant', required: true }, role: { type: 'string', required: true },
    } },
    { type: 'object', additionalProperties: false, properties: {
      kind: { type: 'string', enum: ['round-robin', 'stay', 'return-to-initiator', 'terminate'], required: true },
    } },
    { type: 'object', additionalProperties: false, properties: {
      kind: { type: 'string', const: 'extension', required: true }, ...extension,
    } },
  ],
} as const
const condition = {
  oneOf: [
    { type: 'object', additionalProperties: false, properties: {
      kind: { type: 'string', const: 'always', required: true },
    } },
    { type: 'object', additionalProperties: false, properties: {
      kind: { type: 'string', const: 'envelope-kind', required: true }, value: { type: 'string', required: true },
    } },
    { type: 'object', additionalProperties: false, properties: {
      kind: { type: 'string', const: 'payload-present', required: true }, path: { type: 'string', required: true },
    } },
    { type: 'object', additionalProperties: false, properties: {
      kind: { type: 'string', const: 'payload-equals', required: true }, path: { type: 'string', required: true },
      value: { type: 'json', required: true },
    } },
    { type: 'object', additionalProperties: false, properties: {
      kind: { type: 'string', const: 'extension', required: true }, ...extension,
    } },
  ],
} as const

const examples = [{
  version: 1, name: 'two-stage',
  tasks: [
    { id: 'research', subject: 'Gather evidence', description: 'Collect evidence and write findings to findings.txt.',
      blockedBy: [], requiredCapabilities: [], priority: 0, readScopes: [], writeScopes: ['findings.txt'],
      workspaceMode: 'shared', budget: {}, reviewPolicy: { kind: 'none' }, maxAttempts: 1 },
    { id: 'report', subject: 'Write the report', description: 'Read findings.txt and produce the requested report.',
      blockedBy: ['research'], requiredCapabilities: [], priority: 0, readScopes: ['findings.txt'], writeScopes: [],
      workspaceMode: 'shared', budget: {}, reviewPolicy: { kind: 'none' }, maxAttempts: 1 },
  ],
  bounds: { maxTasks: 2, maxParallelism: 1, maxTotalAttempts: 2 },
  channel: { participantRoles: ['coordinator', 'worker'], viewPolicy: { type: 'recent-window', version: 1 },
    graph: { initial: { kind: 'participant', role: 'coordinator' },
      transitions: [{ condition: { kind: 'always' }, target: { kind: 'terminate' } }], maxTurns: 1 } },
  result: { kind: 'task-results', taskTemplateIds: ['report'] },
}]

/** Complete plan input; semantic DAG and deployment checks remain with TeamRun. */
export const WORKFLOW_PLAN_PARAMETER = {
  type: 'object', required: true, additionalProperties: false,
  description: 'A complete task DAG. Use plan-local task ids in blockedBy and result.taskTemplateIds. Select only configured participant roles and capabilities; extensions require explicit installation.',
  properties: {
    version: { type: 'integer', const: 1, required: true },
    name: { type: 'string', required: true },
    tasks: { type: 'array', required: true, items: {
      type: 'object', additionalProperties: false, properties: {
        id: { type: 'string', required: true },
        subject: { type: 'string', required: true },
        description: { type: 'string', required: true, description: 'Self-contained task brief, expected output, and verification.' },
        blockedBy: { ...strings, description: 'Prerequisite task ids; use [] for a ready task.' },
        requiredCapabilities: { ...strings, description: 'Use the configured worker capability shown in your Team instructions.' },
        priority: { type: 'integer', required: true, description: 'Nonnegative priority; 0 is ordinary priority.' },
        readScopes: strings,
        writeScopes: strings,
        workspaceMode: { type: 'string', required: true, enum: ['shared', 'worktree', 'sandbox', 'remote'], description: 'Use shared unless another provider is mounted.' },
        budget: { type: 'object', additionalProperties: true, required: true, description: 'Task-specific resource restrictions; {} adds none.' },
        reviewPolicy: { required: true, oneOf: [
          { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', const: 'none', required: true } } },
          { type: 'object', additionalProperties: false, properties: {
            kind: { type: 'string', const: 'participant', required: true }, reviewerRole: { type: 'string', required: true },
          } },
        ] },
        maxAttempts: { type: 'integer', required: true, description: 'Positive attempt limit, including the first attempt.' },
      },
    } },
    bounds: { type: 'object', required: true, additionalProperties: false, properties: {
      maxTasks: { type: 'integer', required: true, description: 'Positive limit at least the number of tasks.' },
      maxParallelism: { type: 'integer', required: true, description: 'Positive simultaneous-task limit.' },
      maxTotalAttempts: { type: 'integer', required: true, description: 'Positive total attempt limit for the plan.' },
    } },
    channel: { type: 'object', required: true, additionalProperties: false, properties: {
      participantRoles: { ...strings, description: 'Configured roles, normally coordinator and worker.' },
      viewPolicy: { type: 'object', required: true, additionalProperties: false, properties: {
        type: { type: 'string', required: true, description: 'Installed policy, for example recent-window.' },
        version: { type: 'integer', required: true, description: 'Exact installed policy version, normally 1.' },
      } },
      graph: { type: 'object', required: true, additionalProperties: false, properties: {
        initial: { ...target, required: true },
        transitions: { type: 'array', required: true, items: {
          type: 'object', additionalProperties: false, properties: {
            condition: { ...condition, required: true }, target: { ...target, required: true },
          },
        } },
        defaultTarget: target,
        maxTurns: { type: 'integer', required: true, description: 'Positive channel-turn limit.' },
      } },
    } },
    result: { type: 'object', required: true, additionalProperties: false, properties: {
      kind: { type: 'string', const: 'task-results', required: true }, taskTemplateIds: strings,
    } },
  },
  examples,

} as const
