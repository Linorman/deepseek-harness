# Simulation Scenario

结构额度必须存在于目录默认值/上限中，可移植输入可选择覆盖：`maxBirthsPerInterval` 和 `maxExternalExpansionsPerInterval` 为非负安全整数，零禁用动态出生或外部展开。`maxPendingMutations` 仅接受 `1`；不支持的并发度、缺失已解析额度或超过上限的覆盖值均拒绝。Compiler `9` 将每项额度冻结进解析定义与复核承诺，不以兼容默认值修补旧输出。[Native provider](../simulation-local/README.zh.md)拥有计费、重试和清理占用语义。

[English](README.md) | 中文

`@clocky/clocky-simulation-scenario` 将 `clocky.world/v0` JSON 或安全 YAML 编译为新建暂停世界所需的不可变输入。根入口兼容浏览器：只读取参数，使用标准 Web Crypto SHA-256，不加载 profile、不访问存储或网络、不调用模型，也不分配身份。独立的 `./invariant` 入口注册诊断所有权。

## 消费者契约

使用文件文本或已解码定义及完整的已安装元数据快照调用 `compileWorldScenario(input, catalog, format)`。`format` 默认为 `json`；YAML 文本必须显式指定 `yaml`，不会在 JSON 无效时自动回退。成功返回 `{ ok: true, resolved, preview }`；失败返回包含 `source`、`path`、`code` 和 `message` 的字段诊断，不返回部分创建输入。文件结构诊断还保留 `format` 及可获得的从 1 开始的 `line`/`column`。`parseWorldScenario(input, format)` 只执行严格结构解析。`decodeScenarioInput(text, format)` 只做有界语法解码，返回 JSON 值及路径到位置的查找；`serializeScenarioDefinition(definition, format)` 输出 JSON 或安全 YAML。浏览器作者台同时使用二者，使其语法检查与源码文本与 Host 一致。每个对象边界都拒绝未知字段。必须存在 Web Crypto；摘要计算失败会拒绝 Promise，不会转为校验诊断。

两种语法进入同一定义 parser 和规范 hash。维护中的 YAML parser 使用 YAML 1.2 core 标量；时间必须为字符串，日期形状的文本不会转为 Date。重复键（包括 JSON）、显式/自定义 tag、directive、merge key、anchor/alias、非字符串映射键、十六/八进制和非有限标量、不安全的原型键及多文档都在目录解析前拒绝。不支持 include 或可执行字段。已解码输入拒绝循环引用、accessor、隐藏属性及非 JSON 值，不调用自定义序列化器。

`WORLD_SCENARIO_INPUT_LIMITS` 固定文件与序列化输入/目录上限为 262,144 UTF-8 字节，深度为 32（根深度为零）、总节点为 16,384、单集合为 2,048 项、身份/引用字符串为 4,096，完整成功编译结果的序列化上限为 1,048,576 字节。对象/数组条目和取值计入节点；`id` 及以 `Id`/`Ids` 结尾的键计入引用。文本在解析前检查字节，YAML AST 在转换前检查，解码值在递归 schema 校验前检查。这些解析上限独立于执行额度；超限返回 `invalid-shape` 诊断。

接受创建命令前，使用原文件语法及已审阅的 hash 和目录代际调用 `verifyWorldScenario(input, currentCatalog, preview, format)`。编译器重新解析，拒绝发生变化的代际或 hash。所有者必须在接受期间保持目录稳定，并在任何创建 IO 前持久保存原命令和完整的成功解析结果。已接受命令的重试复用该结果；编译器不管理命令、不预留身份，也不使创建过程成为事务。

SHA-256 定义 hash 覆盖规范化的已解析 JSON：对象键排序、忽略 JSON 格式空白、保留字符串内容和数组顺序。预检 hash 还覆盖编译器版本、目录代际、冻结策略、所选模板与模型版本、时钟、实际限额和全部解析输入。输出深度冻结，与调用方对象分离。已安装策略、版本或可用性变化时，目录所有者必须推进代际。

## 可移植定义

定义包含 `apiVersion`、元数据、一个组织、带容量的岗位、默认版本化 runtime profile、所选版本化 Persona 模板、初始人物、任职、招聘授权和初始事件。`limits` 与逐人物 profile/Persona 覆盖为可选；成功解析会显式给出其实际值。

