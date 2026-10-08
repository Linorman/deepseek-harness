/** `sidebar` namespace dictionaries: shell controls (brand row, new team work, fold toggle). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'brand.name': 'Clocky',
  'workspace.navigation': '主导航',
  'session.new': '新建团队任务',
  'session.new.label': '新建团队任务',
  'search.label': '搜索或跳转',
  'search.placeholder': '搜索…',
  'toggle.open': '打开侧边栏',
  'toggle.collapse': '收起侧边栏',
} satisfies Record<string, string>

/** The sidebar namespace key union. */
export type SidebarKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'brand.name': 'Clocky',
  'workspace.navigation': 'Main navigation',
  'session.new': 'New team work',
  'session.new.label': 'New team work',
  'search.label': 'Search or jump to',
  'search.placeholder': 'Search…',
  'toggle.open': 'Open sidebar',
  'toggle.collapse': 'Collapse sidebar',
} satisfies Record<SidebarKey, string>
