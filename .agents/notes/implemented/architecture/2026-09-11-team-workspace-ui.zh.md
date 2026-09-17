# Agent Note: Team 工作区总览与按需 Session 查看

Status: implemented

[English](2026-09-11-team-workspace-ui.md) | 中文

## Problem

协调会话和小型 Team 浮层争夺空间，而用户需要比较任务、查找人工决策并操作频道。把所有 Team 集合放进浮层会掩盖下一步操作，也让任务摘要难以快速阅读。

## Decision

选择 Team 打开只读的操作工作区。总览从完整 Team 投影计算任务数量，限制任务与成员预览，并分开人工待办、最近动态与产物。任务使用有界表格和单个摘要检查栏；执行历史与变更操作通过明确的折叠入口展示。Channel Hub 分开列表、消息、内联输入区和可选协议诊断。缺失用量表示不可用而非零；已完成任务数量不是目标进度，provider cost units 不是货币。

现有 UI 所有者实现该组合，不增加插件。`ui-team` 注册根级 `team.workspace` slot 及其频道消息子 slot；`ui-layout` 拥有工作区和 Session 容器。注册拥有的 store 保存每个 Team 的模块、筛选、选择、滚动与频道草稿。Runtime service 保留业务状态和认证操作。可分享 URL 只包含对象标识与视图筛选，恢复时检查其 Team 归属。新选择会取消尚未完成的恢复或 Session 查询。

Session 查看在原生 dialog 内使用唯一且稳定的 conversation 子树，包括已有 details slot。打开、关闭和展开视图保留挂载状态；关闭只清除查看选择，不停止执行。任务 attempt 链接解析记录中的 activation，成员链接选择最新 activation。选择 Team 不会恢复离线 coordinator；Resume 是独立命令。

[设计上下文](../../../../DESIGN.md) 定义石墨色导航、冷中性工作区表面、字体层级和克制的过渡。共享主题 token 支持两种外观及减少动态效果。有界读取和预览避免为展示加载每个频道日志或成员 transcript。

图片导入在打开 FileReader 前，按配置的草稿字节额度检查选中文件大小、base64 膨胀和序列化元数据。顺序编码限制并发 reader 数量；拒绝导入时保留原草稿。工作区 store 仍负责最终检查全部保留草稿的累计额度。

### 与现有决策的关系

[紧凑详情决策](../feature/2026-09-07-team-detail-compact-delete.zh.md) 继续拥有任务授权、停止／删除语义和执行者归属；本决策替代其浮层展示方式。[Team closure 决策](2026-08-31-team-closure-authority-and-detail-inspection.zh.md) 继续拥有生命周期与来源归属。[P1 产品提案](../../proposed/architecture/2026-09-04-native-multi-agent-p1-product-convergence.zh.md) 保留更广的协议范围。这些记录的独立理由未被替代，因此继续保持活跃。

## Alternatives considered

**在浮层中增加折叠控件。** 可以隐藏字段，但不能提供任务和频道操作所需的比较空间。

**持续展示大型 Session 并配一个小仪表盘。** 会压缩操作工作区，并继续把 transcript 阅读作为默认活动。

**可拖拽任务看板。** Scheduler 和 review 规则拥有任务转换；自由拖拽暗示不支持的变更，也降低比较阅读密度。

**独立的仪表盘与检查栏插件。** 这些展示已属于现有 UI 所有者，没有引入独立演化的能力。

## Consequences

操作导航获得空间与明确层级；持续聊天用户多一次打开操作，由稳定的协调会话入口和展开阅读模式支持。Session 查看保留来源工作区。Host 继续负责变更授权、revision 验证和频道邀请及协议限制。

完整 Team 投影提供准确计数，但仍是扩展规模时的依赖。有界集合渲染不构成 1,000 项任务的性能保证。实现证据记录实际测量场景，并区分基于视口的缩放检查与原生浏览器缩放。频道草稿支持跨模块保留；这不承诺所有其他表单或重新加载后的持久化。

## Testing

Client 测试覆盖有界预览、精确 attempt 选择、离线 Resume、导航取消、草稿重试身份、IME 处理、变更错误和稳定的 Session 挂载。真实 Host 的无密钥浏览器场景覆盖频道协议、65 行分页与读取恢复、子 Team 导航、Session 返回及浏览器历史、长目标、两种语言与外观、窄屏和减少动态效果。[实现报告](../../../../design/team-workspace-2026-09-11/implementation-report.md) 记录验证命令、截图及仓库级检查限制。
