# DSH BrowserWorkbench 测试报告

[English Version](./VALIDATION.en.md) | 简体中文

本文记录 DSH BrowserWorkbench 当前 Release Candidate 的测试目的、测试内容、测试过程和测试结果。

> 2026-10 更新：默认注册模式已改为 `global`，并新增 `providerMode: auto`（Session 首次调用浏览器工具时自动启动该 Session 独立的持久化 Chromium）。下文中「托管启动不在工具面暴露」「Provider 只接受 external-cdp」「不启动后台浏览器」等边界仅描述当次验证时的代码状态，已不适用于当前代码。

> 2026-10-26 更新：客户端面板已收敛为单一实况视图，composer 绑定控件删除，新增设置页三态绑定、`disabled` 模式、`externalCdpEndpoint` 与外部 CDP 自动连接，单测增至 178。第十四、十五节中涉及「9 视图」「控制器菜单」「composer 控件」的结论已失效，逐项标注见第十六节。

候选状态以外部候选身份文件和 tarball 摘要为准。本文描述测试结果，不能单独证明某个版本已经完成 Git Tag、GitHub Release 或 npm 发布。

## 测试对象

```text
package: dsh-browser-workbench
version: 1.0.0-rc8
DSH compatibility target: 0.2.1-rc.2 / 0.2.1-rc.3
0.2.1-rc.2 validation: peer dependency check, strict typecheck, production build, Session Controller integration, 30-tool Chromium regression
full browser runtime validation: 30-tool regression passed; fresh DSH Web Profile lifecycle and UI acceptance pending
Node.js: 22.x
package manager: pnpm 11.x
```

RC8 的直接 DSH peers 声明为范围 `^0.2.1-rc.2 || ^0.2.1-rc.3`，Cordis 为 `~4.0.5`，Schemastery 为 `~3.18.5`。旧版 `0.1.x` 兼容范围不再声明。

DSH `0.2.1-rc.2` 更新了 Connection Peer 模型和传递 peer 依赖。BrowserWorkbench 继续注册 Connection 的认证精确 Fetch Route，认证、Host/Origin、请求体限制和取消由 Connection 提供。`dsh-tools` 新增 `dsh-working-directory` peer，后者依赖 `dsh-fs`；二者已加入开发验证依赖图。已移除停止发布的 `dsh-invariants`。

在 DSH `0.2.1-rc.2` 下，严格类型检查、Host/Client 正式构建、`pnpm peers check`、build-registry 检查、真实 App Boot Session Controller 集成和固定 Chromium `149.0.7827.55` 的 30 工具完整集成均通过。完整集成覆盖面板、分屏、持久化 Profile、扩展、Debugger、诊断取证、Network、性能产物、外部 CDP 和清理路径；所有断言通过，临时运行时、监听端口和外部 CDP 均完成清理。全新 DSH Web Profile 安装/启动/认证/卸载及 DSH Web UI 人工验收仍待完成。此前 `0.1.x` 验证不代表兼容 `0.2.x`，不沿用旧版验证结论。

本报告不自动承诺后续 DSH RC、正式版、其他操作系统或所有第三方浏览器插件兼容。

## 一、30 个浏览器工具集成

**测试目的**：确认 30 个 Agent 浏览器工具在真实 Chromium 中可以端到端工作，不是只通过类型检查和单元桩。

**测试内容**：标签与导航、页面观察、页面交互、文件链路、Console、Network、Debugger、Source Map、性能、环境模拟、Provider、扩展、人工协作和诊断取证。

**测试过程**：在真实 Chromium 中启动完整集成回归，由消费方依赖图解析 RC.2 npm 包，逐项调用工具并核对返回结果。

**测试结果**：

| 领域 | 已验证能力 |
| --- | --- |
| 标签与导航 | 新建、选择、关闭、前进、后退、刷新、导航 |
| 页面观察 | Snapshot、Ref、Query、Attribute、Screenshot |
| 页面交互 | Click、Hover、Type、Key、Scroll、Select、Wait、Dialog |
| 文件链路 | Upload、Download、Artifact 读取与 Session 隔离 |
| Console | 有界消息、错误、重复事件和脱敏 |
| Network | 请求列表、Body、请求/响应拦截、Continue、Abort、Fulfill、Replay、超时放行 |
| Debugger | Attach、断点、暂停、继续、单步、调用栈、Scope、脚本源码 |
| Source Map | 生成位置、原始位置、声明路径、解析路径、Build Identity |
| 性能 | CDP Trace、Playwright Trace、CPU、Coverage、Heap Snapshot、Heap Sampling |
| 环境 | Viewport、设备、Locale、Timezone、网络、CPU、离线、权限 |
| Provider | Managed、Persistent、External CDP、能力协商与断开 |
| 扩展 | Manifest V3、安装状态、启停、应用、真实 Popup |
| 人工协作 | Live View、Takeover、鼠标、键盘、输入法、PasteEvent、控制权归还 |
| 诊断证据 | Recorder、Checkpoint、Compare、Incident、Context/Build/Application Identity |

集成测试最终输出：

```text
toolCount: 30
navigation: pass
panel: pass
splitView: pass
persistentContext: pass
extensions: pass
debugger: pass
diagnose: pass
networkControl: pass
profile: pass
```

## 二、九视图 DSH 原生工作台

