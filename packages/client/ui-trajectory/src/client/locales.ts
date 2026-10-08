/** `trajectory` namespace dictionaries for all trajectory view copy. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'trajectory'

/** The trajectory dictionary key set (the source of truth for both locales). */
export type TrajectoryKey =
  | 'field.thinking'
  | 'field.parameters'
  | 'view.trajectory'
  | 'toolbar.aria'
  | 'toolbar.duration'
  | 'toolbar.useActualDuration'
  | 'toolbar.useEqualWidth'
  | 'toolbar.actualTime'
  | 'toolbar.turns'
  | 'toolbar.expandTurns'
  | 'toolbar.collapseTurns'
  | 'toolbar.calls'
  | 'toolbar.expandCalls'
  | 'toolbar.collapseCalls'
  | 'toolbar.search'
  | 'toolbar.searchPlaceholder'
  | 'kind.system'
  | 'kind.user'
  | 'kind.context'
  | 'kind.compacted'
  | 'kind.message'
  | 'kind.tool'
  | 'kind.subtool'
  | 'detail.systemPrompt'
  | 'detail.tools'
  | 'detail.diff'
  | 'detail.summary'
  | 'detail.options'
  | 'detail.usage'
  | 'detail.timing'
  | 'detail.rawOutput'
  | 'detail.preview'
  | 'detail.raw'
  | 'detail.source'
  | 'detail.payload'
  | 'detail.result'
  | 'detail.schema'
  | 'detail.requestTiming'
  | 'detail.hierarchy'
  | 'timing.unavailable'
  | 'timing.notRecorded'
  | 'timing.stepStartUnavailable'
  | 'timing.firstTokenUnavailable'
  | 'timing.usageUnavailable'
  | 'timing.outputUnavailable'
  | 'timing.tooShort'
  | 'timing.showLocal'
  | 'timing.showUnix'
  | 'timing.started'
  | 'timing.total'
  | 'timing.ttft'
  | 'timing.generation'
  | 'timing.throughput'
  | 'timing.duration'
  | 'timing.source'
  | 'timing.session'
  | 'timing.sessionRunning'
  | 'status.error'
  | 'status.running'
  | 'status.complete'
  | 'usage.tokens'
  | 'usage.reasoning'
  | 'usage.content'
  | 'usage.input'
  | 'usage.output'
  | 'usage.cached'
  | 'usage.cacheCreated'
  | 'usage.other'
  | 'usage.notReported'
  | 'usage.request'
  | 'usage.cumulative'
  | 'empty.options'
  | 'empty.source'
  | 'empty.noContent'
  | 'empty.noContentAria'
  | 'empty.noPayload'
  | 'empty.noResult'
  | 'empty.schema'
  | 'empty.tools'
  | 'empty.systemPrompt'
  | 'empty.toolCallOnly'
  | 'empty.toolCallOnlyInline'
  | 'json.options'
  | 'json.source'
  | 'json.result'
  | 'json.payload'
  | 'source.unknown'
  | 'source.plugin'
  | 'source.goal'
  | 'source.pluginNamed'
  | 'source.goalRound'
  | 'action.openCall'
  | 'action.openBlockCall'
  | 'action.openImage'
  | 'block.label'
  | 'json.parameters'
  | 'history.loadingTrajectory'
  | 'history.loading'
  | 'history.load'
  | 'history.loadingAria'
  | 'history.loadHint'
  | 'section.between'
  | 'section.turn'
  | 'section.step'
  | 'summary.oneStep'
  | 'summary.steps'
  | 'summary.oneCall'
  | 'summary.calls'
  | 'row.collapsedTurn'
  | 'row.collapsedAssistant'
  | 'row.compaction'
  | 'row.record'
  | 'row.requestRecord'
  | 'request.label'
  | 'request.compactionLabel'
  | 'request.compactionSection'
  | 'detail.aria'
  | 'action.resizeDetails'
  | 'action.resizeHint'
  | 'action.closeDetails'
  | 'field.status'
  | 'field.purpose'
  | 'field.compaction'
  | 'field.provider'
  | 'field.model'
  | 'field.toolCalls'
  | 'field.subtoolCalls'
  | 'field.error'
  | 'field.retry'
  | 'field.retryScheduled'
  | 'field.retryTotal'
  | 'field.retryDelay'
  | 'field.assistantMessage'
  | 'field.toolCall'
  | 'timeline.aria'
  | 'timeline.overview'
  | 'timeline.empty'
  | 'timeline.total'
  | 'timeline.started'
  | 'timeline.segments'

