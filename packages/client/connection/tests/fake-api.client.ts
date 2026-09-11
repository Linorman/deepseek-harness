// Test-local programmable IApiClient fake (NOT the fixture: fixture is a demo
// data source on a real clock; behavior tests need per-case responses and
// deferred-controlled timing). Streams are hand pumps: pushMux/pushHost.
import type {
  HostFrame, IApiClient, ModelSelection, MuxFrame, RpcError,
  ResponseValue, RpcRequest, RpcResponse, SessionId, SessionModels, SessionSearchItem, SkillEntry, WorkspaceId,
} from '../src/client/api.ts'
import type { RequestPayload } from '@clocky/clocky-host-apiproxy/api'
import { emptyTeamLatencyHistogram, RpcId } from '../src/client/api.ts'

type FakeTeamState = ResponseValue<'team.get'>
type FakeTeamId = RequestPayload<'team.get'>['teamId']
type FakeTeamChannelId = ResponseValue<'team.waitFinal'>['channelId']
type FakeTeamEnvelopeId = ResponseValue<'team.waitFinal'>['envelopeId']

const fakeTeamId = (value: string): FakeTeamId => value as FakeTeamId
const fakeTeamChannelId = (teamId: FakeTeamId): FakeTeamChannelId => `fk-team-channel-${String(teamId)}` as FakeTeamChannelId
const fakeTeamEnvelopeId = (value: string): FakeTeamEnvelopeId => value as FakeTeamEnvelopeId

function fakeTeamState(teamId: FakeTeamId, objective: string): FakeTeamState {
  const goal: FakeTeamState['goal'] = {
    teamId,
    revision: 1,
    objective,
    phase: 'active',
    budgets: {},
  }
  const humanId = `fk-team-human-${String(teamId)}` as FakeTeamState['participants'][number]['id']
  const coordinatorId = `fk-team-coordinator-${String(teamId)}` as FakeTeamState['participants'][number]['id']
  return {
    team: {
      id: teamId,
      depth: 0,
      maxTeamDepth: 4,
      goal,
      phase: 'active',
      cursor: 0,
      createdAt: 1_750_000_000_000,
      updatedAt: 1_750_000_000_000,
    },
    goal,
    rules: {},
    budgets: {},
    participants: [
      {
        id: humanId,
        teamId,
        kind: 'human',
        displayName: 'Fake human',
        role: 'human',
        capabilities: [],
        phase: 'active',
      },
      {
        id: coordinatorId,
        teamId,
        kind: 'local-agent',
        displayName: 'Fake coordinator',
        role: 'coordinator',
        capabilities: [],
        phase: 'active',
      },
    ],
    activations: [{
      activation: {
        id: `fk-team-activation-${String(teamId)}` as FakeTeamState['activations'][number]['activation']['id'],
        teamId,
        participantId: coordinatorId,
        status: 'idle',
      },
      sessionId: `fk-team-session-${String(teamId)}` as FakeTeamState['activations'][number]['sessionId'],
      provider: 'in-process',
    }],
    tasks: [],
    workspaceAllocations: [],
    channelIds: [fakeTeamChannelId(teamId)],
  }
}

export interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

/** Test-held settlement: the case decides when an RPC lands (history-pending injections etc.). */
export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

let nextRpc = 0

export function ok<T>(value: T): RpcResponse<T> {
  return { rpcId: RpcId(`fake-${nextRpc++}`), result: { ok: true, value } }
}

/** Default rejection for Team management methods not used by connection-only cases. */
function teamManagementError<T>(): RpcResponse<T> {
  const error: RpcError = {
    code: 'internal', message: 'connection fake does not implement Team management', details: {},
  }
  return { rpcId: RpcId(`fake-${nextRpc++}`), result: { ok: false, error } }
}


type StreamItem<F> = { kind: 'frame'; envelope: RpcRequest<F> } | { kind: 'end' } | { kind: 'fail'; error: unknown }

interface StreamConn<F> {
  feed(item: StreamItem<F>): void
}

export class FakeApiClient implements IApiClient {
  /** Chronological call record: [method, payload]. */
  readonly calls: { method: string; payload: unknown }[] = []