> 2026-10-26 注：本节记录的是 2026-10-24 之前的九视图面板形态，该形态已作废（面板现只保留实况视图），原文保留作为当次记录，失效项见[第十六节](#十六本轮变更面板瘦身与设置页绑定2026-10-26)。

**测试目的**：确认 BrowserWorkbench 使用 DSH 官方右侧栏机制提供九个工作台视图，并正确处理关闭、切换和多 Pane 生命周期。

**测试内容（RC1 历史基线）**：Hero 临时 Session 门禁、正式 Session 激活、九个视图切换、标签栏与导航栏持续性、面板内关闭与官方标签关闭同步、Session 切换、多 Pane 去重、旧版退出与释放流程。

**测试过程（RC1 历史基线）**：在真实 DSH Web Client 中人工操作，逐项核对界面状态与输入区状态是否同步。

**测试结果（RC1 历史基线）**：

- Hero 临时 Session 不会提前绑定正式 Agent Scope；
- 正式 Session 可以启用 BrowserWorkbench；
- BrowserWorkbench 使用 DSH 官方右侧栏页面型 Tab；
- 实况、诊断、Console、Network、Debugger、Performance、Provider、Extensions、Emulation 九视图可以切换；
- 标签栏、导航栏和当前页面状态在各视图中持续存在；
- 面板内关闭和 DSH 官方标签关闭都会同步输入区状态；
- Session 切换不会误关其他 Session 保存的 BrowserWorkbench Tab；
- 多 Pane 中已挂载标签从自身 Action 导航，不会在当前活动 Pane 重复创建；
- RC1 旧版 Controller 的退出并保留页面、重新激活、退出并释放资源流程均符合当时预期。

### RC2 新锁定界面实机结果

**测试环境**：隔离 `DSH_HOME`、隔离端口 `31880`、DSH `0.1.5-rc.2`、当前工作树 BrowserWorkbench，以及同一 Profile 中的真实第三方浏览器插件。

**测试过程**：用户在真实 DSH Web 中建立两个正式 Session。Session A 选择 BrowserWorkbench，打开九视图菜单并释放本插件资源；Session B 独立选择其他浏览器工具。随后精确重启隔离 DSH Web，再次打开两个原 Session 检查锁定恢复。

**测试结果**：

- 新正式 Session 初始显示“尚未选择浏览器工具”；
- 选择 BrowserWorkbench 后显示“已锁定”，九视图和已仲裁工具列表可用；
- 释放 BrowserWorkbench 资源后仍保持 BrowserWorkbench 锁定；
- 第二个 Session 可以独立选择其他浏览器工具，且不再提供启用 BrowserWorkbench 的入口；
- 重启 DSH Web 后，两个原 Session 分别恢复为 BrowserWorkbench 锁定和其他浏览器工具锁定；
- 两个持久记录均为 schema v2、`generation=1`；
- 两张 Session Controller 截图已按新界面重新生成并覆盖正式资源（第三张已剔除）。

## 三、Session 级 Controller 共存

**测试目的**：确认 BrowserWorkbench 可以在同一个 Profile 内按 Agent Session 管理浏览器工具面，并与第三方浏览器插件共存而不修改对方进程、配置或页面。

### RC1 已执行的切换基线

**测试内容**：代表性共存测试使用了一款当前较常见、使用率较高的成熟浏览器插件作为压力对照。公开报告不披露对照插件名称、仓库或精确版本。单一对照结果不代表全生态兼容。

**测试过程**：在同一 Profile 中同时加载 BrowserWorkbench 与对照插件，分别在普通 Session 和 BrowserWorkbench Session 中统计可见工具，检查兄弟 Session 状态，最后按 RC1 旧流程退出 BrowserWorkbench 并复查对照插件恢复情况。

**测试结果**：

```text
当前 Session 启用 BrowserWorkbench 后：30 个 BrowserWorkbench 工具可见
同名工具：由 BrowserWorkbench 在当前 Agent Scope 遮蔽
对照插件独有浏览器工具：只在当前 Agent Scope 受限
兄弟 Session：不受影响
RC1 旧版 BrowserWorkbench 退出后：对照工具恢复
对照插件进程、配置和页面：不由 BrowserWorkbench 关闭或修改
```

RC1 Controller 生命周期还验证了原子注册、维护队列、冷恢复、Agent 替换竞态、损坏状态回退、安全退出和 HMR 清理。这些结果证明旧切换实现的历史基线，不等同于 RC2 新锁定状态机已经通过。

### RC2 新锁定规则

RC2 工作线已经实现以下契约：

- 新正式 Session 初始为 `unselected`，选择前浏览器工具不向 Agent 暴露；
- 第一次选择 BrowserWorkbench 或其他浏览器工具后，该 Session 永久锁定所选工具；
- 释放 BrowserWorkbench 页面和运行资源不解除锁定，也不恢复第三方工具；
- DSH 重启或 Agent Scope 替换后恢复原选择；
- 持久记录升级为 schema v2；旧 BrowserWorkbench 激活状态继续锁定，旧 `other` 状态迁移为 `unselected`；
- 损坏记录保持 `unselected`；已经持久锁定 BrowserWorkbench 的记录即使恢复失败，也不会降级成可改选状态；
- BrowserWorkbench 只修改当前 Agent Scope 的工具可见性，不停止或重配第三方插件。

新的 `tests/browser-controller.ts` 和 `tests/session-controller-integration.mjs` 已按上述契约执行通过。

Controller 专项结果：

```text
unselectedToolsHidden: true
BrowserWorkbenchLocked: true
otherToolsLocked: true
releasePreservedSelection: true
restartPreservedSelection: true
migrationPersistedAsSchemaV2: true
failedSelectionRolledBack: true
failedOtherSelectionRolledBack: true
failedRestorePreservedLock: true
```

真实 DSH Agent Scope 集成结果：

```text
globalBrowserToolCount: 3
unselectedBrowserToolCount: 0
activeBrowserToolCount: 30
BrowserWorkbenchSelectionLocked: true
otherBrowserSelectionLocked: true
releasePreservedSelection: true
sameNameShadowed: true
uniqueThirdPartyRestricted: true
BrowserWorkbenchPersistedGeneration: 1
otherBrowserPersistedGeneration: 1
runtimeRemoved: true
```

## 四、浏览器状态与 Session 隔离

**测试目的**：确认共享 Persistent Context 与 Session 隔离同时成立，共享网站状态但不串页面和调试状态。

**测试内容**：默认 `managed-persistent/default` 的共享项和隔离项。

**测试过程**：在多个 DSH Session 之间交叉操作页面、标签、Popup、Debugger、Network 拦截和 Artifact，核对状态边界。

**测试结果**：

已验证的跨 Session 共享内容：

- Cookie；
- LocalStorage、IndexedDB、Cache Storage；
- HTTP 缓存；
- Service Worker；
- 网站权限；
- 扩展登记与加载状态。

已验证的 Session 隔离内容：

- Page、View、标签与 Popup；
- 活动标签和上下双页焦点；
- Debugger、Network、Ref、Snapshot 和 Screencast；
- Artifact 与人工接管；
- Controller 状态与 generation。

网页 `window.open()` 会继承正确 Owner。无法确认 Owner 的新页面不会暴露给任意 Session。销毁一个 Session 不会关闭其他 Session 的页面。扩展立即生效触发全局协调重建时，各 Session 的 URL、活动标签和双页布局会按记录恢复。

## 五、跨上下文与真实浏览器边界

**测试目的**：防止 Agent 把"相同 URL""相同页面外观"或"同身份测试"误判为完整业务等价证明。

**测试内容**：主页面与 OOPIF、Target / Frame / Document / Execution Context 生命周期、同文档与跨文档导航、Frame 交换、多种执行世界、Shadow DOM / SVG / Canvas Surface、多 Build 与 Application Identity。

**测试过程**：在真实 Chromium 中构造跨上下文场景，检查身份传播、失败关闭和源码内容身份。

**测试结果**：

- 主页面与 OOPIF；
- Target、Frame、Document 和 Execution Context 生命周期；
- 同文档导航与跨文档导航；
- Frame 交换、占位提交与移除；
- 主世界、隔离世界和暂停帧；
- Shadow DOM、SVG 和 Canvas Surface；
- 多 Build 与 Application Identity；
- 不可比 Checkpoint/Compare 的失败关闭；
- Source Map 声明路径、解析路径和源码内容身份。

以上项目全部符合预期。

## 六、输入、实况与人工接管

**测试目的**：确认实况画面和人工输入在真实浏览器中可用，且控制权归属清晰。

**测试内容**：标准实况尺寸、自适应 Viewport、双页画面流、帧预算、输入坐标系一致性、代际变化后的旧输入拒绝、鼠标与键盘输入、中文输入法、剪贴板 PasteEvent 和 Takeover 权限边界。

**测试过程**：在实况画面中执行人工输入，并在 View、Screencast 和 Viewport 代际变化后重放旧输入。

**测试结果**：

- 标准 `1280×720` 实况；
- 自适应 Viewport 与有限强制重排；
- 浏览器内部上下双页独立画面流；
- 30 FPS 有效帧预算；
- 最高 `1920×1200`、JPEG 85 的实况参数；
- 同坐标系动画换帧下的人工输入；
- View、Screencast 和 Viewport 代际变化后的旧输入拒绝；
- 鼠标按下、移动、释放与滚轮；
- 键盘修饰键、中文输入法与空格输入；
- 系统剪贴板只通过最终 PasteEvent 进入页面，不读取或枚举历史；
- Takeover 期间模型写操作受限，归还后恢复。

## 七、扩展与浏览器供应

**测试目的**：确认扩展安装链路的输入校验和运行时边界有效。

**测试内容**：扩展来源输入、CRX 解析、Manifest 版本、ZIP 结构安全、扩展身份一致性、安装与启停、Popup 页面行为、并发 RPC 互斥。

**测试过程**：在真实 Chromium 中安装扩展，检查 Popup 是否进入普通标签栏，并验证长 RPC 与 Snapshot 轮询的互斥行为。

**测试结果**：

- Chrome Web Store URL 或扩展 ID 输入；
- CRX2/CRX3 解析与签名相关身份校验；
- Manifest V3；
- ZIP 路径穿越、重复条目、符号链接、加密、文件数量与大小上限；
- 扩展 ID 与运行时 Origin 一致；
- 安装、启用、禁用、卸载和重启应用；
- 真实 `chrome-extension://` Popup 页面、实况和输入；
- Popup 不进入普通标签栏，不污染 Session 活动网页；
- 扩展长 RPC 与 Snapshot 轮询互斥，避免连接层并发错误。

当前自动 Chromium 安装路径重点验证 Windows x64。网络源不可达时，面板返回可恢复错误，超时不会显示为安装成功。

## 八、性能、隐私与有界性

**测试目的**：确认诊断数据有界、输入隐私不落盘、跨 Session 读取失败关闭。

**测试内容**：Recorder 的 Off、Rolling、Deep、Metadata-only 和 Incident 阶段，保留窗口、淘汰规则、降级行为、输入追踪脱敏、诊断值 JSON 无损和跨 Session Artifact 读取。

**测试过程**：运行公开测试并执行 30 分钟**虚拟时间**保留窗口模拟。

**测试结果**：

- Rolling 保留窗口为 180 秒；
- Incident Freeze 在普通事件淘汰后仍保留；
- 高负载可以降级为 Metadata-only；
- Timeline 和事件数量有界；
- 输入追踪不保留输入明文；
- 诊断值满足无损 JSON；
- 跨 Session Artifact 读取失败关闭。

30 分钟虚拟时间模拟只证明保留与淘汰算法边界，不等同于真实墙钟 30 分钟浏览器稳定性测试。

生产依赖已通过官方 npm Registry 安全审计，当前结果为无已知漏洞。安全数据库结果会随时间变化，发布后仍需持续复核。

## 九、复杂应用场景试跑

**测试目的**：在一个接近真实生产故障的任务中检验 BrowserWorkbench 的完整证据采集能力。

**测试内容**：任务包含连续异步任务、旧结果迟到、页面预览与草稿与导出与刷新之间的身份传播、生产压缩 Bundle 与外部 Source Map、跨站点与 OOPIF、私有判定边界，以及修复前后的浏览器证据采集。

**测试过程**：由 Agent 使用 BrowserWorkbench 复现故障、采集证据、提交修复补丁，再由外部验收设施执行判定。

**测试结果**：结果分为四层，必须分层理解。

| 层级 | 结论 | 解释 |
| --- | --- | --- |
| BrowserWorkbench 插件能力 | `PASS` | 30 工具、真实浏览器、调试、证据采集和资源清理预检通过 |
| Agent 提交的应用补丁 | `PARTIAL PASS` | 公开测试与构建通过，私有关系矩阵为 4/5，漏掉一个身份变化与低顺序回退组合 |
| 外部正式验收设施 | `FAIL` | 正式访问前服务端口已经不可连接，且缺少完整进程退出证据 |
| 综合 | `QUALIFIED_PARTIAL_PASS` | 支撑插件能力结论，但不能宣称应用修复、模型表现和外部设施全部通过 |

本次试跑推动 `browser_diagnose` 增加通用"身份 × 顺序 × Owner/Context"完成指导。改进不包含任务专属字段、私有答案或硬编码测试结论。

## 十、构建与发布确定性

**测试目的**：确认构建产物不随绝对路径漂移，npm 包内容与工作树一致。

**历史测试内容**：在两个不同绝对目录中执行构建并比对字节。npm 门禁先预览清单，再生成真实临时 gzip tarball，直接解析 POSIX tar 条目逐项核对，最后删除临时 tarball。

**历史测试结果**：RC1 对应四个产物已证明可在不同绝对目录中逐字节一致。CSS Modules 使用仓库相对稳定路径参与 Hash，维护者目录、公开副本和 CI 不会因绝对路径不同而生成不同的 Client 字节。

**当前 RC2 工作树构建结果**：`npm run build` 已通过严格 TypeScript、Host ESM、类型声明和 Client Bundle 构建。当前产物摘要如下；本轮没有重复执行双目录确定性构建。

| 产物 | SHA-256 |
| --- | --- |
| `lib/client.js` | `25b8950a1e4e2c210fd31df5ee8f32dcb32d1e67501ad3ae44af4f94583923b3` |
| `lib/client.js.map` | `69274b7bf3820d9ed3fcfd4645e7b1c2ee47f3de17f701ea8d43ffdf36034eda` |
| `lib/index.mjs` | `3247b9fc53f2b5869aa20d1edb249748b74a1875681c9035cbd9c325fac8ead6` |
| `lib/index.d.mts` | `6884ae01362ca921f53016f2034670da9a36653fbf79333006a5e3414ddf5952` |

npm 发布门禁要求：

1. `npm pack --dry-run --json` 预览文件清单；
2. 生成实际临时 gzip tarball；
3. 直接解析 POSIX tar 条目；
4. 核对固定公开文件白名单；
5. 核对包内每个文件非空；
6. 核对包内文件与工作树逐字节一致；
7. 删除临时 tarball；
8. 候选冻结后，同版本只允许复核，不允许重新打包覆盖。

当前 RC2 工作树已实际执行上述 npm 门禁。文档回填前后两次检查均通过：预览 20 个文件、实际 tarball 20 个文件、包内文件全部非空并与工作树逐字节一致；临时 tarball 均由检查器删除。压缩体积属于检查运行结果，不写入包内文档，避免文档自身改变归档字节。

Release Candidate 的项目 `.npmrc` 默认发布标签固定为 `rc`。正式发布命令仍必须显式传入 `--tag rc`，并以 npm dry-run 输出 `with tag rc` 作为最终判定，避免预发布版本占用 `latest`。

## 十一、资源清理

**测试目的**：确认测试结束后浏览器、端口、External CDP 和运行目录均已释放。

**测试内容**：端口关闭、External CDP 断开、运行目录移除，以及各类浏览器资源的生命周期收敛。

**测试过程**：完整 Chromium 集成结束后检查残留进程、端口和目录，并单独验证 External CDP Disconnect 对用户浏览器的影响。

**测试结果**：

```text
portClosed: true
externalCdpClosed: true
runtimeRemoved: true
```

另验证：

- External CDP Disconnect 不关闭用户浏览器；
- BrowserContext、CDP Session、Debugger、Fetch、Trace、Recorder 和 Screencast 按生命周期收敛；
- 临时 tarball 和候选解包副本完成清理；
- 根级运行目录不残留；
- 冻结候选与身份文件只读。

## 十二、尚未证明的内容

当前结论不覆盖：

- 所有 DSH 版本；
- 所有操作系统与 CPU 架构；
- 所有第三方浏览器插件；
- DRM、Native Messaging、Manifest V2；
- CAPTCHA、验证码、Passkey/WebAuthn 或设备确认自动化；
- 所有网站反自动化策略；
- 所有浏览器扩展和 Chrome Web Store 网络环境；
- 被调试应用本身的业务正确性；
- 任意模型在任意任务中的成功率；
- 外部测试服务和部署系统的稳定性；
- 对 DSH 插件全生态的绝对排名。

## 十三、复现方式

```powershell
pnpm install --frozen-lockfile --ignore-scripts
pnpm peers check
npm run build
node scripts/check-public-package.mjs
```

仓库保留历史专项和集成测试文件，默认脚本不聚合启动大型 Chromium。复核特定能力时，维护者应根据变更范围显式运行对应的单个测试文件。需要真实 Chromium 时，还必须显式提供已经验收的浏览器根。测试不得隐式下载，也不得扩大到无关场景。

公开 CI 不隐式下载维护者浏览器，也不运行需要私有测试设施的场景。公开结果只用于复核源码、依赖、构建和实际 npm tarball。复杂应用试跑与真实 Web 人工验收按各自记录独立成立。

## 十四、本地隔离验证与真实 UI 回放（2026-10-24）

> 本节记录在**不改动桌面端 Profile** 的前提下，用独立进程 + 独立 `DSH_HOME` 跑通的七层验证，以及这轮验证暴露并修复的七个真实缺陷。

### 14.1 为什么必须隔离进程

Host 侧插件与 harness 同进程加载：插件在 `apply()` 里同步抛错会直接带走整个实例，用户在桌面端正在跑的所有 Session 一起中断；Client bundle 出错则只坏该实例的页面。因此「装了再卸」不是安全边界，**独立进程 + 独立 `DSH_HOME`** 才是。

| 方式 | 隔离度 | 结论 |
| --- | --- | --- |
| 装进 desktop Profile（58186） | 无 | 不做：崩溃会波及正在使用的主实例 |
| 同一 `DSH_HOME` 另开 Profile | 部分 | 不做：共享 sessions/storages，双进程并发写有风险 |
| 独立 `DSH_HOME` + 独立端口 | 完整 | 采用：`.sandbox/home` + Profile `verify` + `:31880` |

沙箱通过 `link:` 挂载当前工作树，改动后 `npm run build` + 重启即可复验。

### 14.2 七层验证矩阵

| 层级 | 入口 | 覆盖 | 结果 |
| --- | --- | --- | --- |
| 静态门禁 | `npm run typecheck` / `npm test` / `npm run build` | 类型、178 项单测、`lib/index.mjs` + `lib/client.js` + sourcemap | 0 错误 / 178 通过 / 构建成功 |
| Runtime 层 | `npm run verify:tools` | 30 个 `browser_*` 工具的 145 项断言（含负例） | 145/145 通过 |
| 实例层 | `npm run verify:instance` | 沙箱实例加载 Client bundle、composer 槽位、认证 RPC 往返、console 洁净、截图 | 10/10 通过 |
| 真实 UI 面板层 | `npm run verify:panel` | 沙箱实例里发消息形成正式 Session → 控制器菜单激活 → 面板 9 视图 + Provider 连接 + 实况帧/自适应 + 面板内人工接管与真实键鼠输入 | 33/33 通过 |
| 扩展层 | `npm run verify:extensions` | 本地目录安装 MV3 扩展、注册表落盘、禁用/启用/卸载、popup 错误路径、拒绝 MV2 与坏 manifest、`apply` 不拆外部分支 | 19/19 通过 |
| 托管启动 + 代理/HTTPS 层 | `npm run verify:managed` | 受保护方法 `persistentContext` / `launchSharedPersistentContext`：`executablePath`、headless、custom/direct/system 代理、HTTP 明文转发、HTTPS `CONNECT`、代理 Basic 认证与 407 挑战、共享 Context 复用与外来页面驱逐、离线安装与摘要/超时/HTTPS 约束 | 16/16 通过 |
| 配置 + RPC/持久化层 | `npm run verify:config` / `npm run verify:rpc` / `npm run verify:persist` | 13 项配置运行时行为；16 项 `/api/browser-tools` 认证边界与控制器选择跨刷新；`--phase=prepare` 认领 + Host 重启 + `--phase=verify` 复核 | 13/13 · 16/16 · 7/7 + 5/5 通过 |

Runtime 层使用真实 Chrome（`Chrome/155.0.8059.85`）经 `external-cdp` 连接，页面为 `scripts/verify/fixtures.mjs` 起的本地夹具站点；每轮输出 JSON + Markdown 报告到 `.sandbox/reports/`，退出码只看 FAIL。

### 14.3 30 工具用例分布

| 工具 | 用例 | 工具 | 用例 | 工具 | 用例 |
| --- | --- | --- | --- | --- | --- |
| browser_provider | 5 | browser_snapshot | 2 | browser_debugger | 11 |
| browser_tabs | 5 | browser_click | 5 | browser_diagnose | 17 |
| browser_navigate | 5 | browser_type | 1 | browser_network_control | 12 |
| browser_navigate_back | 1 | browser_evaluate | 6 | browser_profile | 11 |
| browser_query | 13 | browser_select_option | 1 | browser_emulate | 10 |
| browser_hover | 1 | browser_scroll | 2 | browser_live_view | 3 |
| browser_press_key | 2 | browser_get_attribute | 2 | browser_split_view | 8 |
| browser_wait_for | 4 | browser_take_screenshot | 2 | browser_extensions | 1 |
| browser_console_messages | 2 | browser_network_requests | 2 | browser_takeover | 5 |
| browser_handle_dialog | 3 | browser_upload_file | 2 | browser_download | 1 |

### 14.4 本轮发现并修复的缺陷

1. **composer 槽位崩溃（React #185）**：两处叠加——`src/client/panel-controller.ts` 的 `snapshot()` 每次返回新对象字面量；`src/client/hooks/usePanelSync.ts` 又把内联箭头函数传给 `useSyncExternalStore`，每次渲染都产生新的 `subscribe`/`getSnapshot` 引用而重订阅；同时 `panel-controller.subscribe()` 在订阅时还会同步回调一次监听器，「订阅即通知」→ 重渲染 → 重订阅，形成死循环。真实 UI 里 `conversation.input.right` 被 SlotBoundary 判为崩溃（渲染成 `data-slot-error` 空节点），composer 的「浏览器」控件整块消失，console 报 `Minified React error #185`（Maximum update depth exceeded），栈顶指向 `dsh-browser-workbench/client.js`（RPC 本身一直 200，纯前端问题）。修复：未挂载时返回冻结的 `closedSnapshot`、挂载后按 Session 缓存快照；`usePanelSync` 用 `useCallback` 固定两个回调引用；`subscribe()` 不再同步通知（`useSyncExternalStore` 订阅后会自己读一次快照）。补两个单测：快照身份稳定、订阅期不得通知。
2. **`browser_navigate_back` 在 bfcache 站点上必超时**：`page.goBack({waitUntil:'domcontentloaded'})` 在历史恢复不触发 `domcontentloaded` 时整整等满 30s 才报错（其实已经退回上一页）。修复：`awaitBackNavigation()` 并行轮询 URL，变化即返回，超时仅在 URL 未变时才抛；同一用例耗时 30031ms → 122ms。
3. **`browser_provider disconnect` 成功拆除后仍抛错**：先 `views.clear()` + `cleanupProvider()` 把 Provider 置为 disconnected，再 `restoreTabs()` 里 `createPage()` → `BROWSER_NOT_CONNECTED`，调用方拿到失败但状态已断开。修复：断开分支只做拆除并清空 `activeViewId` / 双页状态，不再重建标签。
4. **Provider 端点输入框缺可访问名**：`ProviderView` 只用 `<label>` 包了文字，`input` 自身没有 `aria-label`；而插件的 `query field=refs` 按 `aria-label || title || textContent` 取名，纯输入框拿不到 ref（读屏器同样受影响）。修复：给输入框加 `aria-label="远程调试地址"`。
5. **`subagentInteractive=false` 的委派拦截有漏网工具**：`src/application/security-policy.ts` 的子代理拒绝分支只匹配一部分交互工具，`navigate` / `navigate_back` / `handle_dialog` / `hover` / `scroll` / `tabs(new)` 会从缺口漏过——文档声称「委派会话不能操作浏览器」但实际能导航和确认对话框。修复：把导航变更（`navigationMutation`）、指针交互（`pointerInteraction`）、标签导航并入同一条拒绝条件；`tests/application/security-policy.test.mjs` 扩到 8 个用例（17 个工具的定义表）。
6. **本地目录安装扩展必定失败**：安装分支把目录路径直接喂给 `chromeWebStoreExtensionId()`（只接受 Chrome Web Store URL 或 32 位 ID），任何 `browser_extensions install` 传本地目录都会抛 `extension input must be a Chrome Web Store URL or a 32-character extension ID`——而 README 的推荐用法正是本地目录。修复：`src/extensions/crx.ts` 新增 `unpackedExtensionId()`（按 Chrome 规则用绝对路径的 SHA-256 前 16 字节映射 `a`–`p`，Windows 先小写）与 `extensionIdForKey()`；安装分支读 `manifest.json`、要求 Manifest V3、`name`/`version` 非空，按 `manifest.key` 或目录推导 ID，并解析 `action.default_popup`。
7. **`browser_extensions apply` 会拆掉用户自己的浏览器连接**：重启流程「拆除 → 重绑 Provider → 恢复标签」对外部 CDP 绑定不成立——用户 Chrome 无法被插件重启，拆掉绑定后 `bindContext` 建页直接 `Target page, context or browser has been closed`，Session 从此不可用。修复：`restartPersistentSession()` 对 `providerBinding.kind === 'external-cdp'` 提前返回，只从磁盘重读扩展注册表，保留待重启标记。

### 14.5 环境限制与不可达路径（非缺陷）

- `browser_live_view adaptive`：Runtime 层没有打开的面板，无法上报可用尺寸，返回 `ADAPTIVE_SIZE_UNAVAILABLE`（可恢复）；在面板真正打开的真实 UI 下已验证可用（`verify:panel` 的「live view adaptive mode applies」）。
- 沙箱 `DSH_HOME` 默认没有模型凭据，只能停在「临时空白 Session」，`sidebar.right.pane.tab` 的面板本体无法展开。本轮为验证面板本体，把本机 `.dsh/.credentials.yaml` 复制进 `.sandbox/home`（只在该隔离 home 内，验证完即可删除），发一条消息形成正式 Session 后，面板 9 个视图、Provider 连接、实况帧与自适应全部走通。
- `browser_profile artifact_read`：14MB heap snapshot 超过单次读取上限，用例改用最小 artifact 验证读取链路。
- 对 DSH 页面自身截图（面板正在推实况帧）偶尔会撞到 Playwright 30s 截图预算，`verify:panel` 因此对截图做一次重试、失败降级为 SKIP 而不判功能失败；面板内的功能断言不依赖截图。
- **托管启动不在工具面暴露**：Provider 只接受 `external-cdp`，面板文案也写「不会下载或托管新的浏览器」，`providerBinding` 只有 `disconnected` / `external-cdp` 两个写入点。`verify:managed` 因此直接调用 runtime 的受保护方法 `persistentContext()` / `launchSharedPersistentContext()` 做真实浏览器验证（16 项全过）；「工具面用户走不到」是产品设计，不是测试遗漏。
- **托管下载的元数据表落后于 playwright-core**：`src/provider/chromium-manager.ts` 的 `KNOWN_ARCHIVES` 只有 `149.0.7827.55`，而当前 playwright-core 1.64.1 期望 `156.0.8078.4`，`descriptor()` 会 fail-closed 抛 `Chromium 156.0.8078.4 does not have verified archive metadata`。这是刻意的完整性策略（没有已验证的字节数 + md5 就不下载、不解压）；补齐需要联网抓取该构建的元数据。离线安装路径本身已用本地 HTTP + 真实 ZIP 归档验证（`verify:managed` 的「offline install verifies size, digest and extracts」「install refuses a tampered digest」「install rejects a non-HTTPS attempt host」「install times out a stalled download」），不依赖公网。
- **代理与 HTTPS 只在托管启动生效**：`verify:managed` 用本地代理服务器验证 `custom`（HTTP 明文转发、HTTPS `CONNECT` 隧道、Basic 认证的 407 挑战与重放）、`direct`（`--no-proxy-server`，代理 0 条记录）、`system` 三种模式；HTTPS 夹具用自签 PFX + `certutil -addstore -user Root` 临时信任，仅本次运行生效、结束时 `-delstore` 撤销，全程不依赖外网出口。
- **Session 行不进入 evaluate 可见的 DOM**：DSH 侧栏会话行在 `runtime.evaluate` 的 `querySelectorAll` 里查不到（`textContent` 不含标题，但 `innerText` 有），跨重启复核因此改用 Playwright locator + 侧栏搜索框（`input[placeholder="搜索会话名称"]`）驱动；这是 harness 观测手段差异，不是插件缺陷。

### 14.6 复现

```powershell
npm run build
npm run verify:tools          # Runtime 层，真实 Chrome + 本地夹具站点
npm run verify:extensions     # 扩展层：安装/注册表/禁用启用/popup/拒绝路径/apply
npm run verify:managed        # 托管启动：executablePath/headless/代理/HTTPS/共享 Context/离线安装
powershell -NoProfile -File scripts/verify/sandbox.ps1   # 独立 DSH_HOME 起实例，打印带 token 的 URL
$env:DSH_VERIFY_URL = "http://127.0.0.1:31880/?token=<token>"; $env:DSH_VERIFY_TOKEN = "<token>"
npm run verify:instance       # 实例层：Client bundle、composer 控件、RPC 往返
npm run verify:panel          # 面板层：正式 Session → 激活 → 9 视图 → Provider → 实况 → 人工接管
npm run verify:config         # 配置层：13 项配置在运行时的真实效果
npm run verify:rpc            # RPC/持久化层：认证边界 + 控制器选择跨刷新
npm run verify:persist -- --phase=prepare   # 认领并记录 marker
# 重启沙箱 Host（换新 token）后：
$env:DSH_VERIFY_URL = "http://127.0.0.1:31880/?token=<new-token>"
npm run verify:persist -- --phase=verify    # 跨 Host 重启复核
```

## 十五、配置项与 RPC/持久化矩阵（2026-10-24）

> 第十四节的工具 / 实例 / 面板三层回答「功能能不能用」，本节回答「配置是否真的生效」与「RPC 边界与状态是否真的持久」。

### 15.1 配置项矩阵

`src/application/config.ts` 共 21 个配置项，按验证方式分三类；schema 层的默认值与枚举/数值下限另由 `tests/application/config.test.mjs` 的 2 个用例锁定（`subagentInteractive=false`、`headless=true`、`chromiumDownloadTimeoutMs=300000`、`session-select`；`'mirror'`/`'per-session'`/`proxy.mode:'tunnel'`/`timeout:999`/`maxOutputChars:999` 全部抛错）。

**运行时实测（13 项，`npm run verify:config`）**

| 配置项 | 用例 | 实测结果 |
| --- | --- | --- |
| 默认配置 | 打开夹具站点 | 通过 |
| `allowedOrigins` | 只列 `http://127.0.0.1:<port>` 时访问 `http://localhost:<port>` | `POLICY_DENIED`，列出的 origin 仍放行 |
| `allowLoopback=false` | 访问 `127.0.0.1` | `POLICY_DENIED loopback browser targets are disabled` |
| `allowPrivateNetwork=false` | 访问私网地址 | `POLICY_DENIED private-network browser targets are disabled` |
| `maxOutputChars=1000` | 读回超长文本 | 输出截断到 1001 字符，尾字符为 `…` |
| `maxUploadBytes=64` | 上传 128 字节文件 | `POLICY_DENIED upload file is invalid or exceeds the configured size limit` |
| `uploadRoots=[dir]` | 上传 `uploadRoots` 之外的路径 | `POLICY_DENIED upload path is outside configured roots` |
| `maxDownloadBytes=1024` | 下载 4096 字节文件 | `POLICY_DENIED download exceeds the configured size limit` |
| `artifactRoot` | `profile trace_*` 产物落盘位置 | 落在自定义根的 `sessions/<key>/` 下 |
| `externalCdpTimeoutMs=1000` | 连接 `http://127.0.0.1:9` | 4ms 内以 `ECONNREFUSED` 失败 |
| `maxArtifactBytes=512` | 读取超限 trace | `ARTIFACT_TOO_LARGE … 512 byte limit` |
| `interceptionTimeoutMs=1000` | 暂停一个请求后不再操作 | 约 1141ms 自动放行，`list_paused` 归零 |
| `toolRegistrationMode` / `sessionController.*` | 由实例层与面板层覆盖 | 见 14.2 |

**`managed-launch` 专属（5 项）**：`executablePath`、`headless`、`proxy`（含自定义账号密码）、`chromiumDownloadSource`、`chromiumDownloadTimeoutMs`。这些只在插件自己托管启动 Chromium 时生效；当前 v2 的 Provider 只接受 `external-cdp`，工具面用户走不到托管启动（见 14.5），因此它们被验证两次：schema 层由 `tests/domain/policy.test.mjs` 的 `managed launch settings are normalized for the isolated browser path`（`headless:false`、相对 `executablePath` 解析成绝对路径、`chromiumDownloadSource:auto`、`300000`、缺省 `undefined`）、`tests/provider/launch-config.test.mjs`（`browserLaunchNetwork` 的 direct/custom 代理参数、`executablePath` 透传、分屏状态默认与恢复）与 `tests/provider/chromium-manager.test.mjs`（npmmirror/official/auto 的尝试 URL 与允许主机）锁定；真实浏览器层由 `npm run verify:managed` 的 16 项覆盖——直接调用 runtime 受保护方法 `persistentContext()` / `launchSharedPersistentContext()`，验证 `executablePath`、headless UA、custom/direct/system 三种代理、HTTPS `CONNECT`、代理 Basic 认证、共享 Context 复用与外来页面驱逐、离线安装与摘要/超时/HTTPS 约束。

**`subagentInteractive`（1 项）**：默认 `false` 时，来源为 `subagent` 的调用对交互类浏览器工具拿到 `{kind:'deny', reason:'delegated browser session cannot use …'}`，顶层会话则按 permissionPreset 决定 allow/ask（`src/application/security-policy.ts`），由 `tests/application/security-policy.test.mjs` 的 8 个用例覆盖（含本轮补齐的缺陷 #5：导航、对话框、hover/scroll、标签导航都算交互类）。

### 15.2 RPC 与持久化矩阵（16 项，`npm run verify:rpc`）

| 分组 | 用例 | 结果 |
| --- | --- | --- |
| 入口认证 | 无 token 读 UI / 错误 token / 正确 token → 303 + `dsh-auth-*` Cookie / Cookie 单独可读 UI / Cookie 为 httpOnly | 401 / 401 / 通过 / 通过 / 通过 |
| 调用认证 | 匿名 `POST /api/browser-tools` / 篡改 Cookie | `401 unauthorized` / `401 unauthorized` |
| 信封契约 | 非 JSON 请求体 / JSON 但不是 Connection RPC 信封 | `400 body is not JSON` / `400 invalid Connection RPC envelope` |
| 路由边界 | `GET /api/not-a-route` | 404，不泄漏 RPC 处理器 |
| 成功往返 | 真实 UI 里经控制器菜单「确认选择」认领 BrowserWorkbench | badge 变 `DSH BrowserWorkbench（已锁定）` |
| 持久化 | 重新导航整页后 badge 仍为已锁定、console 无 error | 通过 / 通过 |

持久化的判定点分两级：① **整页刷新**（`verify:rpc`）——认领状态由 Host 的 Session 投影承载，整页重载会丢掉所有客户端状态；重载后 badge 仍读作「已锁定」，说明该状态来自服务端而非前端内存。② **Host 进程重启**（`verify:persist`）——`--phase=prepare` 在真实 Session 里认领 BrowserWorkbench、打开面板并记录 marker（7/7），随后重启沙箱 Host（换新 token），`--phase=verify` 用侧栏搜索找到该 Session，badge 仍为 `DSH BrowserWorkbench（已锁定）`、控制器菜单仍提供「打开 BrowserWorkbench 标签」、面板可重新挂载（5/5）。RPC 成功路径无法用裸 HTTP 复现——`/api/browser-tools` 只接受 Connection 传输层信封（HTTP 侧一律 `400 invalid Connection RPC envelope`），因此成功往返由真实 UI 驱动面板控制器完成，与本节的边界检查互补。

### 15.3 复现

```powershell
npm run verify:config   # 13/13
npm run verify:rpc      # 16/16（需要沙箱实例 + token）
npm run verify:persist -- --phase=prepare   # 7/7，记录 marker
# 重启沙箱 Host（换新 token）后：
npm run verify:persist -- --phase=verify    # 5/5
```

## 十六、本轮变更：面板瘦身与设置页绑定（2026-10-26）

> 本轮把客户端面板收敛为单一实况视图、删除 composer 绑定控件，新增设置页三态绑定、宿主配置写回与外部 CDP 自动连接。第十四、十五节记录的是改动前的 UI 结构，其中涉及「9 视图」「控制器菜单」「composer 控件」的结论已失效，逐项标注见 16.3。本节只登记本轮实测到的结果，未重写的 e2e 一律不计为通过。

### 16.1 静态门禁

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 严格类型检查 | `npm run typecheck` | 0 错误 |
| 单元测试 | `npm test` | 178 / 178 通过 |
| 正式构建 | `npm run build` | 成功，产出 `lib/client.js` 与 `lib/index.mjs` |

单测从 174 增至 178：新增/调整的用例覆盖三态绑定的配置补丁映射、`controller_overview` 与 `controller_set_browser_choice` 的路由与参数校验、`disabled` 分支、`externalCdpEndpoint` 的 schema 与策略透传、`BrowserController.list()`。

### 16.2 本轮改动与验收方式

| 改动 | 代码位置 | 本轮验收方式 |
| --- | --- | --- |
| 面板只剩实况视图 | `src/client/components/panel/BrowserPanel.tsx`（仅 `TabBar` + `NavigationBar` + `LiveView`） | 打开面板确认无视图切换入口、无「打开诊断」按钮与 Recorder 控件，实况画面正常（截图 `assets/browser-workbench-panel.png`） |
| 8 个视图目录与 composer 控件删除 | `src/client/components/views/{console,debugger,diagnostic,emulation,extensions,network,performance,provider}/`、`src/client/components/control/`、`src/client/hooks/{useAutoReveal,useControllerBinding,usePanelSync}.ts` | 构建通过即证明无残留引用；单测覆盖客户端状态模块 |
| `guide` 入口 | `src/client/index.tsx`（`id: 'live'`、`order: 20`、`BrowserGlyph`） | 右侧栏「开始」页出现「浏览器实况」卡片，点击可展开面板（截图 `assets/browser-workbench-entry.png`） |
| 设置页三态绑定分区 | `src/client/index.tsx`（`settings.section`，`id: 'browser'`、`order: 60`）、`src/client/components/settings/BrowserSettingsSection.tsx` | 打开设置 → 「浏览器」分区，三张卡片可切换；`existing` 展开端点输入，`/json/version` 校验提示可见（截图 `assets/browser-workbench-settings.png`、`assets/browser-workbench-settings-existing.png`） |
| 绑定写回（`configEditor`） | `src/compat/config-editor.ts` | 切换后 `~/.dsh/profiles/<profile>/cordis.patch.yml` 中 `- id: browser-tools` 的 `toolRegistrationMode` / `providerMode` / `externalCdpEndpoint` 发生变化并触发热重载；不可写时出现手改提示 |
| `disabled` 模式 | `src/application/config.ts`、`src/compat/rpc-dispatcher.ts` | 选「停用本插件」后 `browser_*` 不再出现在工具面，`controller_status` 返回 `blockers: ['browser-tools-disabled']`，面板提示停用 |
| 外部 CDP 自动连接 | `src/runtime/runtime-core-foundation.ts` 的 `ensureAutoProvider` | `providerMode: external` + `externalCdpEndpoint` 下，新 Session 首次用浏览器直接连上已开远程调试的 Chrome，无需 `browser_provider connect` |
| 导航图标补丁 | `src/client/settings-nav-icon.ts` | 设置弹窗左侧「浏览器」行的齿轮被替换为浏览器窗口图标；关闭弹窗后 `data-dsh-browser-nav-icon` 与注入的 `<style>` 均被清理 |
| RPC 面变更 | `src/compat/rpc-dispatcher.ts` | `controller_overview` 与 `controller_set_browser_choice` 可调用；`controller_set_registration_mode` 已不存在（调用返回未知端点） |

> 本轮的界面验收以桌面 Profile 上的实际操作为准，证据为 `assets/browser-workbench-{entry,panel,settings,settings-existing}.png`；没有留下实测证据的链路（真实外部 CDP 自动连接、写回失败分支、多 Session 切换）一律列入 16.4，不计为已证明。

### 16.3 受影响的历史结论（标注作废，不删除原始记录）

| 历史位置 | 原结论 | 现状 |
| --- | --- | --- |
| 14.2 七层矩阵「真实 UI 面板层」 | `verify:panel` 33/33，覆盖「控制器菜单激活 → 面板 9 视图」 | **作废**：`scripts/verify/e2e-panel.mjs` 仍按旧 composer 菜单与九视图断言，当前必然失败，**待重写**，不计为通过 |
| 14.2「实例层」 | `verify:instance` 10/10，含 composer 槽位与绑定控件 | 部分作废：composer 槽位不再注册，相关断言需重写后重测 |
| 14.4 缺陷 #1（composer 槽位崩溃） | 通过固定 `usePanelSync` 回调修复 | 结论不再适用：`usePanelSync` 已删除，composer 控件整体移除 |
| 14.4 缺陷 #4（Provider 端点输入框缺可访问名） | 给 `ProviderView` 输入框加 `aria-label="远程调试地址"` | 组件已删除；现由设置页 `existing` 卡片的「浏览器调试端点」输入框承接 |
| 14.5「沙箱…面板 9 个视图…全部走通」 | 9 视图与 Provider 连接在真实 UI 通过 | **作废**：面板只剩实况，Provider 入口搬到设置页 |
| 14.5「托管启动不在工具面暴露」 | Provider 只接受 `external-cdp` | 部分作废：`providerMode: auto` 会托管启动会话浏览器；`external` 仍只走外部 CDP |
| 14.6 复现命令 | `verify:panel` / `verify:rpc` 计入面板与 RPC 层 | 两者**待重写**；重写完成前以 16.1 静态门禁与本轮手测为准 |
| 15.1「`config.ts` 共 21 个配置项」 | 21 项 | 现为 **22** 项：新增 `externalCdpEndpoint`；`toolRegistrationMode` 枚举增加 `disabled` |
| 15.2「控制器菜单『确认选择』认领 BrowserWorkbench」 | 16/16 覆盖认领与跨刷新持久化 | 认领入口已删除（`session-select` 不再由 UI 提供），**待重写**为设置页三态绑定用例 |

### 16.4 尚未证明 / 待重写

- `scripts/verify/e2e-panel.mjs`、`scripts/verify/e2e-rpc.mjs` **待重写**：两者仍断言旧 composer 菜单与九视图路由，当前跑不通；在重写并实测通过前，本报告不主张任何面板层或 RPC 成功路径的自动化结论。
- 设置页写回的三条失败分支（无 `configEditor` 服务、`browser-tools` 条目缺失、条目被 home patch 覆盖）目前只有单测与手改场景覆盖，缺 e2e。
- 导航图标补丁依赖宿主 DOM 结构（`[role="dialog"] nav button` + label 文本），宿主设置页改版后需复验。
- 外部 CDP 自动连接的真实链路（含失败时的 `PROVIDER_UNAVAILABLE` 文案）需要在带远程调试端口的真实 Chrome 上手工复验。
- `disabled` 到恢复绑定的完整往返只做了单 Session 手测，未覆盖多 Session 并发切换。

### 16.5 复现

```powershell
npm run typecheck
npm test          # 178 / 178
npm run build     # lib/client.js + lib/index.mjs

# 面板 / 设置页验收（桌面 Profile，手工）
# 在浏览器里打开 DSH Web，然后：
# 1. 右侧栏「开始」→「浏览器实况」→ 面板只显示实况视图
# 2. 设置 →「浏览器」→ 切换 workbench / existing / off，existing 需填端点

# 以下两项在重写完成前不计入通过
# npm run verify:panel
# npm run verify:rpc
```
