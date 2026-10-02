/** `sidebar` namespace dictionaries: shell controls (brand row, New Task, fold toggle). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'brand.name': 'Clocky',
  'workspace.navigation': '工作区',
  'session.new': '新建团队工作',
  'session.new.label': '新建团队工作',
  'toggle.open': '打开侧边栏',
  'toggle.collapse': '收起侧边栏',
} satisfies Record<string, string>

/** The sidebar namespace key union. */
export type SidebarKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'brand.name': 'Clocky',
  'workspace.navigation': 'Workspaces',
  'session.new': 'New team work',
  'session.new.label': 'New team work',
  'toggle.open': 'Open sidebar',
  'toggle.collapse': 'Collapse sidebar',
} satisfies Record<SidebarKey, string>