  // Programmable slots (defaults answer OK-empty); reassign per case.
  onList: (payload: unknown) => Promise<RpcResponse<{ items: never[] }>> = () => Promise.resolve(ok({ items: [] }))
  onSearch: (payload: unknown) => Promise<RpcResponse<{ items: SessionSearchItem[]; hasMore: boolean }>> =
    () => Promise.resolve(ok({ items: [], hasMore: false }))
  onRename: (payload: unknown) => Promise<RpcResponse<{ title: string; seq: number }>> = () => Promise.resolve(ok({ title: 'fk-renamed', seq: 0 }))
  onHistory: (payload: { sessionId: SessionId; beforeSeq?: number; maxMessages?: number })
  => Promise<RpcResponse<{ events: never[]; hasMore: boolean; modelSelection: ModelSelection }>> =
    () => Promise.resolve(ok({
      events: [],
      hasMore: false,
      modelSelection: { provider: 'test-provider', model: 'test-model' },
    }))

  onModels: (payload: unknown) => Promise<RpcResponse<SessionModels>> = () => Promise.resolve(ok({
    current: { provider: 'test-provider', model: 'test-model' },
    routable: true,
    groups: [],
    failures: [],
  }))
  onSelectModel: (payload: ModelSelection & { sessionId: SessionId })
  => Promise<RpcResponse<{ selected: ModelSelection }>> =
    payload => Promise.resolve(ok({ selected: { provider: payload.provider, model: payload.model } }))
  onPrompt: (payload: unknown) => Promise<RpcResponse<{ accepted: true }>> = () => Promise.resolve(ok({ accepted: true as const }))
  onAttachment: (payload: unknown) => Promise<RpcResponse<{ attachment: { attachmentId: never; mediaType: 'image/png'; bytes: number; width: number; height: number }; data: string }>> =
    () => Promise.resolve(ok({ attachment: { attachmentId: 'a' as never, mediaType: 'image/png', bytes: 1, width: 1, height: 1 }, data: 'AA==' }))
  onUpdateQueue: (payload: unknown) => Promise<RpcResponse<{ accepted: true }>> = () => Promise.resolve(ok({ accepted: true as const }))
  onCancel: (payload: unknown) => Promise<RpcResponse<{ accepted: true }>> = () => Promise.resolve(ok({ accepted: true as const }))
  onDescribe: (payload: unknown) => Promise<RpcResponse<{
    version: string
    cwd: string
    attachedSessions: number
    home: string
    canOpenPath: boolean
  }>> =
    () => Promise.resolve(ok({
      version: '0-fake', cwd: '/f', attachedSessions: 0, home: '/h', canOpenPath: true,
    }))
  onPickDirectory: (payload: unknown) => Promise<RpcResponse<{ path: string | null }>> =
    () => Promise.resolve(ok({ path: null }))
  onOpenPath: (payload: unknown) => Promise<RpcResponse<{ opened: true }>> =
    () => Promise.resolve(ok({ opened: true as const }))

  onListDirectory: (payload: unknown) => Promise<RpcResponse<{
    path: string
    home: string
    crumbs: { name: string; path: string; hidden: boolean }[]
    entries: { name: string; path: string; hidden: boolean }[]
    truncated: boolean
  }>> =
    () => Promise.resolve(ok({ path: '/home/fake', home: '/home/fake', crumbs: [{ name: '/', path: '/', hidden: false }], entries: [], truncated: false }))

  onCreateDirectory: (payload: unknown) => Promise<RpcResponse<{ path: string }>> =
    () => Promise.resolve(ok({ path: '/home/fake/new' }))

  private readonly muxConns: StreamConn<MuxFrame>[] = []
  private readonly hostConns: StreamConn<HostFrame>[] = []
  lastSearchSignal: AbortSignal | undefined