恰好一名人物的角色为 `director`，其他人物均为 `member`。姓名及全部 Persona 选择来自所选已安装模板。未覆盖 profile 的人物继承定义的默认 profile。省略的 Persona 字段来自已安装模板的显式默认 Persona。默认 profile 也用于未来生成的成员，因此必须允许 member。人物 profile 必须允许对应角色，且 profile 与模型都必须可用。

组织、岗位与人物共享唯一实体身份空间。任职与授权身份共享关系命名空间；每个人物最多具有一个初始任职。授权选择一名初始成员和一个已声明岗位；director 不能授权自己的申请。初始 `hire-request` 包含申请身份、请求者、岗位、模拟时间和描述，并要求匹配的授权。成功前检查初始占用、实体/历史/通道限额、初始事件数量和时钟边界。模型文字与模板描述不授予权限。

## 已安装元数据与解析输出

严格目录包含 `generation`、`policyVersion`、显式 Native 时钟/协议设置、带模型版本及可用性的已安装 runtime profile、带完整默认 Persona 的模板，以及完整的 Native/Team/world 限额默认值和上限。可移植输入只引用已安装 runtime profile 和模板，不能提供 provider 路径、Session 身份、runtime proof、凭证、代码或 endpoint。

显式请求超过部署上限时返回字段诊断并拒绝；省略值解析为目录默认值与上限的较小者，合法显式值保持不变。预检保留这些实际值。Native 限额包含模型、决策、驻留、输入、事件、重试和操作约束；Team 限额包含历史 Participant/activation、通道、投递、任务和整个生命周期预算。目录中每个字段都显式提供，底层 Native 允许零的限额也不例外。这些值是元数据；创建所有者必须把解析后的限额实际应用到 Native run 和 Team。

`resolved.native` 包含不带运行身份或存储路由的创建字段，以及固定的 `assignment` 和 `can-hire` 关系规则。`resolved.world` 是严格 Native 世界定义。`entities` 和 `relations` 是使用定义中符号身份的初始命令输入：人物从 `preparing` 开始，非认知组织与岗位实体为 `ready`。`actors` 保留完整 runtime、模型、模板和 Persona 选择；`generatedActorRuntime` 保留未来成员的默认配置。`channels` 为每名成员描述独立的 director 私有通道，不分配 Channel 身份。`initialEvents` 保留定时业务申请输入，不分配 HireIntent 身份。消费这些输入时，Native 仍须验证实时身份、授权、容量和 readiness。

## 完整 v1 编写

显式的 `parseWorldScenarioV1`、`compileWorldScenarioV1`、`verifyWorldScenarioV1` 与 `exportWorldScenarioV1Text` API 接受 `clocky.world/v1`。严格定义覆盖 runtime profile 与已安装领域、认知/非认知实体、组织单位和带区间的任职/授权、委员会和场景编写制度、事实、私有 belief、资源、通道、模拟外部身份、普通目标与有限日历。语义诊断保留字段路径；形状诊断还定位原文本来源。compiler 版本 `9` 固定完整原定义、包含全部默认值/上限及模板默认 Persona 的声明 `catalog`、独立观察的 `teamCeilings`、实际模型/限额、领域 pin 和 `bootstrap` 数据，不分配身份或调用模型。Native 准备通过原持久初始化责任记录及单次原子应用消费这些数据。原默认 compiler API 仍显式使用 v0。产品预检/创建/导出也接受 v1，重验实际 Native 领域 pin，并在 canonical 准备前保留完整编译结果。`resolvedWorldScenarioV1Schema` 从完整原目录与 Team 观察重建每项持久字段，不把有效限额替代为默认值/上限，也不构造虚假模板默认值。显式 Team 请求超过任一上限时拒绝；省略值使用较严格上限。纯编译与复核分别接受第4/第5个 `teamCeilings` 参数，无 Host 观察时明确为 null。compiler 版本不是 `9` 或缺失元数据均拒绝，不查询当前部署；创建 owner 单独核对定义和预览承诺。Director 声明要求显式安装的 `directorEvents` 能力、原有限日历、精确 World 根作用域/目标，以及不超过 occurrence 次数的正整数 `maxRequests`。缺失能力、坏引用和不支持的未来权限安装返回字段诊断。v1 作者台与 TS/Python SDK 共同使用这些端点。[分发示例](../../../examples/simulation-company/README.zh.md)覆盖 source TS/Python、普通 Node compiled TS 和已安装 Python wheel，通过实际 stdio Host 运行；只读恢复不构造 writable owner。

