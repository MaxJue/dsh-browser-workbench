# DSH BrowserWorkbench 技术细节

[English Version](./TECHNICAL.en.md) | 简体中文

版本 `1.0.0-rc8` 面向 DSH `0.2.1-rc.2` / `0.2.1-rc.3`（peer 范围 `^0.2.1-rc.2 || ^0.2.1-rc.3`），使用 Cordis `~4.0.5` 和 Schemastery `~3.18.5`。

本文说明 BrowserWorkbench 的配置项、工具注册模式、浏览器状态模型、安全边界、内部标识、29 个 Agent 工具、实况面板与设置页绑定规范。安装和功能概览见 [README](./README.md)，测试依据见 [测试报告](./VALIDATION.md)。

## 配置

完整配置示例（`cordis.patch.yml` 或 Profile 配置文件）：

```yaml
- id: browser-tools
  config:
    toolRegistrationMode: global
    providerMode: auto
    # 设置页「连接现有 Chrome / Edge」写回的调试端点；providerMode: external 时自动连接
    externalCdpEndpoint: http://127.0.0.1:9222
    externalCdpTimeoutMs: 15000
    interceptionTimeoutMs: 15000
    allowLoopback: true
    allowPrivateNetwork: true
    allowedOrigins: []
    uploadRoots: []
    artifactRoot: ~/.dsh/browser-tools
    maxUploadBytes: 26214400
    maxDownloadBytes: 104857600
    maxArtifactBytes: 268435456
    maxOutputChars: 12000
    subagentInteractive: false
    sessionController:
      conflictingToolPatterns:
        - '^browser_'
        - '^chrome_'
        - '^pilot_'
        - '^mcp__playwright__'
        - '^mcp__chrome_devtools__'
      includeTools: []
      excludeTools: []
    # 自动启动的会话浏览器使用以下配置；providerMode: external 时只在受保护方法中生效：
    headless: true
    proxy:
      mode: system
      server: ''
      bypass: ''
      username: ''
      password: ''
    chromiumDownloadSource: auto
    chromiumDownloadTimeoutMs: 300000
```