  // Parameter annotations below are local structural types on purpose: the CI
  // lint lane runs without built artifacts, where IApiClient's wire types
  // (apiproxy subpath) resolve to any and inferred params trip no-unsafe-argument.
  readonly sessions: IApiClient['sessions'] = {
    list: (payload: unknown) => this.record('session.list', payload, this.onList(payload)),
    search: (payload: unknown, signal?: AbortSignal) => {
      this.lastSearchSignal = signal
      return this.record('session.search', payload, this.onSearch(payload))
    },
    history: (payload: { sessionId: SessionId; beforeSeq?: number; maxMessages?: number }) =>
      this.record('session.history', payload, this.onHistory(payload)),
    models: (payload: unknown) => this.record('session.models', payload, this.onModels(payload)),
    selectModel: (payload: ModelSelection & { sessionId: SessionId }) =>
      this.record('session.selectModel', payload, this.onSelectModel(payload)),
    rename: (payload: unknown) => this.record('session.rename', payload, this.onRename(payload)),
    prompt: (payload: unknown) => this.record('session.prompt', payload, this.onPrompt(payload)),
    attachment: (payload: unknown) => this.record('session.attachment', payload, this.onAttachment(payload)),
    updateQueue: (payload: unknown) => this.record('session.updateQueue', payload, this.onUpdateQueue(payload)),
    cancel: (payload: unknown) => this.record('session.cancel', payload, this.onCancel(payload)),
  }

  onTeamList: (payload: RequestPayload<'team.list'>) => Promise<RpcResponse<ResponseValue<'team.list'>>>
    = () => Promise.resolve(ok({ items: [fakeTeamState(fakeTeamId('fk-team'), 'Fake Team objective').team] }))
  onTeamGet: (payload: RequestPayload<'team.get'>) => Promise<RpcResponse<ResponseValue<'team.get'>>>
    = payload => Promise.resolve(ok(fakeTeamState(payload.teamId, 'Fake Team objective')))
  onTeamCreate: (payload: RequestPayload<'team.create'>) => Promise<RpcResponse<ResponseValue<'team.create'>>>
    = payload => Promise.resolve(ok(fakeTeamState(fakeTeamId('fk-team'), payload.objective)))
  onTeamResume: (payload: RequestPayload<'team.resume'>) => Promise<RpcResponse<ResponseValue<'team.resume'>>>
    = payload => Promise.resolve(ok(fakeTeamState(payload.teamId, 'Fake Team objective')))
  onTeamStart: (payload: RequestPayload<'team.start'>) => Promise<RpcResponse<ResponseValue<'team.start'>>>
    = payload => Promise.resolve(ok({
      state: fakeTeamState(fakeTeamId('fk-team'), payload.objective),
      envelopeId: fakeTeamEnvelopeId('fk-team-envelope'),
    }))
  onTeamPostInput: (payload: RequestPayload<'team.postInput'>) => Promise<RpcResponse<ResponseValue<'team.postInput'>>>
    = () => Promise.resolve(ok({ envelopeId: fakeTeamEnvelopeId('fk-team-envelope') }))
  onTeamWaitFinal: (payload: RequestPayload<'team.waitFinal'>) => Promise<RpcResponse<ResponseValue<'team.waitFinal'>>>
    = payload => Promise.resolve(ok({
      teamId: payload.teamId,
      channelId: fakeTeamChannelId(payload.teamId),
      envelopeId: fakeTeamEnvelopeId('fk-team-final'),
      text: 'Fake Team final.',
    }))
  onTeamCancel: (payload: RequestPayload<'team.cancel'>) => Promise<RpcResponse<ResponseValue<'team.cancel'>>>
    = () => Promise.resolve(ok({ accepted: true as const, phase: 'cancelled' as const }))
  onTeamQuiescence: (payload: RequestPayload<'team.quiescence'>) => Promise<RpcResponse<ResponseValue<'team.quiescence'>>>
    = payload => Promise.resolve(ok({
      teamId: payload.teamId,
      quiescent: true,
      reasons: [],
      activeTaskIds: [],
      activeActivationIds: [],
      activeWorkspaceAllocationIds: [],
      openChannelIds: [],
    }))
  onTeamMetrics: (
    payload: RequestPayload<'team.metrics'>,
  ) => Promise<RpcResponse<ResponseValue<'team.metrics'>>>
    = () => Promise.resolve(ok({
      activeAdmissions: 0,
      pendingDeliveries: 0,
      activeActivations: 0,
      activeTasks: 0,
      stalledTeams: 0,
      replayLag: 0,
      lastTaskLatencyMs: 0,
      lastReceiptLatencyMs: 0,
      taskLatency: emptyTeamLatencyHistogram(),
      receiptLatency: emptyTeamLatencyHistogram(),
      workspaceConflicts: 0,
      teamEvents: 0,
      channelEvents: 0,
      policyDenials: 0,
      adapterFailures: 0,
      deliveryClaims: 0,
      taskAssignments: 0,
      taskRetries: 0,
      teamCompactions: 0,
      channelCompactions: 0,
      checkpointFailures: 0,
      auditProjectionRepairs: 0,
      auditProjectionFailures: 0,
      updatedAt: 0,
    }))
  onTeamTaskReview: (payload: RequestPayload<'team.task.review'>) => Promise<RpcResponse<ResponseValue<'team.task.review'>>>
    = () => Promise.resolve(teamManagementError())
  onTeamMemberActivate: (payload: RequestPayload<'team.member.activate'>) => Promise<RpcResponse<ResponseValue<'team.member.activate'>>>
    = () => Promise.resolve(teamManagementError())
  onTeamTaskCancel: (payload: RequestPayload<'team.task.cancel'>) => Promise<RpcResponse<ResponseValue<'team.task.cancel'>>>
    = () => Promise.resolve(teamManagementError())
  onTeamTaskDelete: (payload: RequestPayload<'team.task.delete'>) => Promise<RpcResponse<ResponseValue<'team.task.delete'>>>
    = () => Promise.resolve(teamManagementError())