## 定义导出

`exportWorldScenario(resolved)` 返回与原对象分离、用于新运行的可移植定义。使用同一目录重新编译可保留解析语义和预检结果。导出不包含解析后的部署元数据、实际 runtime binding、日志或凭证。目录变化时必须重新预检；导出不是运行中世界的备份。`exportWorldScenarioText(resolved, format)` 以 JSON 或安全 YAML 输出该定义，两者重新编译得到同一定义 hash。

[公司](../../../examples/simulation-company/scenarios/world-company.json)和[实验室](../../../examples/simulation-company/scenarios/world-laboratory.json)定义使用同一编译器，只改变组织、岗位、Persona 引用和姓名。已安装目录夹具由消费者单独提供。

`metadata.description` 用作 Team 目标，必须包含非空白文本。纯空白输入在创建受理前由编译器返回定位到 `metadata.description` 的 `invalid-shape` 诊断。合法描述保留原始文本，包括首尾空白，导出与定义 hash 均使用该原文。

`limits.world.maxRequestsPerActorPerInterval` 可由作者降低，且必须存在于目录默认值/上限中。Compiler9 将解析值与 Native `budgetInterval` 一并保留；非法值或超过上限在创建前拒绝。Native 按原决策周期为每个真实请求者的每项已接受业务身份计费，终态仍计费；独立 `maxRequests` 历史上限覆盖全部新 intent。

组织图与等价键盘列表编辑使用封闭的 `ScenarioDraftCommand` 变体处理单位、岗位、容量与任职。`stageScenarioDraftCommand` 仅生成无副作用候选定义；调用者必须经 Host 预检后才能发布。`applyScenarioDraftCommand` 使用显式已安装目录完成该验证。二者沿用源码导入的 v1 编译器，因此未知引用、层级环与容量错误仍由同一所有者拒绝。布局坐标不属于这些命令或可移植定义。

## Model Experience

### 编译

#### What the model sees

`compileWorldScenario()` 不生成模型输入，而是向创建所有者返回冻结的模板与人物元数据。

#### Token effect

编译、预检复核和导出均不调用模型，也不消耗模型 token。

#### KV Cache effect

本包既不创建模型请求，也不修改 Session。后续上下文构造与缓存行为归消费者负责。

## Known Limitations and Deferred Work

- 编译器不创建产品、Native run、Team、Participant、Session 或 Channel；产品授权、已接受命令恢复与暂停 bootstrap 仍由消费者负责。
- `clocky.world/v0` 定义仅支持一个组织、一个 director、初始任职和有界的生成并入职申请；不包含任意领域操作、治理、调岗或离职流程。
- 容量校验描述初始元数据。未来预留、实时授权变化和跨所有者恢复仍需 Native 与 Team 执行约束；预检成功不授予执行权限。

可选 `organization.hiringFees` 严格编译显式收费的生成及既有人物录用。纯预检核对账户身份、资金种类/单位、操作/岗位引用、数量和正模拟有效期。全部条款保留于原定义及编译承诺中。compiler9 拒绝旧 v1 编译结果，不重构缺失的资金行为。

版本 1 日历可声明 `recurrence: { version: 1, clock: "simulation", shifts, exceptions, additions }`。各项均为规范模拟 tick，班次位于所声明 period 内。展开要求有限 `endsAt`、至多 4096 个周期/occurrence，并遵守运行 horizon。重复项、同时新增与排除的时间以及宿主本地日期/时区解释均在初始化前拒绝；导出保留原便携定义的这些字段。

可移植的 `clocky.world-template/v1` 模板包封装完整 v1 定义与严格清单：模板包 ID/版本、明确的许可证标识/声明、署名、精确的域 schema/实现 generation、允许的运行配置、有限模板及策略版本。`parseWorldTemplatePackage()` 使用有界惰性 JSON/YAML 解码器，拒绝未知字段和不完整依赖清单。`verifyTemplateDependencies()` 对照已安装目录拒绝不可用或改变的 pin；Product 在预检和创建时均检查。导入不安装代码。清单与世界事实、私人创作布局相互独立。

可移植 v1 `entities` 可包含 `kind: object`、`cognition: none` 及既有身份/名称/描述字段。这是普通展示对象，不是 Persona 或授权 owner；受支持的名称变更通过显式安装的领域操作完成。