### 运行时配置项（顶层 22 项，`sessionController` 展开为 3 行）

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `toolRegistrationMode` | `global` | 注册模式：`global`（一次注册，所有 Session 直接可用；检测到既有 `browser_*` 工具时自动降级）、`session-select`（按 Session 首次选择并锁定）或 `disabled`（不注册任何工具，浏览器面板不可用） |
| `providerMode` | `auto` | `auto`：Session 首次调用浏览器工具时自动启动该 Session 专属的持久化 Chromium；`external`：不自动启动，改为在 Session 首次需要浏览器时自动连接 `externalCdpEndpoint` |
| `externalCdpEndpoint` | `''` | 外部 Chrome/Edge 的 CDP 调试端点（如 `http://127.0.0.1:9222`），由设置页「连接现有 Chrome / Edge」写回；`providerMode: external` 时用于自动连接，留空则等待显式 `browser_provider connect` |
| `sessionController.conflictingToolPatterns` | `['^browser_', '^chrome_', '^pilot_', '^mcp__playwright__', '^mcp__chrome_devtools__']` | 用于识别并仲裁冲突第三方浏览器工具的正则模式列表 |
| `sessionController.includeTools` | `[]` | 额外显式纳入浏览器工具仲裁范围的工具名称 |
| `sessionController.excludeTools` | `[]` | 显式排除在浏览器工具仲裁范围之外的工具名称 |
| `externalCdpTimeoutMs` | `15000` | 连接外部 Chrome/Edge CDP 调试端口的超时时间（毫秒，下限 1000） |
| `interceptionTimeoutMs` | `15000` | 请求暂停拦截超时时间（毫秒，下限 1000），超时自动放行请求，防页面悬挂 |
| `subagentInteractive` | `false` | 是否允许委派 Subagent 调用交互写操作类工具（如 navigate、click、type 等） |
| `allowedOrigins` | `[]` | 导航白名单 Origin 数组；非空时仅允许访问列出的 Origin |
| `allowLoopback` | `true` | 是否允许导航到 Loopback 回环地址（`127.0.0.1`、`localhost` 等） |
| `allowPrivateNetwork` | `true` | 是否允许导航到 RFC 1918 私有内网 IPv4 地址 |
| `uploadRoots` | `[process.cwd()]` | `browser_upload_file` 允许读取的绝对路径根目录白名单，防止路径穿越 |
| `artifactRoot` | `$DSH_HOME/browser-tools` | Trace、Heap Snapshot、CPU Profile 等制品的磁盘持久化根目录 |
| `maxUploadBytes` | `26214400` (25MB) | 单个上传文件字节数上限 |
| `maxDownloadBytes` | `104857600` (100MB) | 单个下载文件字节数上限 |
| `maxArtifactBytes` | `268435456` (256MB) | 读取单项制品的字节数上限，超限返回 `ARTIFACT_TOO_LARGE` |
| `maxOutputChars` | `12000` | 工具返回文本输出的最大字符数保护截断（下限 1000） |
| `executablePath` | `undefined` | 自动启动时使用的本地 Chromium 可执行文件路径；缺省时依次查找系统 Chrome/Edge，找不到再下载 Playwright Chromium |
| `headless` | `true` | 自动启动是否无头运行 |
| `proxy` | `mode: 'system'` | 自动启动的代理：`system`、`direct`（`--no-proxy-server`）、`custom`（支持 HTTP/HTTPS/SOCKS4/SOCKS5，账号密码分立） |
| `chromiumDownloadSource` | `'auto'` | 托管 Chromium 下载源镜像：`'auto'`、`'npmmirror'`、`'official'`（系统缺少 Chrome/Edge 时使用） |
| `chromiumDownloadTimeoutMs` | `300000` (5分钟) | 托管 Chromium 归档下载超时（毫秒，下限 1000） |
| `sharedProfileSeedSessionId` | `undefined` | 托管共享 Profile 模式的初始种子 Session ID（共享模式工具面不暴露） |

> [!NOTE]
> `providerMode: auto` 时，`executablePath`、`headless`、代理与 Chromium 下载都用于自动启动的会话浏览器；`npm run verify:managed` 仍直接验证受保护方法。系统没有可用 Chrome/Edge 时会下载 Playwright Chromium，因此「不会启动或下载浏览器」不再是默认行为。

## 工具注册模式

BrowserWorkbench 支持三种工具注册模式，默认用 `global`：新 Session 无需再选择一次，工具与浏览器都直接可用。设置页的三态绑定与注册模式一一对应，用户不需要手改配置即可切换。

| 配置 | 设置页选择 | 注册行为 | 浏览器来源 |
| --- | --- | --- | --- |
| `global` + `providerMode: auto` | DSH BrowserWorkbench | 注册 29 个 `browser_*` 工具 | 自动启动会话专属 Chromium |
| `global` + `providerMode: external` | 连接现有 Chrome / Edge | 注册 29 个 `browser_*` 工具 | 自动连接 `externalCdpEndpoint` |
| `session-select` | 设置页不提供（仅保留实现与测试） | 按 Session 首次选择后注册 | 依选择而定 |
| `disabled` | 停用本插件 | 不注册任何工具 | 不分配，面板统一返回停用错误 |

> [!NOTE]
> 设置页只写全局一份绑定，不支持按 Session 绑定；`session-select` 仍可手改配置启用，但设置页不提供该选项。

### 1. 全局注册模式 (`global`, 默认)

```yaml
- id: browser-tools
  config:
    toolRegistrationMode: global
```

在 Profile 层全局注册 29 个 `browser_*` 工具。若启动时发现已有其他插件注册了 `browser_*` 工具，BrowserWorkbench 会自动降级到 `session-select`，避免因 Cordis 名称冲突而阻断 DSH 启动。

### 2. 按 Session 仲裁模式 (`session-select`, 可选)

```yaml
- id: browser-tools
  config:
    toolRegistrationMode: session-select
```