  readonly teams: IApiClient['teams'] = {
    inboxRespond: payload => this.record('team.inbox.respond', payload, Promise.resolve(teamManagementError())),
    inboxRead: payload => this.record('team.inbox.read', payload, Promise.resolve(ok({ items: [], displayCursor: -1, cursor: -1 }))),
    inboxWatch: payload => this.record('team.inbox.watch', payload, Promise.resolve(ok({ items: [], displayCursor: -1, cursor: -1 }))),
    inboxAcknowledge: payload => this.record('team.inbox.acknowledge', payload, Promise.resolve(teamManagementError())),
    list: (payload: RequestPayload<'team.list'>) => this.record('team.list', payload, this.onTeamList(payload)),
    get: (payload: RequestPayload<'team.get'>) => this.record('team.get', payload, this.onTeamGet(payload)),
    create: (payload: RequestPayload<'team.create'>) => this.record('team.create', payload, this.onTeamCreate(payload)),
    resume: (payload: RequestPayload<'team.resume'>) => this.record('team.resume', payload, this.onTeamResume(payload)),
    start: (payload: RequestPayload<'team.start'>) => this.record('team.start', payload, this.onTeamStart(payload)),
    postInput: (payload: RequestPayload<'team.postInput'>) => this.record('team.postInput', payload, this.onTeamPostInput(payload)),
    waitFinal: (payload: RequestPayload<'team.waitFinal'>) => this.record('team.waitFinal', payload, this.onTeamWaitFinal(payload)),
    cancel: (payload: RequestPayload<'team.cancel'>) => this.record('team.cancel', payload, this.onTeamCancel(payload)),
    archive: payload => this.record('team.archive', payload, Promise.resolve(teamManagementError())),
    goalUpdate: payload => this.record('team.goal.update', payload, Promise.resolve(teamManagementError())),
    goalTransition: payload => this.record('team.goal.transition', payload, Promise.resolve(teamManagementError())),
    quiescence: (payload: RequestPayload<'team.quiescence'>) => this.record('team.quiescence', payload, this.onTeamQuiescence(payload)),
    metrics: (payload: RequestPayload<'team.metrics'>) => this.record('team.metrics', payload, this.onTeamMetrics(payload)),
    auditRead: payload => this.record('team.audit.read', payload, Promise.resolve(teamManagementError())),
    artifactRead: payload => this.record('team.artifact.read', payload, Promise.resolve(teamManagementError())),
    artifactList: payload => this.record('team.artifact.list', payload, Promise.resolve(teamManagementError())),
    memberList: payload => this.record('team.member.list', payload, Promise.resolve(teamManagementError())),
    memberInvite: payload => this.record('team.member.invite', payload, Promise.resolve(teamManagementError())),
    memberActivate: payload => this.record('team.member.activate', payload, this.onTeamMemberActivate(payload)),
    memberRemove: payload => this.record('team.member.remove', payload, Promise.resolve(teamManagementError())),
    memberInterrupt: payload => this.record('team.member.interrupt', payload, Promise.resolve(teamManagementError())),
    channelCatalog: payload => this.record('team.channel.catalog', payload, Promise.resolve(teamManagementError())),
    channelList: payload => this.record('team.channel.list', payload, Promise.resolve(teamManagementError())),
    channelInput: payload => this.record('team.channel.input', payload, Promise.resolve(teamManagementError())),
    channelAttachment: payload => this.record('team.channel.attachment', payload, Promise.resolve(teamManagementError())),
    channelAdmission: payload => this.record('team.channel.admission', payload, Promise.resolve(teamManagementError())),
    channelInvitation: payload => this.record('team.channel.invitation', payload, Promise.resolve(teamManagementError())),
    channelInvitationAcknowledge: payload => this.record('team.channel.invitation.acknowledge', payload, Promise.resolve(teamManagementError())),
    channelOpen: payload => this.record('team.channel.open', payload, Promise.resolve(teamManagementError())),
    channelPost: payload => this.record('team.channel.post', payload, Promise.resolve(teamManagementError())),
    channelSummarize: payload => this.record('team.channel.summarize', payload, Promise.resolve(teamManagementError())),
    channelRead: payload => this.record('team.channel.read', payload, Promise.resolve(teamManagementError())),
    channelClose: payload => this.record('team.channel.close', payload, Promise.resolve(teamManagementError())),
    channelWatch: payload => this.record('team.channel.watch', payload, Promise.resolve(teamManagementError())),
    taskCreate: payload => this.record('team.task.create', payload, Promise.resolve(teamManagementError())),
    taskGet: payload => this.record('team.task.get', payload, Promise.resolve(teamManagementError())),
    taskList: payload => this.record('team.task.list', payload, Promise.resolve(teamManagementError())),
    workflowPlanList: payload => this.record('team.workflow.plan.list', payload, Promise.resolve(teamManagementError())),
    taskUpdate: payload => this.record('team.task.update', payload, Promise.resolve(teamManagementError())),
    taskCancel: payload => this.record('team.task.cancel', payload, this.onTeamTaskCancel(payload)),
    taskDelete: payload => this.record('team.task.delete', payload, this.onTeamTaskDelete(payload)),
    taskReview: payload => this.record('team.task.review', payload, this.onTeamTaskReview(payload)),
    taskWatch: payload => this.record('team.task.watch', payload, Promise.resolve(teamManagementError())),
  }

