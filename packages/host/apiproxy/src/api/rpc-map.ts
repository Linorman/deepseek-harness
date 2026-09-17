/**
 * RPC method registry and signature-derived generics. The map
 * registers only client-request methods (respond is a client-response, so it is absent);
 * map keys are the wire path segments (POST /api/session.list).
 */

import type { SessionsApi } from './sessions.ts'
import type { HostApi } from './host.ts'
import type { WorkspaceApi } from './workspace.ts'
import type { AgentPresetsApi } from './agent-presets.ts'
import type { SkillsApi } from './skills.ts'
import type { SettingsApi } from './settings.ts'
import type { CredentialsApi } from './credentials.ts'
import type { LlmApi } from './llm.ts'
import type { TeamsApi } from './teams.ts'
import type { RpcResponse } from './rpc.ts'

/**
 * Method name → method signature. Signatures are the single source of truth; payload/value
 * types are always derived from here. A method may declare a trailing AbortSignal after the
 * request (command.execute): the carrier passes its request signal, never a wire field.
 */
export interface RpcMethodMap {
  'session.list': SessionsApi['list']
  'session.search': SessionsApi['search']
  'session.history': SessionsApi['history']
  'session.models': SessionsApi['models']
  'session.selectModel': SessionsApi['selectModel']
  'session.rename': SessionsApi['rename']
  'session.prompt': SessionsApi['prompt']
  'session.attachment': SessionsApi['attachment']
  'session.updateQueue': SessionsApi['updateQueue']
  'session.cancel': SessionsApi['cancel']
  'team.list': TeamsApi['list']
  'team.selection': TeamsApi['selection']
  'team.member.inspect': TeamsApi['memberInspect']
  'team.member.session': TeamsApi['memberSession']
  'team.workflow.plan.inspect': TeamsApi['workflowPlanInspect']
  'team.action.read': TeamsApi['actionRead']
  'team.task.inspect': TeamsApi['taskInspect']
  'team.browse': TeamsApi['browse']
  'team.get': TeamsApi['get']
  'team.create': TeamsApi['create']
  'team.resume': TeamsApi['resume']
  'team.start': TeamsApi['start']
  'team.postInput': TeamsApi['postInput']
  'team.waitFinal': TeamsApi['waitFinal']
  'team.cancel': TeamsApi['cancel']
  'team.archive': TeamsApi['archive']
  'team.goal.update': TeamsApi['goalUpdate']
  'team.goal.transition': TeamsApi['goalTransition']
  'team.quiescence': TeamsApi['quiescence']
  'team.metrics': TeamsApi['metrics']
  'team.inbox.respond': TeamsApi['inboxRespond']
  'team.inbox.read': TeamsApi['inboxRead']
  'team.inbox.watch': TeamsApi['inboxWatch']
  'team.inbox.acknowledge': TeamsApi['inboxAcknowledge']
  'team.audit.read': TeamsApi['auditRead']
  'team.artifact.read': TeamsApi['artifactRead']
  'team.artifact.list': TeamsApi['artifactList']
  'team.member.list': TeamsApi['memberList']
  'team.member.invite': TeamsApi['memberInvite']
  'team.member.activate': TeamsApi['memberActivate']
  'team.member.remove': TeamsApi['memberRemove']
  'team.member.interrupt': TeamsApi['memberInterrupt']
  'team.channel.input': TeamsApi['channelInput']
  'team.channel.attachment': TeamsApi['channelAttachment']
  'team.channel.catalog': TeamsApi['channelCatalog']
  'team.channel.list': TeamsApi['channelList']
  'team.channel.admission': TeamsApi['channelAdmission']
  'team.channel.invitation': TeamsApi['channelInvitation']
  'team.channel.invitation.acknowledge': TeamsApi['channelInvitationAcknowledge']
  'team.channel.open': TeamsApi['channelOpen']
  'team.channel.post': TeamsApi['channelPost']
  'team.channel.read': TeamsApi['channelRead']
  'team.channel.summarize': TeamsApi['channelSummarize']
  'team.channel.close': TeamsApi['channelClose']
  'team.channel.watch': TeamsApi['channelWatch']
  'team.task.create': TeamsApi['taskCreate']
  'team.task.get': TeamsApi['taskGet']
  'team.task.list': TeamsApi['taskList']
  'team.workflow.plan.list': TeamsApi['workflowPlanList']
  'team.task.update': TeamsApi['taskUpdate']
  'team.task.cancel': TeamsApi['taskCancel']
  'team.task.delete': TeamsApi['taskDelete']
  'team.task.review': TeamsApi['taskReview']
  'team.task.watch': TeamsApi['taskWatch']
  'host.describe': HostApi['describe']
  'host.pickDirectory': HostApi['pickDirectory']
  'host.listDirectory': HostApi['listDirectory']
  'host.createDirectory': HostApi['createDirectory']
  'host.openPath': HostApi['openPath']
  'workspace.list': WorkspaceApi['list']
  'workspace.create': WorkspaceApi['create']
  'workspace.rename': WorkspaceApi['rename']
  'workspace.delete': WorkspaceApi['delete']
  'workspace.insertBefore': WorkspaceApi['insertBefore']
  'workspace.insertSessionBefore': WorkspaceApi['insertSessionBefore']
  'workspace.archiveSession': WorkspaceApi['archiveSession']
  'skill.list': SkillsApi['list']
  'agentPreset.list': AgentPresetsApi['list']
  'agentPreset.select': AgentPresetsApi['select']
  'agentPreset.read': AgentPresetsApi['read']
  'agentPreset.copy': AgentPresetsApi['copy']
  'agentPreset.openDocument': AgentPresetsApi['openDocument']
  'agentPreset.remove': AgentPresetsApi['remove']
  'settings.describe': SettingsApi['describe']
  'settings.openDocument': SettingsApi['openDocument']
  'settings.update': SettingsApi['update']
  'settings.replace': SettingsApi['replace']
  'settings.mutate': SettingsApi['mutate']
  'credentials.describe': CredentialsApi['describe']
  'credentials.set': CredentialsApi['set']
  'credentials.unset': CredentialsApi['unset']
  'llm.providers': LlmApi['providers']
  'llm.models': LlmApi['models']
  'llm.discoverModels': LlmApi['discoverModels']
}

/** Business request payload of method K (reaches through the RpcRequest narrow form to payload). */
export type RequestPayload<K extends keyof RpcMethodMap> = Parameters<RpcMethodMap[K]>[0]['payload']

/** Business return value of method K (reaches through the RpcResponse narrow form to infer the ok value of result). */
export type ResponseValue<K extends keyof RpcMethodMap> =
  Awaited<ReturnType<RpcMethodMap[K]>> extends RpcResponse<infer T> ? T : never