`session-select` 的行为与状态模型：

- **未选择前隐藏**：新建正式 Session 时，浏览器工具暂时不向 Agent 暴露，等待显式选择。设置页只写全局绑定、不提供按 Session 选择，该模式的入口是 RPC（`controller_activate` / `controller_select_other`）与 Profile 手改。
- **用户自决选择**：可经 `controller_activate` 选择 DSH BrowserWorkbench，或经 `controller_select_other` 选择当前 Profile 中已有的第三方浏览器工具。
- **独占锁定**：选择 BrowserWorkbench 后，当前 Agent Scope 独占注册本插件的 29 个工具；同名第三方工具被遮蔽，独有第三方工具被隐藏。选择第三方工具后，BrowserWorkbench 不注册工具且不分配页面资源。
- **跨重启持久化**：选择结果以 schema v2 写入 Session 对应的持久记录（`$DSH_HOME/browser-tools/controller/sessions/`）。DSH 重启或 Agent Scope 替换后自动恢复原选择。
- **单向锁定防混淆**：同一个 Session 内严禁中途更换浏览器插件，防止 Agent 跨插件混淆 DOM 引用与会话状态。更换需求通过新建 Session 满足。
- **释放不解绑**：调用 `controller_release` 释放 BrowserWorkbench 资源仅断开连接并清空页面，不解除 Session 的锁定状态。后续再调用工具只需重新连接 Provider。释放成功时快照带 `releasedAt`（毫秒时间戳），供客户端即时回执；该字段在 BrowserWorkbench 工具再次执行或重新激活时清除。运行时已无该 Session 资源时 `controller_release` 返回错误而不是伪成功。
- **兄弟 Session 隔离**：各个 Session 独立进行工具选择，彼此互不干扰。
- **第三方插件免扰**：BrowserWorkbench 绝不停止、卸载或重配其他插件，不干涉其进程或网络。

### 3. 停用模式 (`disabled`)

```yaml
- id: browser-tools
  config:
    toolRegistrationMode: disabled
```

完全不注册 `browser_*` 工具，也不分配任何浏览器资源，用于把浏览器能力让给其他插件（设置页「停用本插件」写回的就是这个模式）。

- **Agent 侧无工具**：`browser_*` 不出现在工具面，Session 无法调用。
- **面板不可用**：面板与所有 Session 级 RPC 端点统一返回「当前已停用 DSH BrowserWorkbench，浏览器面板不可用」。
- **状态可查**：`controller_status` 返回 `registrationMode: 'disabled'`、`mode: 'unselected'`、`blockers: ['browser-tools-disabled']`；`controller_overview` 仍可读取当前绑定。
- **可恢复**：在设置页重新选择任一绑定即可写回配置并热重载。

Controller RPC 路由端点（挂载于 Connection 认证路由 `/api/browser-tools`）：

| 端点 | Session 级 | 说明 |
| --- | --- | --- |
| `controller_overview` | 否 | 设置页数据源：`registrationMode`、`configuredMode`、`configurable`、`configurableMessage?`、`providerMode`、`choice`、`endpoint?`，以及 `sessions`（`[{ sessionId, createdAt?, snapshot }]`，由 `BrowserController.list()` 汇总） |
| `controller_set_browser_choice` | 否 | 写回全局绑定：`{ choice: 'workbench' \| 'existing' \| 'off', endpoint? }`；`existing` 必须带合法端点，否则返回「连接现有 Chrome/Edge 需要填写调试端点，例如 http://127.0.0.1:9222」 |
| `controller_status` | 是 | 返回当前注册模式与仲裁快照；`disabled` 时返回 `registrationMode: 'disabled'`、`mode: 'unselected'`、`blockers: ['browser-tools-disabled']` |
| `controller_activate` | 是 | `session-select` 下选择 BrowserWorkbench |
| `controller_select_other` | 是 | `session-select` 下选择第三方浏览器工具 |
| `controller_release` | 是 | 释放运行时资源，不修改代际或解除工具绑定 |

