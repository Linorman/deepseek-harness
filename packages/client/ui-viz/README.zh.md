# @clocky/clocky-client-ui-viz

[English](README.md) | 中文

Team 与 Simulation 工作区的呈现型可视化层：确定性布局函数、SVG/canvas 图渲染器、泳道渲染器、每个可视化都要满足的列表视图约定、数字类基础组件，以及分层的实时动效辅助函数。本包没有 Cordis 上下文，也不使用服务；功能包从各自的运行时数据构建视图模型，再通过 props 传入。它与 [ui-primitives](../ui-primitives/README.zh.md) 一样作为共享的浏览器平台模块发布，所有功能 bundle 解析到同一个实例。

## 布局

所有布局函数都是纯函数：相同输入产生字节相同的坐标，坐标四舍五入到两位小数。

- `layoutLayered(nodeIds, edges, options)` 按最长路径把有向图分层，并用重心扫描为每层排序。闭合环路的边作为 `backEdges` 返回，不会死循环。`longestChain` 返回权重最大的链；调用方只在整张图都已加载时把它画成关键路径。
- `layoutRadialSwarm({ nodes, links, seed, previous })` 围绕固定中心运行带种子的 `d3-force` 模拟：环 0 是中心，环号越大越靠外，`cluster` 相同的节点聚在同一个锚点周围。模拟一旦冷却到稳定阈值以下就停止。`previous` 中传入的位置保持固定，因此新节点加入时不会移动用户已经定位过的节点。
- `layoutLanes({ lanes, items, position })` 把条目放进泳道，重叠的条目堆叠成多行。时间到 x 坐标的函数由调用方注入。`decimalTimeScale(origin, end, width)` 通过 `BigInt` 映射精确的十进制时间字符串，因此超过 2^53 的 Simulation 时间仍能精确到像素。

## 渲染与交互

`GraphView` 在标记数不超过 `markThreshold`（默认 500）时绘制 SVG，超过时绘制 canvas。两种模式下，指针命中检测（`hitTest`）和键盘焦点都基于同一组布局空间标记：每个节点有一个焦点代理按钮，方向键按 `nextSpatialFocus` 移动，Home/End 按阅读顺序跳转，Enter 或 Space 激活。在空白处拖动指针即可平移；缩放使用控件、`+`/`-` 或带修饰键的滚轮，因此普通页面滚动不受影响。用户未移动视图时，视图会自动适配。

每种视觉编码只表达一个领域事实：`data-state` 对应一个状态角色，`ghost` 把页外引用画成虚线轮廓，`stale` 让比所属游标更旧的观测降饱和，`emphasis` 标记高亮路径，`glow` 是静态的身份光晕。`VizListView` 渲染同一组条目及相同的已加载/总数说明，`describeVisualization` 生成一句话的无障碍摘要。`LaneView` 绘制泳道、区间条、点标记、竖线、因果箭头和当前时刻游标，并使用同样的空间键盘遍历。`ModeTile` 是启动页的工作区卡片，预览使用 `SwarmGlyph`（已加载条目按状态围绕中心旋转）或 `ConstellationGlyph`（已加载条目按 id 定位，不画连线，因此不暗示任何关系）。`ViewSwitch` 是在等价视图之间切换的分段控件，`useSlidingIndicator` 让宿主以同样方式跟踪自己的当前选项。

## 动效

动效遵循 [web-styling.md](../../../docs/web-styling.zh.md) 中的四个层级，元素在动画期间带有 `data-motion-tier`。

- **L0**：`AmbientBackdrop` 绘制静态模式光晕，不创建动画或可见性订阅。空轨道与已结束工作不旋转，目录星图保持静态。
- **L1**：`GraphView` 的 `signals` 让粒子沿连线飞行，关键帧是从连线曲线采样得到的 WAAPI `translate`；或者让节点响一次脉冲。同时最多飞行 `MAX_PARTICLES`（24）个粒子，超出部分合并成一个“+N”脉冲。隐藏或离屏的画面直接丢弃信号，不排队；减少动效下，一次飞行替换为一次不透明度闪烁。
- **L2**：`Odometer`、`RadialProgress`、`ViewSwitch` 和 `GraphView` 的 `changedIds` 只在所属方把变化标记为实时时才产生动画。
- **L3**：`Moment` 在每次 `generation` 递增时播放一次集结、收敛、点火、封存或停滞，时长不超过 `--clocky-duration-celebrate`，任意指针或按键输入会立即结束它。`GraphView` 的 `assemble` 让节点错峰入场、连线依次绘入；这个连线绘入是唯一有文档记录的 `stroke-dashoffset` 动画。

`useLiveTransition(identity, cursor, value)` 与 `useLiveChanges(identity, entries)` 对变化分类：某个身份的第一个值（首次加载、刷新、回放到新挂载、导航）视为稳定，只有在同一身份保持挂载期间游标前进带来的变化才是实时变化。React 只在数据变化时渲染；逐帧工作通过 ref 和 WAAPI 完成。文档隐藏、原生模态覆盖工作区、外壳标记工作区隐藏或位于前景面板后、元素离屏或请求减少动效时，实时动效暂停。一个共享属性观察器持有工作区／模态可见性，不观察流式正文或动画帧。

`navigateWithTransition` 在返回前同步提交 React 呈现，不等待原生捕获、动画帧、定时器或网络。原生回调共享幂等提交，不能覆盖较新的浏览器历史目标。可选捕获可能观察到已提交视图，因此不保证新旧元素之间的变形。快速导航取消先前视觉生命周期，每个意图只执行一次。所有过渡 Promise 都被处理，仅当前过渡可清理状态，视觉快照不截获输入。文档隐藏、减少动效或缺少 API 支持时立即导航。

新的指针／键盘输入或文档隐藏会将待处理导航提交一次，并结束原生视觉捕获。临时输入监听器归该捕获所有，在中断、完成或失败时清退；被跳过的延迟回调不能再次执行导航。

## 模型体验

无，因为本包只在浏览器中根据使用方已持有的数据渲染可视化；这里的任何内容都不会进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **canvas 模式只绘制圆盘与连线**：标签、簇轮廓、箭头和光晕只在 SVG 模式下渲染；超过标记阈值时由列表视图和焦点代理承载名称。
- **`LaneView` 没有虚拟化**：调用方需限制传入的泳道和条目数量；密集窗口须由调用方先分桶再渲染。
- **粒子需要实时来源**：渲染器只执行所属方列出的信号，从不根据静态连线推断送达。
