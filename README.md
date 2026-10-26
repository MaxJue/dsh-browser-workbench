<div align="center">

# DSH BrowserWorkbench

### 把可操作的 Chromium 调试工作台交给 DSH Agent

不只看页面。能点击、能断点、能抓请求、能读 Source Map，还能把现场证据留下。

![License](https://img.shields.io/badge/license-MIT-2563EB?style=for-the-badge)
![DSH](https://img.shields.io/badge/DSH-0.2.1--rc.2%20%7C%200.2.1--rc.3-7C3AED?style=for-the-badge)
![Node](https://img.shields.io/badge/Node-%5E22.19.0%20%7C%7C%20%3E%3D24.0.0-16A34A?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Tests](https://img.shields.io/badge/tests-171%20passing-22C55E?style=for-the-badge)
![Status](https://img.shields.io/badge/status-1.0.0--rc8%20%C2%B7%20not%20on%20npm-F97316?style=for-the-badge)

[源码安装](#安装) · [看图了解](#能力展示) · [29 个工具](#功能介绍) · [验证结果](#验证结果) · [技术细节](./TECHNICAL.md) <br> <br>
当前语言为简体中文 | [English](./README.en.md)

</div>

---

> [!IMPORTANT]
> 这是独立开发的社区插件，不是 DeepSeek 官方发布、维护或背书的插件。它不会修改 DeepSeek Harness 的核心代码。<br>
> 当前版本 `1.0.0-rc8`，**尚未发布到 npm**（见 [PUBLISHING.md](./PUBLISHING.md)），请按下面的[源码安装](#安装)流程使用。<br>
> 项目仍在开发中，遇到 bug 或任何意料外的情况都可以通过 issue 反馈。
>
>> *如果该插件帮上你的忙了，还请点颗星让更多人看见~非常感谢 Thanks♪(･ω･)ﾉ*

## 当前状态

| 项目 | 真实情况 |
| --- | --- |
| 版本 | `1.0.0-rc8`(Release Candidate) |
| 目标宿主 | DSH `0.2.1-rc.2` / `0.2.1-rc.3`（peer 声明为范围 `^0.2.1-rc.2 \|\| ^0.2.1-rc.3`），Cordis `~4.0.5`，Schemastery `~3.18.5` |
| npm 状态 | **未发布**。首次发布流程尚未执行，npm 安装方式目前不可用 |
| 仓库内容 | 源码 + 测试 + 文档；**不含** `lib/` 构建产物，也不含 `node_modules`、`.sandbox`、`.npm-cache` |
| 已实测通过 | 严格类型检查、171 个单测、正式构建、29 工具真实 Chromium 回归、独立进程 + 独立 `DSH_HOME` 的分层验证 |
| 待完成 | 面板与 RPC 两个 e2e 脚本按新 UI 重写；全新 DSH Web Profile 的安装/启动/认证/卸载人工验收；npm 首次发布 |
| 未声明兼容 | DSH `0.1.x`(RC7 及更早)、macOS / Linux 实机、任意第三方浏览器插件 |

## 插件简介

前端调试最头疼的是什么？看不到页面结构、抓不到请求细节、断点打不进去、错误只有一句话。Agent 遇到复杂网页问题时更麻烦——只能截个图、描述几句，然后陷入"刷新试试""清缓存看看"的循环。

BrowserWorkbench 在 DSH Web 右侧栏提供一个可操作的浏览器工作台，配备 29 个专门定制的自动化工具。右侧面板只保留人真正需要的东西：标签栏、地址栏（前进 / 后退 / 刷新）与真实页面实况。Console、Network、Debugger、Performance、Emulation、诊断、Provider 与扩展管理这 8 个视图已经从面板移除——这些能力本来就属于 Agent，全部由 `browser_*` 工具直接提供（`browser_console_messages`、`browser_network_requests`、`browser_debugger`、`browser_profile`、`browser_diagnose`、`browser_emulate` 等），不再做一份人肉 UI 复刻。Agent 能直接读页面结构、操作元素、查看 Console、追踪请求、下断点、读调用栈、解析 Source Map、分析性能，并把操作前后的完整现场记录下来。

**入口在右侧栏「开始」页**：注册 `sidebarRightTabs` 时带了一枚 `guide` 条目，打开右侧栏的「开始」页就能看到一张卡片——标题「浏览器实况」、描述「查看 Agent 正在操作的浏览器」，点一下就打开面板。**输入框下方不再有任何浏览器绑定控件**：原来的 `BrowserControl`、`ControllerMenu`、`ArbitratedToolsDialog` 以及自动弹出面板的行为都已删除，绑定只在设置页做。

**开箱即用，每个 Session 一个独立浏览器**：工具默认全局注册，新 Session 无需再选择或手动绑定。Agent 第一次调用浏览器工具时，插件自动为该 Session 启动一个独立的持久化 Chromium（`providerMode: auto`），页面、Cookie 与登录态互不共享，不同项目并行时互不干扰。需要连接自己已开启远程调试的 Chrome 或 Edge 时，首选 **设置 → 浏览器 → 连接现有 Chrome / Edge**：填好调试端点后点「连接」，之后 Session 首次调用浏览器工具会自动连上该端点。`browser_provider` 仍然可用，适合在会话里临时 connect / disconnect。

![BrowserWorkbench 在 DSH Web 中的实况工作台：左侧对话，右侧标签栏、地址栏与页面画面](./assets/browser-workbench-panel.png)

## 目录

- [当前状态](#当前状态)
- [能力展示](#能力展示)
- [安装](#安装)
- [功能介绍](#功能介绍)
- [目录结构](#目录结构)
- [开发与验证](#开发与验证)
- [已知边界](#已知边界)
- [兼容范围](#兼容范围)
- [使用反馈](#使用反馈)
- [License](#license)

## 能力展示

### 怎么打开面板

右侧栏切到「开始」页，第二张卡片就是「浏览器实况」，描述为「查看 Agent 正在操作的浏览器」。点一下卡片就打开面板，它和 Agent 共用同一套浏览器工具，不需要再选绑定。

![右侧栏「开始」页的「浏览器实况」卡片](./assets/browser-workbench-entry.png)

### 一个窗口，完整调试链路

Agent 对话、真实页面、标签栏与地址栏都在 DSH 右侧栏的同一个窗口里。面板刻意做薄：它只负责让你看见 Agent 正在操作的那个页面。调试结论、报错原文、请求列表、调用栈这些内容回到对话里呈现——它们由工具调用产生，不占面板空间。

**典型排查场景**：页面布局突然错乱。Agent 调用 `browser_snapshot` 获取页面 ARIA 结构树与元素引用，结合 `browser_get_attribute` 或 `browser_diagnose inspect` 审查样式与容器属性，发现某个容器被异步脚本隐藏。接着用 `browser_debugger` 在相关脚本里下断点，配合 Source Map 找到原始代码位置，再用 `browser_console_messages` 与 `browser_network_requests` 交叉验证，最终定位到一个状态更新时序问题。整个过程中你都能在右侧实况里盯着同一个页面。

### 双页实况，同时盯梢

面板支持上下或左右并排两个真实页面，独立画面、独立焦点，由 `browser_split_view` 驱动：做响应式检查时上下排列，跨页面对比时左右排列。双页共用同一个面板外壳，画面与地址栏都按各自的页面走。

### 绑定在设置页，全局一份

「设置 → 浏览器」决定浏览器工具归谁，一次点击即写入 Profile 补丁并热重载：

![设置页的「浏览器」分区，默认选中 DSH BrowserWorkbench](./assets/browser-workbench-settings.png)

- **DSH BrowserWorkbench**（默认，`choice: workbench`）：为本插件自动启动独立的 Chromium，所有 Session 与子代理共用这套 29 个 `browser_*` 工具，页面、Cookie 与登录态按会话隔离。
- **连接现有 Chrome / Edge**（`choice: existing`）：不启动新浏览器，直接连你平时用的那个窗口，沿用它的登录态、Cookie 与扩展。展开后填调试端点（默认 `http://127.0.0.1:9222`）再点「连接」，配置里写入 `providerMode: external` 与 `externalCdpEndpoint`，之后 Session 首次调用浏览器工具会**自动连上**该端点，无需 Agent 再手动 connect。
- **停用本插件，把浏览器工具让给其他插件**（页脚次级开关，`choice: off`，即 `toolRegistrationMode: disabled`）：本插件完全不注册工具、也不创建 controller，把浏览器能力让给别的插件——这是真的退出，而不是静默失败。

![展开「连接现有 Chrome / Edge」后的端点输入框、启动命令与复制按钮](./assets/browser-workbench-settings-existing.png)

绑定是**全局一份**，不支持按会话绑定：`session-select` 仍留在实现里，但设置页不再提供，仅供测试与旧配置使用。

普通双击打开的窗口无法被附加，Chrome 136+ 还要求调试实例使用独立的用户数据目录。端点区自带 Windows cmd 与 macOS 两套启动命令，各配一个「复制」按钮，并按 UA 只显示当前系统的那一套：

```powershell
start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%TEMP%\dsh-chrome"
# 或
start "" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" --remote-debugging-port=9222 --user-data-dir="%TEMP%\dsh-edge"
```

命令直接给可执行文件的绝对路径，不先 `cd` 到安装目录，所以装在任何盘、任何目录都照原样粘贴即可；报「找不到文件」就把引号里的路径换成真实安装位置。`--user-data-dir` 也加了引号，避免用户名带空格时 `%TEMP%` 被截断。

用独立 `--user-data-dir` 是全新配置，登录态需要在那个窗口里重新登录一次；想复用日常配置就把 `--user-data-dir` 指向你的 Chrome 用户目录，但必须确认没有另一个 Chrome 实例正占用它。启动后访问 `http://127.0.0.1:9222/json/version` 能看到 JSON 才算成功；Chrome 自带的「允许远程调试」开关不提供该接口，不要用它。

设置页读不到配置编辑服务（例如部署只读、或未安装对应插件）时，切换自动降级为只读说明，并给出 `~/.dsh/profiles/desktop/cordis.patch.yml` 里 `- id: browser-tools` 的手改方式。设置页读写的 RPC 是无 Session 上下文的 `controller_overview` 与 `controller_set_browser_choice`（旧的 `controller_set_registration_mode` 已删除）。

### 工具面，而不是面板

面板删掉的 8 个视图并没有让能力消失，只是全部回到工具面——它们本来就该由 Agent 调用。

- 断点、脚本列表与 Source Map 由 `browser_debugger` 提供：`script_source` 返回运行时源码，声明了 `sourceMappingURL` 的脚本还能取回 `.map`（保存为制品并返回引用，未声明的脚本会明确报 `SOURCE_MAP_NOT_DECLARED`），断点、单步、调用栈和变量作用域都在原位。
- 请求时序由 `browser_network_requests` 与 `browser_network_control` 提供：document、样式、脚本、字体、xhr 逐条带状态码；拦截规则可以随时开关，把首屏加载和后续交互分开对照，还能暂停、改响应、重发。专治状态覆盖、响应迟到这类时序 Bug。
- 现场取证由 `browser_diagnose` 提供：Debug Session 把页面身份、操作时间线、Context Topology 与 Build Identity 打包在一起；操作前后各存一个 Checkpoint，Compare 先判断两次现场是否可比（viewId、context generation、URL、viewport、DPR），再按页面溢出、元素命中与可见性、Console 事件数（全部 level）、失败请求数（`failure` 或 4xx/5xx）四路信号给出 `fixed` / `improved` / `unchanged` / `regressed` / `incomparable` / `evidence-insufficient`，缺证据的维度会明确标注而不是猜。
- 性能由 `browser_profile` 提供：Trace 看主线程阻塞，CPU Profile 找热点函数，Heap Snapshot 查对象保留；Trace 与 CPU Profile 作为制品落盘并标注大小，大文件不会撑爆 AI 的上下文。

这些能力没有对应的面板 UI，本文档也不再声称有。

## 安装

需要 Node.js `^22.19.0` 或 `>=24.0.0`，pnpm，以及一个可以正常启动的 DSH Web Profile。

### 从源码构建安装（当前唯一可靠方式）

仓库不包含 `lib/` 构建产物，所以必须先构建：

```powershell
git clone https://github.com/MaxJue/dsh-browser-workbench.git
cd dsh-browser-workbench
pnpm install --frozen-lockfile --ignore-scripts
npm run build        # 产出 lib/index.mjs、lib/index.d.mts、lib/client.js 及其 sourcemap
```

打包并装进 Profile：

```powershell
npm pack             # 生成 dsh-browser-workbench-1.0.0-rc8.tgz
dsh plugin --profile web add ./dsh-browser-workbench-1.0.0-rc8.tgz --ignore-scripts --config.auto-install-peers=false
```

也可以直接把仓库目录加进 Profile（`dsh plugin --profile web add <仓库绝对路径>`）；后续改代码只需重新 `npm run build`，不必重新安装。

> `dsh plugin --profile web add dsh-browser-workbench@1.0.0-rc8` 这种 npm 方式在你完成首次发布前会失败，因为包还没上 Registry。

在 Profile 的 `cordis.patch.yml` 中启用：

```yaml
- insert:
    - id: browser-tools
      name: dsh-browser-workbench
```

启动 Chrome 并开启远程调试（示例：`chrome.exe --remote-debugging-port=9222`），再启动 DSH Web。右侧栏切到「开始」页，点「浏览器实况」即可看到 Agent 正在操作的页面；要连上这个 Chrome，在 **设置 → 浏览器** 里选「连接现有 Chrome / Edge」再点「连接」（也可以让 Agent 调用 `browser_provider` 临时 connect / disconnect）。连接失败时只需检查 Chrome 进程、启动参数和端口。

从历史包 `dsh-browser-tools` 升级时，先移除旧包。保留 `id: browser-tools` 和 `$DSH_HOME/browser-tools`。两个包不要同时安装在同一个 Profile 中。

## 功能介绍

### 浏览与操作

| 功能 | 说明 | 工具 |
| --- | --- | --- |
| 标签管理 | 查看、创建、切换和关闭标签 | `browser_tabs` |
| 页面导航 | 打开 URL、后退（前进与刷新只存在于面板操作，不在工具面） | `browser_navigate`, `browser_navigate_back` |
| 读取页面 | 读取页面结构、元素引用与属性、选择器查询结果 | `browser_snapshot`, `browser_get_attribute`, `browser_query` |
| 操作页面 | 点击、悬停、滚动、输入文字、按键、选择下拉项和等待变化 | `browser_click`, `browser_hover`, `browser_scroll`, `browser_type`, `browser_press_key`, `browser_select_option`, `browser_wait_for` |
| 处理弹窗 | 接受或拒绝页面弹窗，并填写 Prompt | `browser_handle_dialog` |
| 执行脚本 | 在隔离世界、主世界或暂停帧中执行 JavaScript | `browser_evaluate` |
| 截图 | 保存当前页面画面 | `browser_take_screenshot` |
| 上传下载 | 上传本地文件，捕获并保存下载文件 | `browser_upload_file`, `browser_download` |

### Console 与请求

| 功能 | 说明 | 工具 |
| --- | --- | --- |
| 读取 Console | 查看日志、警告和错误，带级别与时间 | `browser_console_messages` |
| 查看请求 | 查看请求地址、方法、状态、资源类型和发生顺序 | `browser_network_requests` |
| 查看请求内容 | 读取当前暂停请求的 Body，大内容存为制品 | `browser_network_control` |
| 暂停请求 | 在请求或响应阶段拦截流量 | `browser_network_control` |
| 放行或终止 | 对被暂停的请求执行 Continue 或 Abort | `browser_network_control` |
| 模拟响应 | 返回自定义状态、Header 和 Body | `browser_network_control` |
| 重发请求 | 重放当前仍处于暂停状态的请求 | `browser_network_control` |
| 自动恢复 | 拦截超时后自动放行，避免页面卡住 | `browser_network_control` |

### 断点与源码

| 功能 | 说明 | 工具 |
| --- | --- | --- |
| 连接调试器 | 连接当前页面的 CDP Debugger | `browser_debugger` |
| 断点控制 | 设置断点、暂停、继续、单步进入、单步跳过和单步跳出 | `browser_debugger` |
| 查看调用栈 | 查看函数调用顺序、脚本位置和暂停原因 | `browser_debugger` |
| 查看变量 | 查看 Local、Closure 和 Global 中的变量 | `browser_debugger` |
| 读取脚本 | 查看页面加载的脚本和运行时源码 | `browser_debugger` |
| 获取 Source Map | 下载并保存脚本的 `.map`，同时绑定构建身份 | `browser_debugger` |
| 还原源码位置 | 在诊断报告里把带 stack 的 Console 错误映射回原始文件与行列 | `browser_diagnose` |
| 识别构建版本 | 记录脚本的 SHA-256 哈希和构建身份，避免读错版本 | `browser_diagnose` |
| 区分执行环境 | 区分主世界、隔离世界和暂停帧 | `browser_debugger`, `browser_diagnose` |

### 性能与诊断

| 功能 | 说明 | 工具 |
| --- | --- | --- |
| 记录 Trace | 记录页面主线程、网络和渲染过程 | `browser_profile` |
| 记录操作过程 | 保存页面动作、Snapshot、请求和时间线 | `browser_profile` |
| 分析 CPU | 找到耗 CPU 的函数和调用路径 | `browser_profile` |
| 统计覆盖 | 查看 JavaScript 和 CSS 使用情况 | `browser_profile` |
| 查看内存 | 保存 Heap Snapshot，调查对象保留问题 | `browser_profile` |
| 观察内存增长 | 使用 Heap Sampling 观察长任务中的分配热点 | `browser_profile` |
| 建立诊断会话 | 把页面、操作、上下文和构建信息放在一起 | `browser_diagnose` |
| 保存 Checkpoint | 记录操作前后的页面和身份状态 | `browser_diagnose` |
| 对比变化 | 比较两个 Checkpoint，标出变化和回退 | `browser_diagnose` |
| 生成 Incident | 汇总动作、Console、请求、身份和对比结果 | `browser_diagnose` |
| 记录关键事件 | 按 Off / Rolling / Deep 三档记录；超出配额时淘汰最旧的未冻结分片，并把 overload 标为 metadata-only | `browser_diagnose` |
| 保存大文件 | 把 Trace、CPU Profile、Coverage 和 Heap 存成制品并标注大小 | `browser_profile` |
| 生成 Incident 报告 | 汇总后内联返回 markdown，受输出上限截断（不落盘） | `browser_diagnose` |

### 浏览器实况

| 功能 | 说明 | 工具 |
| --- | --- | --- |
| 查看实况 | 在右侧栏持续查看当前页面 | `browser_live_view` |
| 自动调整尺寸 | 页面跟随面板尺寸变化，避免视口错乱 | `browser_live_view`, `browser_emulate` |
| 上下双页 | 同时查看两个页面 | `browser_split_view` |
| 左右双页 | 横向查看两个页面 | `browser_split_view` |

### 扩展与浏览器环境

| 功能 | 说明 | 工具 |
| --- | --- | --- |
| 扩展管理边界 | 外部 CDP 模式下 `browser_extensions` 只列出历史注册表里的扩展，不安装、不启停浏览器扩展 | `browser_extensions` |
| 连接浏览器 | 连接已用远程调试启动的 Chrome/Edge | `browser_provider` |
| 保留浏览器状态 | Cookie、缓存、权限和扩展状态由用户浏览器保留 | `browser_provider` |
| 断开连接 | 只释放 DSH 的 CDP 连接，不关闭用户浏览器 | `browser_provider` |
| 模拟设备 | 设置 Viewport、设备、地区、时区、网络、CPU 和离线状态 | `browser_emulate` |
| 模拟权限 | 控制页面权限 | `browser_emulate` |

### Session 控制

| 功能 | 说明 |
| --- | --- |
| 默认全局注册 | `toolRegistrationMode: global`（默认）：29 个工具在 Profile 层注册，新 Session 直接可用，不再需要每次选择 |
| 安全降级 | 全局模式启动时若已存在 `browser_` 前缀的工具，自动改为按 Session 选择 |
| 按 Session 选择（可选） | `session-select` 仍留在实现里，但设置页不再提供，仅供测试与旧配置使用；该模式下正式 Session 第一次使用浏览器前选择 BrowserWorkbench 或其他浏览器工具 |
| Session 锁定 | `session-select` 选择后不能在同一个 Session 中更换浏览器插件；需要更换时新建 Session |
| 按需注册 | `session-select` 下选择 BrowserWorkbench 后，只在当前 Session 注册 29 个工具 |
| 释放资源 | 断开浏览器连接并清空该 Session 的视图与调试状态，不解除锁定 |
| 重启恢复 | DSH 重启或 Agent Scope 替换后，继续恢复该 Session 已保存的选择 |
| 自动启动浏览器 | `providerMode: auto`（默认）时，Session 首次调用浏览器工具会自动启动该 Session 专属 Chromium，无需手动连接 |
| 会话隔离 | 每个 Session 使用独立 user-data-dir，页面、Cookie、登录态和浏览器进程互不共享 |
| 可选外部连接 | 仍可用 `browser_provider` 连接已开启远程调试的 Chrome/Edge；`providerMode: external` 时只允许这种连接 |
| Session 级状态隔离 | 注册、视图引用、调试状态和制品都按 Session 保存，互不覆盖 |
| 共享网站状态 | 仅当多个 Session 连接同一个外部浏览器时：Cookie、LocalStorage、IndexedDB、Cache Storage、HTTP 缓存、Service Worker 和权限由该浏览器共享 |
| 共享浏览器标签 | 仅 `external-cdp` 连接同一个 endpoint 时：多个 Session 看到同一批标签页，插件不按 Session 拆分或复制标签 |
| 隔离调试状态 | Debugger、请求拦截、Ref、Snapshot 和实况画面按 Session 分别保存 |
| 隔离文件 | Artifact 和 Controller 状态按 Session 隔离 |
| 页面来源跟踪 | 只在托管 `shared-persistent` 模式下启用：`window.open()` 页面继承 Owner，来源不明的页面会被关闭（该模式工具面不可达） |
| 恢复页面布局 | 浏览器 Context 重建后，恢复各 Session 的地址、活动标签和双页布局 |

## 目录结构

```
src/
├── application/   工具定义（29 个 browser_*）、配置 schema、安全策略、工具元数据
├── cdp/           CDP 会话与协议级事件（debugger / fetch / screencast / profile / script）
├── client/        React 19 界面：实况面板（标签栏、地址栏、实况）与设置页「浏览器」分区
├── compat/        DSH Connection/RPC 适配层、消息与 RPC 分发
├── controller/    Session 级控制器仲裁（browser-controller）
├── diagnostics/   取证：Flight Recorder、Context/Build Identity、Incident、Source Map
├── domain/        纯协议契约：types、protocol、errors、policy
├── extensions/    CRX3 解包、扩展注册表、扩展 popup
├── page/          导航、网络录制与拦截、对话框、页面诊断
├── provider/      外部 CDP 连接、托管启动配置、持久化 Profile、Artifact 存储
├── runtime/       编排层（每个文件都控制在数百行内）
├── session/       Session Key、独占任务队列、标签恢复
└── view/          Viewport、自适应重排、分屏、screencast 同步

tests/             覆盖 13 个领域（compat 暂无独立测试目录）
scripts/verify/    e2e 验证脚本与本地夹具站点
```

源码规模：`src/` 139 个文件约 1.63 万行（不计空行）；`tests/` 55 个文件、171 个用例。Architecture 约束见 [AGENTS.md](./AGENTS.md) 与 [DIRECTORY_SPECIFICATION.md](./DIRECTORY_SPECIFICATION.md)。

## 开发与验证

提交前必须通过三道静态门禁：

```powershell
npm run typecheck    # tsc --noEmit，0 错误
npm test             # 171 个单测全部通过
npm run build        # tsdown，产出 lib/index.mjs 与 lib/client.js
```

需要真实浏览器时，再按需单独跑对应层级（**不会隐式下载 Chromium**，需要自己提供已就绪的浏览器与本地夹具站点）：

```powershell
npm run verify:tools       # Runtime 层：29 个 browser_* 工具的 140 项断言（真实 Chrome + 本地夹具站点）
npm run verify:extensions  # 扩展层：MV3 本地安装、注册表落盘、启停卸载、popup 与非法输入（19 项）
npm run verify:managed     # 托管层：executablePath/headless、三种代理、HTTPS CONNECT、离线安装（16 项）
npm run verify:sandbox     # 起独立 DSH_HOME 实例，打印带 token 的地址
npm run verify:instance    # 实例层：Client bundle、认证 RPC 往返（10 项）
npm run verify:panel       # 面板层：正式 Session → 设置页绑定 → 实况（脚本仍按旧 composer 菜单与九视图断言，正在重写）
npm run verify:config      # 配置层：13 项配置的运行时真实效果
npm run verify:rpc         # RPC/持久化层：认证边界、信封契约、控制器选择跨刷新（16 项；部分断言按旧 UI，正在重写）
npm run verify:persist -- --phase=prepare   # 认领控制器并记录 marker
npm run verify:persist -- --phase=verify    # 重启 Host 后复核（需要新的 token）
```

`scripts/verify/e2e-panel.mjs` 与 `scripts/verify/e2e-rpc.mjs` 里仍有针对旧 composer 菜单与九视图的断言，两个脚本正在按新 UI 重写；重写完成前不要把这两层当作已验证。其余各层验证的完整记录、本轮修掉的 7 个真实缺陷，以及不可达路径的说明，见 [VALIDATION.md](./VALIDATION.md) 第十四、十五节。

### 验证结果

| 层级 | 入口 | 结果 |
| --- | --- | --- |
| 静态门禁 | `typecheck` / `test` / `build` | 0 错误 / 178 通过 / 构建成功 |
| Runtime | `verify:tools` | 145/145 |
| 实例 | `verify:instance` | 10/10 |
| 真实 UI 面板 | `verify:panel` | 待重写（旧九视图断言已失效） |
| 扩展 | `verify:extensions` | 19/19 |
| 托管启动 + 代理/HTTPS | `verify:managed` | 16/16 |
| 配置 | `verify:config` | 13/13 |
| RPC | `verify:rpc` | 待重写（含旧 composer 菜单断言） |
| 持久化 | `verify:persist` | prepare 7/7 + verify 5/5 |

Runtime 层使用真实 Chrome（`155.0.8059.85`）经 `external-cdp` 连接本地夹具站点。数字来自本机 `.sandbox/reports/` 里的运行报告，换环境重跑会变。事件记录（`browser_diagnose` 的 Off / Rolling / Deep 三档）的默认保留窗口是 180 秒（`retentionMs`），超出窗口的事件按淘汰策略丢弃，这是算法边界，不等同于长时间稳定性压测。

## 已知边界

这些是当前版本真实存在、且有意保留的行为，不是待修的 TODO：

- **托管启动已进入工具面**：默认 `providerMode: auto`，`browser_provider` 的 `managed` 会启动本 Session 专属的持久化 Chromium（绑定 `isolated-persistent`），`external-cdp` 继续连接现有 Chrome/Edge。`shared-persistent`（`window.open` 页面归属跟踪）仍只在内部路径使用；`isolated-managed` 只有类型声明，没有赋值点。`executablePath`、`headless`、代理与 Chromium 下载配置都对自动启动生效。
- **托管下载元数据落后**：`src/provider/chromium-manager.ts` 的 `KNOWN_ARCHIVES` 只登记了 `149.0.7827.55`，而 playwright-core 1.64.1 期望 `156.0.8078.4`，缺元数据时会 fail-closed 拒绝下载。这是刻意的完整性策略，不是 bug。
- **`browser_live_view adaptive` 依赖面板**：面板没打开时没有可用尺寸上报，返回可恢复的 `ADAPTIVE_SIZE_UNAVAILABLE`。
- **扩展工具只读**：Agent 侧 `browser_extensions` 只有 `list` 一种 action，读的是历史注册表快照，没有安装或启停工具。RPC 另有 `install`/`enable`/`disable`/`uninstall`/`apply` 与 `open_popup`/`close_popup` 端点（客户端不再提供扩展管理视图），但外部 CDP 模式下它们只改动持久化注册表（`uninstall` 额外删除解包目录），并把条目记为待重启（`loaded:false`），不会装载进用户已连接的浏览器。自动启动路径当前也不加载扩展；装扩展仍需直接操作浏览器。
- **`subagentInteractive` 默认 `false`**：委派子会话调用导航、点击、对话框等交互类工具会被拒绝。这条限制以「该工具由本插件在全局模式注册，或该 Session 的控制器已激活」为前提；默认已是全局注册，因此默认就会生效。
- **不覆盖的范围**：DRM、Native Messaging、Manifest V2、CAPTCHA/验证码、Passkey/WebAuthn、任意站点的反自动化策略，以及被调试应用自身的业务正确性。

## 兼容范围

版本 `1.0.0-rc8` 的目标宿主是 DSH `0.2.1-rc.2` / `0.2.1-rc.3`，要求 Cordis `~4.0.5`、Schemastery `~3.18.5`、Node `^22.19.0 || >=24.0.0`。更早的 `1.0.0-rc7` 及之前版本只对齐过 DSH `0.1.x`，未在 DSH `0.2.x` 上验证，`0.1.x` 时期的验证结论不适用。

已在 Windows + Node 22.x + pnpm 11.x + 真实 Chrome 上实测；macOS、Linux 与其他 Chromium 分支未做实机验证。

候选状态以外部 candidate-identity 文件和 tarball 摘要为准；本仓库的描述不能单独证明某个版本已完成 Git Tag、GitHub Release 或 npm 发布。

## 技术细节

完整配置、工具注册模式、状态模型、安全边界、内部标识和工具清单见 [TECHNICAL.md](./TECHNICAL.md)。

## 使用反馈

遇到缺陷、兼容问题或有新功能建议，请提交 [GitHub Issue](https://github.com/MaxJue/dsh-browser-workbench/issues)。带上 DSH 版本、BrowserWorkbench 版本、操作系统、Node.js 版本和同时加载的浏览器插件，可以更快定位问题。

安全漏洞请按 [安全策略](./SECURITY.md) 私密报告。不要把凭据、Cookie、会话数据或未脱敏日志放进公开 Issue。

## License

[MIT](./LICENSE)