`controller_activate` 与 `controller_select_other` 仅在 `unselected` 状态允许调用；`disabled` 下它们统一返回「当前已把浏览器能力交给其他插件，DSH BrowserWorkbench 未注册任何工具」。`controller_release` 释放运行时资源但不修改代际或解除工具绑定。原先的 `controller_set_registration_mode` 已删除：注册模式不再由独立端点直接改写，而是随 `controller_set_browser_choice` 走配置写回间接生效。

## 浏览器状态模型

- **默认状态**：新 Session 初始处于 `disconnected`，不会立刻启动浏览器。
- **自动启动**：`providerMode: auto`（默认）时，Session 第一次调用浏览器工具（或面板点击「+」新标签页）会启动该 Session 专属的持久化 Chromium；之后的调用复用同一实例。`providerMode: external` 时不启动新浏览器，改为自动连接设置页写回的 `externalCdpEndpoint`（见「外部 CDP 自动连接」）。
- **会话隔离**：每个 Session 使用独立的 user-data-dir（`$DSH_HOME/browser-tools/profiles/sessions/<session>/default`），页面、Cookie、登录态与进程互不共享，互不干扰。同一项目的多个 Session 也各自独立。
- **可选的外部连接**：在设置页「连接现有 Chrome / Edge」填入远程调试地址（如 `http://127.0.0.1:9222`）后，所有 Session 在首次需要浏览器时自动连接用户已开的 Chrome/Edge；也可用 `browser_provider connect` 显式连接。`providerMode: external` 时只允许这条路径。
- **跨 Session 共享状态**（仅 `external-cdp` 连接到同一个浏览器时）：Cookie、LocalStorage、SessionStorage、IndexedDB、Cache Storage、HTTP 缓存、Service Worker 和权限由用户的浏览器原生承载，各 Session 共享同一个浏览器实例的状态。
- **Session 级独立隔离**：
  - 页面、视图、标签、Popup 窗口
  - Debugger 会话、断点与单步控制
  - Network 请求暂停与拦截规则
  - ARIA Ref 映射、Snapshot 差异帧、Screencast 流与 Viewport 代际
  - 诊断 Checkpoint、Flight Recorder 飞行记录与 Artifact 制品
  - 双页分屏（Split View）状态
- **安全断开**：调用 `browser_provider disconnect` 或面板断开连接仅断开 CDP 传输协议，绝不强退或关闭用户浏览器。

## 安全边界

- **协议限制**：仅允许 HTTP 和 HTTPS 导航，严格拒绝 URL 内嵌用户名或密码。
- **路由认证**：Host RPC 走 Connection 已认证的 `/api/browser-tools` 精确路由，非 JSON 或非法信封一律 `400`，未认证请求一律 `401`。
- **文件安全**：上传路径严格限制在 `uploadRoots` 白名单内，严禁路径穿越；下载与制品保存限制在 `artifactRoot` 内。
- **有界脱敏**：Debugger 变量作用域、Console 输出、Network 报文与诊断时间线自动对 Token、密码、Authorization、Cookie 进行有界脱敏。
- **高危操作审批**：`browser_evaluate` 无论在隔离世界还是主世界，均视为敏感操作并触发审批；`subagentInteractive=false` 时严禁委派子会话执行导航、点击、输入等写操作。
- **人机挑战安全**：遇 CAPTCHA、短信/邮件验证码、Passkey/WebAuthn 等人机交互挑战时，严禁自动化绕过，必须暂停操作并提示用户在独立浏览器中处理。
- **视口代际防乱**：自适应实况利用 Host 初始化状态、串行尺寸上报与测量代际校验，丢弃过期尺寸输入，防止工具调用短暂尺寸覆盖稳定视口。

## 内部标识

保留以下稳定内部标识，保证与历史 Session、持久记录、数据目录及前端状态兼容：

```text
Controller mode/id: dsh-browser-tools
RPC 端点: /api/browser-tools
数据持久化目录: $DSH_HOME/browser-tools
LocalStorage 前缀: dsh-browser-tools.*
Cordis 插件 id: browser-tools
```

