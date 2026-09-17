/** `sidebar` namespace dictionaries: shell controls (brand row, New Task, fold toggle). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'brand.name': 'Clocky',
  'session.new': '新任务',
  'session.new.label': '新建任务',
  'toggle.open': '打开侧边栏',
  'toggle.collapse': '收起侧边栏',
} satisfies Record<string, string>

/** The sidebar namespace key union. */
export type SidebarKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'brand.name': 'Clocky',
  'session.new': 'New Task',
  'session.new.label': 'New task',
  'toggle.open': 'Open sidebar',
  'toggle.collapse': 'Collapse sidebar',
} satisfies Record<SidebarKey, string>