  readonly host: IApiClient['host'] = {
    describe: payload => this.record('host.describe', payload, this.onDescribe(payload)),
    pickDirectory: payload => this.record('host.pickDirectory', payload, this.onPickDirectory(payload)),
    listDirectory: payload => this.record('host.listDirectory', payload, this.onListDirectory(payload)),
    createDirectory: payload => this.record('host.createDirectory', payload, this.onCreateDirectory(payload)),
    openPath: payload => this.record('host.openPath', payload, this.onOpenPath(payload)),
  }

  readonly workspace: IApiClient['workspace'] = {
    list: (payload: unknown) => this.record('workspace.list', payload, Promise.resolve(ok({ items: [], archivedSessionIds: [] }))),
    create: (payload: unknown) => this.record('workspace.create', payload, Promise.resolve(ok({
      workspace: { workspaceId: 'fk-ws' as never, path: '/f/ws', title: 'ws', sessionIds: [], createdAt: '0', updatedAt: '0' },
      created: true,
    }))),
    rename: (payload: unknown) => this.record('workspace.rename', payload, Promise.resolve(ok({
      workspace: { workspaceId: 'fk-ws' as never, path: '/f/ws', title: 'ws', sessionIds: [], createdAt: '0', updatedAt: '0' },
    }))),
    delete: (payload: unknown) => this.record('workspace.delete', payload, Promise.resolve(ok({ deleted: true as const }))),
    insertBefore: (payload: unknown) => this.record('workspace.insertBefore', payload, Promise.resolve(ok({
      workspaceIds: [(payload as { workspaceId: WorkspaceId }).workspaceId],
    }))),
    insertSessionBefore: (payload: unknown) => this.record('workspace.insertSessionBefore', payload, Promise.resolve(ok({
      workspace: { workspaceId: 'fk-ws' as never, path: '/f/ws', title: 'ws', sessionIds: [], createdAt: '0', updatedAt: '0' },
    }))),
    archiveSession: (payload: unknown) => this.record('workspace.archiveSession', payload, Promise.resolve(ok({
      archivedSessionIds: [(payload as { sessionId: SessionId }).sessionId],
    }))),
  }