## 29 个 Agent 工具

### 1. 导航与页面操作（14 个）

| 工具名 | 核心参数 | 描述 |
| --- | --- | --- |
| `browser_tabs` | `action`: list/new/select/close, `viewId`, `index`, `url` | 标签页管理 |
| `browser_navigate` | `url`, `viewId`, `timeoutMs` | 页面完整 HTTP/HTTPS 导航 |
| `browser_navigate_back` | `viewId`, `timeoutMs` | 页面历史后退（带 bfcache 快速自愈） |
| `browser_snapshot` | `viewId`, `includeDiff`, `maxNodes` | 读取 ARIA 结构树、刷新元素 refs、增量差异 |
| `browser_click` | `ref`, `viewId`, `timeoutMs` | 点击 snapshot/query 获取的元素 ref |
| `browser_hover` | `ref`, `viewId`, `timeoutMs` | 悬停至元素 ref |
| `browser_scroll` | `ref`, `direction`, `amount`, `deltaX`, `deltaY` | 滚动指定元素或整个页面 |
| `browser_type` | `ref`, `text`, `clear`, `submit`, `slowly` | 向可输入元素输入文本 |
| `browser_press_key` | `key`, `ref`, `viewId` | 派发键盘单键或组合键按键 |
| `browser_select_option` | `ref`, `values` | 下拉框选中指定选项 |
| `browser_wait_for` | `text`, `textGone`, `state`, `time`, `timeMs` | 等待文本、DOM 状态或超时 |
| `browser_get_attribute` | `ref`, `name` | 读取元素单个属性值 |
| `browser_query` | `selector`, `field`: count/text/visible/attribute/refs | 纯 CSS 选择器查询（不执行未受信任 JS） |
| `browser_handle_dialog` | `accept`, `promptText` | 处理 alert/confirm/prompt 弹窗 |

### 2. 观察、文件与网络（6 个）

| 工具名 | 核心参数 | 描述 |
| --- | --- | --- |
| `browser_take_screenshot` | `viewId`, `fullPage` | 页面截屏并存入 DSH 附件系统 |
| `browser_console_messages` | `viewId`, `clear` | 查看当前页面的有界 Console 消息与报错 |
| `browser_network_requests` | `viewId`, `clear` | 读取有界且 URL 已脱敏的网络请求日志 |
| `browser_upload_file` | `ref`, `filePath` | 安全上传白名单根目录下的本地文件 |
| `browser_download` | `ref`, `timeoutMs` | 触发下载并存入插件受管制品目录 |
| `browser_network_control` | `action`: enable/disable/list_paused/continue/abort/fulfill/body/replay | Fetch 拦截、修改响应、重放与自动放行 |

### 3. 调试与运行环境（6 个）

| 工具名 | 核心参数 | 描述 |
| --- | --- | --- |
| `browser_debugger` | `action`: attach/detach/pause/resume/step_over/step_into/step_out/call_frames/scripts/script_source/source_map/scope_variables/set_breakpoint/remove_breakpoint` | CDP Debugger 断点调试与 Source Map 还原 |
| `browser_diagnose` | `action`: start/status/inspect/checkpoint/compare/report/stop/recorder_*` | 诊断会话、现场 Checkpoint、四路信号 Compare、Incident 报告与飞行记录 |
| `browser_profile` | `action`: trace_start/trace_stop/playwright_trace_start/cpu_start/coverage_start/heap_snapshot/heap_sampling_start/artifacts/artifact_read` | 性能 Trace、CPU Profile、Coverage 及 Heap 快照 |
| `browser_emulate` | `action`: viewport/device/locale/timezone/network/cpu/offline/permissions/reset` | 视口、设备、时区、网络节流、CPU 限速及权限模拟 |
| `browser_evaluate` | `action`: isolated/main_world/paused_frame, `expression`, `awaitPromise` | 在隔离世界、主页面或暂停调用栈中安全求值 |
| `browser_provider` | `action`: list/connect/disconnect/capabilities, `provider`: managed/external-cdp, `endpoint` | `managed` 启动本 Session 专属浏览器；`external-cdp` 连接现有 Chrome/Edge 调试端口 |