declare module '@clocky/clocky-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** All trajectory view copy, including accessible names and inspectors. */
    'trajectory': TrajectoryKey
  }
}

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh: Record<TrajectoryKey, string> = {
  'field.thinking': '思考',
  'field.parameters': '参数',
  'kind.system': '系统',
  'kind.user': '用户',
  'kind.context': '上下文',
  'kind.compacted': '已压缩',
  'kind.message': '助手',
  'kind.tool': '工具',
  'kind.subtool': '子工具',
  'detail.systemPrompt': '系统提示词',
  'detail.tools': '工具',
  'detail.diff': '差异',
  'detail.summary': '概述',
  'detail.options': '选项',
  'detail.usage': '用量',
  'detail.timing': '计时',
  'detail.rawOutput': '原始输出',
  'detail.preview': '预览',
  'detail.raw': '原文',
  'detail.source': '来源',
  'detail.payload': '输入',
  'detail.result': '结果',
  'detail.schema': 'schema',
  'detail.requestTiming': '请求计时',
  'detail.hierarchy': '层级',
  'timing.unavailable': '不可用',
  'timing.notRecorded': '未记录',
  'timing.stepStartUnavailable': '步骤开始时间不可用',
  'timing.firstTokenUnavailable': '首个 token 时间不可用',
  'timing.usageUnavailable': '用量不可用',
  'timing.outputUnavailable': '输出 token 数不可用',
  'timing.tooShort': '耗时过短',
  'timing.showLocal': '显示本地时间',
  'timing.showUnix': '显示 Unix 时间戳',
  'timing.started': '开始时间',
  'timing.total': '总耗时',
  'timing.ttft': 'TTFT',
  'timing.generation': '生成耗时',
  'timing.throughput': '生成速度',
  'timing.duration': '耗时',
  'timing.source': '计时来源',
  'timing.session': '会话时间戳',
  'timing.sessionRunning': '会话时间戳（进行中）',
  'status.error': '失败',
  'status.running': '进行中',
  'status.complete': '已完成',
  'usage.tokens': 'token 数',
  'usage.reasoning': '推理',
  'usage.content': '内容',
  'usage.input': '输入',
  'usage.output': '输出',
  'usage.cached': '缓存读取',
  'usage.cacheCreated': '缓存写入',
  'usage.other': '其他',
  'usage.notReported': '未报告用量',
  'usage.request': '本次请求',
  'usage.cumulative': '会话累计',
  'empty.options': '未记录选项',
  'empty.source': '未记录来源',
  'empty.noContent': '无内容',
  'empty.noContentAria': '无内容',
  'empty.noPayload': '未捕获输入',
  'empty.noResult': '未捕获结果',
  'empty.schema': 'schema 不可用',
  'empty.tools': '本次请求没有工具',
  'empty.systemPrompt': '本次请求没有系统提示词',
  'empty.toolCallOnly': '仅工具调用',
  'empty.toolCallOnlyInline': '（仅工具调用）',
  'json.options': '请求选项 JSON',
  'json.source': '消息来源 JSON',
  'json.result': '结果 JSON',
  'json.payload': '输入 JSON',
  'source.unknown': '未知',
  'source.plugin': '插件',
  'source.goal': '目标',
  'source.pluginNamed': '插件 · {plugin}',
  'source.goalRound': '目标 · Round {round}',
  'action.openCall': '打开工具调用概述',
  'action.openBlockCall': '打开内容块 #{number} 的工具调用概述',
  'action.openImage': '打开图片',
  'block.label': '内容块 #{number} {type}',
  'json.parameters': '{name} 参数 JSON',
  'history.loadingTrajectory': '正在加载轨迹…',
  'history.loading': '正在加载更早历史…',
  'history.load': '加载更早历史',
  'history.loadingAria': '正在加载更早历史',
  'history.loadHint': '点击加载更早历史',
  'section.between': '轮次之间',
  'section.turn': '轮次 {number}',
  'section.step': '步骤 {number}',
  'summary.oneStep': '{count} 个步骤',
  'summary.steps': '{count} 个步骤',
  'summary.oneCall': '{count} 次工具调用',
  'summary.calls': '{count} 次工具调用',
  'row.collapsedTurn': '已折叠轮次概述，{summary}',
  'row.collapsedAssistant': '已折叠助手概述，{summary}',
  'row.compaction': '请求 {number}，压缩',
  'row.record': '{kind}，{content}',
  'row.requestRecord': '请求 {number}，{kind}，{content}',
  'request.label': '请求 #{number}',
  'request.compactionLabel': '请求 #{number} · 压缩',
  'request.compactionSection': '压缩 · {section}',
  'detail.aria': '事件详情',
  'action.resizeDetails': '调整事件详情宽度',
  'action.resizeHint': '拖动调整宽度，双击重置。',
  'action.closeDetails': '关闭详情',
  'field.status': '状态',
  'field.purpose': '用途',
  'field.compaction': '压缩',
  'field.provider': '提供方',
  'field.model': '模型',
  'field.toolCalls': '工具调用',
  'field.subtoolCalls': '子工具调用',
  'field.error': '错误',
  'field.retry': '重试',
  'field.retryScheduled': '已安排第 {retry} 次',
  'field.retryTotal': '，共 {max} 次',
  'field.retryDelay': '重试延迟',
  'field.assistantMessage': '助手消息',
  'field.toolCall': '工具调用',
  'timeline.aria': '轨迹时间线',
  'timeline.overview': '时间线概览；水平拖选以聚焦事件',
  'timeline.empty': '暂无计时数据',
  'timeline.total': '总耗时 {duration}',
  'timeline.started': '开始于 {time}',
  'timeline.segments': 'TTFT {ttft} · 解码 {decoding}',

  'view.trajectory': '轨迹',
  'toolbar.aria': '轨迹工具栏',
  'toolbar.duration': '耗时',
  'toolbar.useActualDuration': '按实际耗时显示',
  'toolbar.useEqualWidth': '按等宽操作显示',
  'toolbar.actualTime': '实际时间',
  'toolbar.turns': '轮次',
  'toolbar.expandTurns': '展开轮次',
  'toolbar.collapseTurns': '折叠轮次',
  'toolbar.calls': '调用',
  'toolbar.expandCalls': '展开调用',
  'toolbar.collapseCalls': '折叠调用',
  'toolbar.search': '搜索轨迹',
  'toolbar.searchPlaceholder': '搜索',
}