  // Payloads stay `unknown` (lint-lane note above); response rows are the real
  // wire shapes so cases can program catalogs and skill lists without casts.
  onSkillList: (payload: unknown) => Promise<RpcResponse<{ skills: SkillEntry[] }>>
    = () => Promise.resolve(ok({ skills: [] }))


  readonly agentPresets: IApiClient['agentPresets'] = {
    list: (payload: unknown) => this.record('agentPreset.list', payload, Promise.resolve(ok({ presets: [], authorable: false, hasDocument: false }))),
    select: (payload: { agentPreset: string }) =>
      this.record('agentPreset.select', payload, Promise.resolve(ok({ agentPreset: payload.agentPreset }))),
    read: (payload: { agentPreset: string }) =>
      this.record('agentPreset.read', payload, Promise.resolve(ok({
        agentPreset: payload.agentPreset, trust: 'user' as const, content: '',
      }))),
    copy: (payload: { agentPreset: string }) =>
      this.record('agentPreset.copy', payload, Promise.resolve(ok({ agentPreset: payload.agentPreset }))),
    openDocument: (payload: { agentPreset: string }) =>
      this.record('agentPreset.openDocument', payload, Promise.resolve(ok({ opened: true as const }))),
    remove: (payload: { agentPreset: string }) =>
      this.record('agentPreset.remove', payload, Promise.resolve(ok({}))),
  }

  readonly skills: IApiClient['skills'] = {
    list: (payload: unknown) => this.record('skill.list', payload, this.onSkillList(payload)),
  }

  readonly goals: IApiClient['goals'] = {
    create: payload => this.record('goal.create', payload, Promise.resolve(ok({ ref: { id: 'fake-goal' as never, revision: 1 } }))),
    edit: payload => this.record('goal.edit', payload, Promise.resolve(ok({ ref: { id: 'fake-goal' as never, revision: 1 } }))),
    pause: payload => this.record('goal.pause', payload, Promise.resolve(ok({ ref: { id: 'fake-goal' as never, revision: 1 } }))),
    resume: payload => this.record('goal.resume', payload, Promise.resolve(ok({ ref: { id: 'fake-goal' as never, revision: 1 } }))),
    complete: payload => this.record('goal.complete', payload, Promise.resolve(ok({ ref: { id: 'fake-goal' as never, revision: 1 } }))),
    clear: payload => this.record('goal.clear', payload, Promise.resolve(ok({ cleared: true as const }))),
  }

  readonly settings: IApiClient['settings'] = {
    describe: payload => this.record('settings.describe', payload, Promise.resolve(ok({ writable: true, hasDocument: false, namespaces: [] }))),
    openDocument: payload => this.record('settings.openDocument', payload, Promise.resolve(ok({ opened: true as const }))),
    update: payload => this.record('settings.update', payload, Promise.resolve(ok({ ns: 'fake', schema: {}, value: {}, applies: 'live' as const, secrets: [], revision: 0 }))),
    replace: payload => this.record('settings.replace', payload, Promise.resolve(ok({ ns: 'fake', schema: {}, value: {}, applies: 'live' as const, secrets: [], revision: 0 }))),
    mutate: payload => this.record('settings.mutate', payload, Promise.resolve(ok({ ns: 'fake', schema: {}, value: {}, applies: 'live' as const, secrets: [], revision: 0 }))),
  }