### 4. 工作台与展示（3 个）

| 工具名 | 核心参数 | 描述 |
| --- | --- | --- |
| `browser_live_view` | `action`: status/standard/adaptive | 查询或切换实况显示模式（标准 1280x720 或面板自适应重排） |
| `browser_split_view` | `action`: status/open/close/swap/assign/focus/ratio/orientation | 上下/左右双页分屏控制与比例调节 |
| `browser_extensions` | `action`: list | 扩展注册表只读查询端点 |

## 实况面板

客户端面板已瘦身为单视图：`src/client/components/panel/BrowserPanel.tsx` 只渲染三段——`TabBar`（标签页）、`NavigationBar`（地址栏与后退/前进/刷新）、`LiveView`（实况画面、双页分屏、拖拽分享、关闭面板）。面板激活时固定调用 `controller.update(sessionId, tab.id, 'live')`，不再有视图路由。

- **实况画面**：Screencast 实时推流，`browser_live_view` 的 `standard`/`adaptive` 两种显示模式不变。
- **双页分屏**：`browser_split_view` 的 open/close/swap/assign/focus/ratio/orientation 语义不变。
- **诊断与性能**：面板内的「打开诊断」按钮与 Recorder（Rolling/Deep/stop/mark）控件已移除，`browser_diagnose`、`browser_profile` 的 Agent 工具能力完全不变；面板侧只保留 `views/live/DiagnosticOverlay.tsx`（由 `LivePane` 使用）做现场提示。
- **面板托管**：标签栏与右侧标签页生命周期仍由 DSH 官方 Tab 机制托管，关闭、切换与多 Pane 行为按 Session 严格隔离。

### 1. 面板入口

`sidebarRightTabs` 注册面板时附带 `guide` 卡片，右侧栏「开始」页会显示「浏览器实况」入口：

| 字段 | 值 |
| --- | --- |
| `id` / 面板 id | `live` / `dsh-browser-workbench/browser` |
| `order` | `20` |
| `title` | 「浏览器实况」 |
| `description` | 「查看并接管 Agent 正在操作的浏览器」 |
| `icon` | `BrowserGlyph`（`src/client/components/common/BrowserGlyph.tsx`） |

`conversation.input.right` 不再注册：composer 旁没有绑定控件，也没有 `useAutoReveal` 的自动弹出面板。绑定选择在设置页完成，实况查看从右侧栏进入。

### 2. 设置页绑定分区

`src/client/index.tsx` 通过 `ctx.effect` 注册 `settings.section`：`id: 'browser'`、`order: 60`、label「浏览器」，组件为 `src/client/components/settings/BrowserSettingsSection.tsx`。该组件全部使用内联样式——宿主的设置页作用域下 CSS Module 不生效。

- **三张绑定卡片**（radiogroup「浏览器工具绑定」）：`workbench`「DSH BrowserWorkbench」（自动启动独立 Chromium，按会话隔离）、`existing`「连接现有 Chrome / Edge」（不启动新浏览器，沿用登录态与扩展，展开调试端点输入，默认 `http://127.0.0.1:9222`，附 Windows/macOS 启动命令与 `/json/version` 校验提示）、`off`「停用本插件」。
- **状态与降级**：展示 `controller_overview` 的当前生效绑定与浏览器会话列表；不可写时提示手改 `~/.dsh/profiles/<profile>/cordis.patch.yml` 中 `- id: browser-tools` 的配置；运行时实际生效值与配置不一致时提示「可能被其他浏览器插件抢占」。
- **即时生效**：切换后立即写回配置并触发热重载，面板在重载后刷新。

### 3. 导航图标补丁

