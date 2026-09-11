# clocky-client-ui-agent-preset

[English](README.md) | 中文

agent preset 的各个表层：General 设置中的一行，用于选择之后 Team coordinator 使用的 [preset](../../preset/agent-presets/README.zh.md)；coordinator Session 标题旁的一个只读标签；以及一个设置页分区，用于管理名单——复制、删除、默认值，以及通往 preset 自身文件的入口。

## 为什么它是 Team 启动偏好设置

coordinator Session 的 preset 在 Team 启动时固定，因为其历史由该 preset 的工具产生。更改默认值只影响之后的 Team，绝不切换活跃 coordinator。

## 会话标题旁的标签

一个只读表层位于 coordinator Session 标题旁，名称为该 Session 所运行的 preset。它从 Session 摘要读取 preset，并在 General 行所读的同一份名单上解析显示名称。

## 它读什么、写什么

选项与当前默认值都来自同一次 `agentPreset.list` 调用。写入目标是 `agent-presets` settings 命名空间的 `default` 字段，Host 会在 Team 启动时解析它。

本地创作的 preset 的权限恰好等于它所引用的插件，因此列表会标注 `user` 行，而不是把每个 preset 都呈现为随附且已审核的。

preset 文件提供一套未国际化的 `name` 与 `description`，Web 将其用于所有 `user` 行和未知的 `system` 行。对于四个随附 id（`standard`、`code`、`minimal` 与 `cordis`），只有名单将该行标记为 `system` 时，Web 才会从当前 locale 解析这两个字段；同名的 `user` preset 仍使用其文件元数据。

本行在自身命名空间的 `settings/changed` 以及 `connection/reset` 时重新读取：名单是一个活动目录，默认值是一项设置，外部编辑与重新连接都可能改变它。

## 管理分区

第三个表层，独立的设置页（`settings.section`，id 为 `agent-presets`，排在「模型」之后——选模型是日常操作，而组装 agent 是它背后那件塑造部署形态的事）：名单以卡片呈现，复制对话框是创建 preset 的唯一入口，随附组装则在只读查看器中展示。

浏览器不再编辑任何组装文本。在网页文本域里编 YAML 是弱功能（无补全、无高亮、无 diff），因此新 preset 是宿主端对既有 preset 的一次复制——对话框只收集一个 id（它将成为目录名，所以必须当场取好、事后无法更改）与一个可选显示名，跨越传输层的只有 `{ from, id, name? }`。其余一切——描述、组装、skills——都在 preset 自己的文件里编辑，而本页的另一职责正是把用户送到那些文件面前：复制以打开新目录作为收尾，每张自定义卡片也保有一个位置操作。宿主没有桌面打开器时（名单上的 `hasDocument: false`；远程与容器部署），同样的操作改为把目录以文本显示在卡片上，而不是提供一个点了没反应的按钮。

preset 自行发布描述，长度不限，而网格让每一行卡片等高——因此不加约束的描述会决定整份名单的高度。卡片把描述截断为四行，其余内容由 tooltip 承载，且仅在文本确实被裁切时才挂载。截断由 CSS 完成，因此无论卡片显示多少，完整描述始终留在无障碍树中。

随附 preset 在只读查看器中打开。它是副本据以出发的已知良好组装，因此能读到它正是意义所在；它不提供位置也不提供删除——它的安装目录会被升级覆盖，不归用户管理。开篇引导语承担了从前创建按钮所暗示的信息：复制一份既有预设改成自己的，或用「创造模式」让 Agent 帮你创建。

复制旁边是对话式入口：名单携带自指的 `cordis` preset 时，一张虚线添加卡会创建携带该 preset 的 Team 草稿并清除当前转录。首条编辑器输入调用 `team.start`，并以 `cordis` 创建其 coordinator。

对话框复刻宿主自身的约束规则（`[a-z0-9][a-z0-9-]*`），并拒绝已被占用的名称——复制从不覆写。这两项检查只是便利：宿主会重新校验，失败时对话框报告的正是宿主的答复。

删除会移除整个 preset 目录。已据其组装的 coordinator 继续运行——组装在 Team 启动时挂载一次，此后没有任何东西会重新读取该文件。

名单行携带 `broken`（宿主的形状检查发现组装缺失或不可加载）时渲染为标记卡片：红色边框、「加载失败」徽记（discovery 观察到的事实，而非断言文件已损坏——常见起因是用户刚编辑或删除了组装文件）、原样展示的原因、卡片主体禁用——它不能成为默认——复制也禁用，因为损坏 preset 的副本只是又一个损坏的 preset。损坏的自定义行保留位置与删除动作：文件正是修复它的地方，而删除正是清掉幽灵目录（组装文件被手动删除、目录仍占着 id）的方式；损坏的内置行连查看器也不提供——没有可读的组装可展示。General 选择器完全不列出损坏的 preset，因为它选择之后 Team 的 coordinator 组装。

设置默认值写入的是 `agent-presets` settings 命名空间，宿主通过已注册的 settings seam 将其暴露给配置客户端（[`clocky-apiproxy`](../../host/apiproxy/README.zh.md) 不再维护产品范围的 namespace 白名单）。

`agentPreset.read`、`copy`、`openDocument` 与 `remove` 被固定在环回地址（见 [`clocky-client-connection`](../connection/README.zh.md)）：组装指明了一个会话所运行的插件，因此读取它是侦察，其余几个则管理名单并驱动宿主桌面。`agentPreset.list` 不在其中——它携带 id、信任级别与两个不含路径的能力标志，而局域网客户端的选择器需要它。

## 何时不显示这些表层

未组装任何 preset 的部署返回空名单，本行、标签与分区都不渲染任何内容——此时每个 Team 共用 Host 组装，也就无从选择或管理。未配置可写根目录的部署返回 `authorable: false`，分区随之退化为只读浏览：随附组装仍可在查看器中打开，但每个复制操作都被禁用并以原因作提示，而不是给出一个创建必然失败的对话框。

## 模型体验

间接影响：通过之后 Team coordinator 所采用的 preset；[`clocky-agent-presets`](../../preset/agent-presets/README.zh.md) 持有该组装放到模型前的内容。

#### KV Cache effect

没有直接的失效影响。更改默认值绝不触及活跃 coordinator 的前缀；之后的 Team 依据自己的组装建立自己的前缀。

## 已知限制与暂缓事项

- **没有元数据的 preset 按 id 列出** —— 展示文本是可选的，未取名的副本刻意回退到目录名，而不是与其来源呈现得一模一样。
- **展示的路径是文本，不是链接** —— 宿主没有桌面打开器时，卡片显示目录供手工复制；浏览器自身无法打开宿主文件系统上的位置。
- **组装编辑对页面不可见** —— 文件在浏览器之外编辑，传输层不广播文件变动，因此名单只在自身操作、`settings/changed` 与 `connection/reset` 时重读，而非每次磁盘编辑。