  readonly credentials: IApiClient['credentials'] = {
    describe: payload => this.record('credentials.describe', payload, Promise.resolve(ok({ credentials: {} }))),
    set: payload => this.record('credentials.set', payload, Promise.resolve(ok({}))),
    unset: payload => this.record('credentials.unset', payload, Promise.resolve(ok({}))),
  }

  readonly llm: IApiClient['llm'] = {
    providers: payload => this.record('llm.providers', payload, Promise.resolve(ok({ providers: [] }))),
    models: payload => this.record('llm.models', payload, Promise.resolve(ok({ groups: [], failures: [] }))),
    discoverModels: payload => this.record('llm.discoverModels', payload, Promise.resolve(ok({ models: [] }))),
  }

  /** When true, streams never fire onOpen (misbehaving-carrier material for the handshake timeout guard). */
  suppressStreamOpen = false

  /** When true, onOpen callbacks are parked instead of fired; releaseStreamOpens() fires them.
   *  Lets a case hold the readiness handshake open (describe done, streams not yet "established"). */
  holdStreamOpen = false
  private heldOpens: (() => void)[] = []

  releaseStreamOpens(): void {
    const held = this.heldOpens
    this.heldOpens = []
    for (const fire of held) fire()
  }

  readonly events: IApiClient['events'] = {
    mux: (_payload: unknown, signal: AbortSignal, onOpen?: () => void) =>
      this.openStream(this.muxConns, signal, onOpen),
    host: (_payload: unknown, signal: AbortSignal, onOpen?: () => void) =>
      this.openStream(this.hostConns, signal, onOpen),
  }

  respond(): Promise<{ accepted: false; reason: 'not-pending' }> {
    return Promise.resolve({ accepted: false, reason: 'not-pending' })
  }

  /** Push one mux frame to every open mux stream (rpcId minted unless pinned by the case). */
  pushMux(frame: MuxFrame, rpcId?: string): void {
    for (const conn of [...this.muxConns]) conn.feed({ kind: 'frame', envelope: { rpcId: RpcId(rpcId ?? `push-${nextRpc++}`), payload: frame } })
  }

  pushHost(frame: HostFrame, rpcId?: string): void {
    for (const conn of [...this.hostConns]) conn.feed({ kind: 'frame', envelope: { rpcId: RpcId(rpcId ?? `push-${nextRpc++}`), payload: frame } })
  }

  /** End (clean close) or fail (throw) every open stream — reconnect-path material. */
  endStreams(): void {
    for (const conn of [...this.muxConns, ...this.hostConns]) conn.feed({ kind: 'end' })
  }

  failStreams(error: unknown): void {
    for (const conn of [...this.muxConns, ...this.hostConns]) conn.feed({ kind: 'fail', error })
  }

  get openMuxCount(): number {
    return this.muxConns.length
  }

  callsOf(method: string): unknown[] {
    return this.calls.filter(c => c.method === method).map(c => c.payload)
  }

  private record<T>(method: string, payload: unknown, response: Promise<T>): Promise<T> {
    this.calls.push({ method, payload })
    return response
  }

  private async *openStream<F>(registry: StreamConn<F>[], signal: AbortSignal, onOpen?: () => void): AsyncGenerator<RpcRequest<F>> {
    const inbox: StreamItem<F>[] = []
    let wake: (() => void) | null = null
    const conn: StreamConn<F> = {
      feed: (item) => {
        inbox.push(item)
        wake?.()
      },
    }
    registry.push(conn)
    if (this.holdStreamOpen && onOpen !== undefined) this.heldOpens.push(onOpen)
    else if (!this.suppressStreamOpen) onOpen?.()
    try {
      while (!signal.aborted) {
        while (inbox.length > 0) {
          const item = inbox.shift() as StreamItem<F>
          if (item.kind === 'end') return
          if (item.kind === 'fail') throw item.error
          yield item.envelope
        }
        await new Promise<void>((resolve) => {
          wake = resolve
          signal.addEventListener('abort', () => { resolve() }, { once: true })
        })
        wake = null
      }
    } finally {
      registry.splice(registry.indexOf(conn), 1)
    }
  }
}