/** English dictionary. */
export const en: Record<TrajectoryKey, string> = {
  'field.thinking': 'Thinking',
  'field.parameters': 'Parameters',
  'kind.system': 'System',
  'kind.user': 'User',
  'kind.context': 'Context',
  'kind.compacted': 'Compacted',
  'kind.message': 'Assistant',
  'kind.tool': 'Tool',
  'kind.subtool': 'Subtool',
  'detail.systemPrompt': 'System Prompt',
  'detail.tools': 'Tools',
  'detail.diff': 'Diff',
  'detail.summary': 'Summary',
  'detail.options': 'Options',
  'detail.usage': 'Usage',
  'detail.timing': 'Timing',
  'detail.rawOutput': 'Raw Output',
  'detail.preview': 'Preview',
  'detail.raw': 'Raw',
  'detail.source': 'Source',
  'detail.payload': 'Payload',
  'detail.result': 'Result',
  'detail.schema': 'Schema',
  'detail.requestTiming': 'Request Timing',
  'detail.hierarchy': 'Hierarchy',
  'timing.unavailable': 'Not available',
  'timing.notRecorded': 'Not recorded',
  'timing.stepStartUnavailable': 'Step start unavailable',
  'timing.firstTokenUnavailable': 'First token unavailable',
  'timing.usageUnavailable': 'Usage unavailable',
  'timing.outputUnavailable': 'Output tokens unavailable',
  'timing.tooShort': 'Duration too short',
  'timing.showLocal': 'Show local time',
  'timing.showUnix': 'Show Unix timestamp',
  'timing.started': 'Started',
  'timing.total': 'Total duration',
  'timing.ttft': 'TTFT',
  'timing.generation': 'Generation',
  'timing.throughput': 'Throughput',
  'timing.duration': 'Duration',
  'timing.source': 'Timing source',
  'timing.session': 'Session timestamps',
  'timing.sessionRunning': 'Session timestamps (running)',
  'status.error': 'Failed',
  'status.running': 'Pending',
  'status.complete': 'Completed',
  'usage.tokens': 'Tokens',
  'usage.reasoning': 'Reasoning',
  'usage.content': 'Content',
  'usage.input': 'Input',
  'usage.output': 'Output',
  'usage.cached': 'Cached',
  'usage.cacheCreated': 'Cache created',
  'usage.other': 'Other',
  'usage.notReported': 'Usage not reported',
  'usage.request': 'This request',
  'usage.cumulative': 'Session cumulative',
  'empty.options': 'Options not recorded',
  'empty.source': 'Source not recorded',
  'empty.noContent': 'No content',
  'empty.noContentAria': 'no content',
  'empty.noPayload': 'No payload captured',
  'empty.noResult': 'No result captured',
  'empty.schema': 'Schema unavailable',
  'empty.tools': 'No tools in this request',
  'empty.systemPrompt': 'No system prompt in this request',
  'empty.toolCallOnly': 'Tool call only',
  'empty.toolCallOnlyInline': '(tool call only)',
  'json.options': 'Request options JSON',
  'json.source': 'Message source JSON',
  'json.result': 'Result JSON',
  'json.payload': 'Payload JSON',
  'source.unknown': 'Unknown',
  'source.plugin': 'Plugin',
  'source.goal': 'Goal',
  'source.pluginNamed': 'Plugin · {plugin}',
  'source.goalRound': 'Goal · Round {round}',
  'action.openCall': 'Open tool call summary',
  'action.openBlockCall': 'Open Block #{number} tool call summary',
  'action.openImage': 'Open image',
  'block.label': 'Block #{number} {type}',
  'json.parameters': '{name} parameters JSON',
  'history.loadingTrajectory': 'Loading trajectory…',
  'history.loading': 'Loading earlier history…',
  'history.load': 'Load earlier history',
  'history.loadingAria': 'Loading earlier history',
  'history.loadHint': 'Click to load earlier history',
  'section.between': 'Between turns',
  'section.turn': 'Turn {number}',
  'section.step': 'Step {number}',
  'summary.oneStep': '{count} step',
  'summary.steps': '{count} steps',
  'summary.oneCall': '{count} tool call',
  'summary.calls': '{count} tool calls',
  'row.collapsedTurn': 'Collapsed turn summary, {summary}',
  'row.collapsedAssistant': 'Collapsed assistant summary, {summary}',
  'row.compaction': 'Request {number}, compaction',
  'row.record': '{kind}, {content}',
  'row.requestRecord': 'Request {number}, {kind}, {content}',
  'request.label': 'Request #{number}',
  'request.compactionLabel': 'Request #{number} · Compaction',
  'request.compactionSection': 'Compaction · {section}',
  'detail.aria': 'Event details',
  'action.resizeDetails': 'Resize event details',
  'action.resizeHint': 'Drag to resize. Double-click to reset.',
  'action.closeDetails': 'Close details',
  'field.status': 'Status',
  'field.purpose': 'Purpose',
  'field.compaction': 'Compaction',
  'field.provider': 'Provider',
  'field.model': 'Model',
  'field.toolCalls': 'Tool calls',
  'field.subtoolCalls': 'Subtool calls',
  'field.error': 'Error',
  'field.retry': 'Retry',
  'field.retryScheduled': 'Scheduled {retry}',
  'field.retryTotal': ' of {max}',
  'field.retryDelay': 'Retry delay',
  'field.assistantMessage': 'Assistant Message',
  'field.toolCall': 'Tool Call',
  'timeline.aria': 'Trajectory timeline',
  'timeline.overview': 'Timeline overview; drag horizontally to focus events',
  'timeline.empty': 'No timing data',
  'timeline.total': 'Total {duration}',
  'timeline.started': 'Started {time}',
  'timeline.segments': 'TTFT {ttft} · Decoding {decoding}',

  'view.trajectory': 'Trajectory',
  'toolbar.aria': 'Trajectory toolbar',
  'toolbar.duration': 'Duration',
  'toolbar.useActualDuration': 'Use actual duration',
  'toolbar.useEqualWidth': 'Use equal-width operations',
  'toolbar.actualTime': 'Actual time',
  'toolbar.turns': 'Turns',
  'toolbar.expandTurns': 'Expand turns',
  'toolbar.collapseTurns': 'Collapse turns',
  'toolbar.calls': 'Calls',
  'toolbar.expandCalls': 'Expand calls',
  'toolbar.collapseCalls': 'Collapse calls',
  'toolbar.search': 'Search trajectory',
  'toolbar.searchPlaceholder': 'Search',
}