宿主 `settings.section` 的注册参数不含 icon，左侧导航行图标由宿主的 `navIcon(id)` 写死为齿轮。`src/client/settings-nav-icon.ts` 用 `MutationObserver` 监听设置弹窗，按 label 文本认领「浏览器」行并打上 `data-dsh-browser-nav-icon` 标记，再以 `::before` + mask SVG 把齿轮换成浏览器窗口图形。该做法参考社区插件 dshmarket 的同款补丁，随 `ctx.effect` 一起 dispose。

## 绑定写回链路

设置页的三态选择不直接改运行时对象，而是经宿主的配置编辑器写回 Profile 补丁：

| 选择 (`BrowserToolChoice`) | 写回的 Profile 补丁 |
| --- | --- |
| `workbench` | `toolRegistrationMode: global`、`providerMode: auto` |
| `existing` | `toolRegistrationMode: global`、`providerMode: external`、`externalCdpEndpoint: <端点>` |
| `off` | `toolRegistrationMode: disabled` |

`src/compat/config-editor.ts` 的链路：`ctx.get('configEditor')` 取宿主 `@deepseek-ai/dsh-config-editor` 服务 → `entries()` 找到 `id: 'browser-tools'` 的条目 → `edit(entry, current => ({ ...current, ...browserChoicePatch(choice, endpoint) }))` 写入 `~/.dsh/profiles/<profile>/cordis.patch.yml` → 宿主触发 Cordis 热重载。`browserChoiceOf()` 从条目反读当前三态，`browserSettingsWriteState()` 给出是否可写。

写回失败的三种情形（无配置编辑服务、条目不存在、条目被 home patch 覆盖）都返回可读文案而不静默失败，例如「当前 DSH 未提供配置编辑服务，浏览器绑定只能手改 Profile 补丁。」与「Profile 补丁里没有 id 为 browser-tools 的配置条目，绑定无法写回。」导出：`BROWSER_ENTRY_ID`、`browserChoicePatch`、`browserChoiceOf`、`browserSettingsWriteState`、`writeBrowserChoice`。

## 外部 CDP 自动连接

`providerMode: external` 且配置了 `externalCdpEndpoint` 时，Session 首次需要浏览器会直接连该端点，不必先调 `browser_provider connect`：

1. `RuntimeCoreFoundation.ensureAutoProvider()` 先判断 `session.providerBinding.kind === 'disconnected'`，已在连接中或已连接则直接返回。
2. `providerMode === 'external'` 且 `externalCdpEndpoint` 非空时，`assertCdpEndpoint()` 校验端点后调用 `connectExternalCdp(endpoint, externalCdpTimeoutMs, …)`。
3. 连接成功写入 `session.providerBinding = { kind: 'external-cdp', ...connection, endpoint }`，后续工具调用复用这条绑定。
4. 连接失败抛 `PROVIDER_UNAVAILABLE`：「连接已开启远程调试的浏览器失败（`<endpoint>`）：…。请确认浏览器以 `--remote-debugging-port` 启动。」

端点为空时不自动连接，退回显式 `browser_provider connect`。安全断开语义不变：断开只关闭 CDP 传输，绝不强退用户浏览器。

## 已删除的客户端模块

本轮面板瘦身删除的模块，文档与代码中都不再有对应入口：

| 已删除 | 原用途 |
| --- | --- |
| `src/client/components/views/{console,debugger,diagnostic,emulation,extensions,network,performance,provider}/` | 除实况外的 8 个视图组件目录 |
| `src/client/components/control/{BrowserControl,ControllerMenu,ArbitratedToolsDialog}.tsx` | composer 绑定控件、控制器菜单与仲裁工具对话框 |
| `src/client/hooks/{useAutoReveal,useControllerBinding,usePanelSync}.ts` | 自动弹出面板、绑定状态订阅、面板同步 |
| `controller_set_registration_mode`（RPC 端点） | 旧的注册模式写入口，改由 `controller_set_browser_choice` 经配置写回间接生效 |

`src/client/components/views/live/` 下的 `LiveView.tsx`、`LivePane.tsx`、`LiveControls.tsx`、`DiagnosticOverlay.tsx` 保留。
