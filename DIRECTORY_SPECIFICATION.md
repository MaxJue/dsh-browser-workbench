# DSH BrowserWorkbench 目录规范与架构准则

> **版本**: 1.1.0  
> **适用范围**: 全项目源码（`src/`）、测试用例（`tests/`）及构建配置  
> **约束级别**: 强制执行（Mandatory）

本文档定义了 DSH BrowserWorkbench 的领域驱动目录架构、模块分层边界、代码规模红线（超千行禁止）、并发排队安全、严格类型设计以及开发守则。所有在该代码库中进行的后续开发、重构与 AI 协作均须严格遵守本规范。

---

## 1. 架构核心原则

1. **领域分治（Domain-Driven Modularity）**：按业务领域设立一级模块目录，禁止建立扁平平铺的“垃圾桶”式目录（如历史上的 `src/runtime/` 堆砌 55 个文件）。
2. **千行红线（Strict < 1,000 Lines Limit）**：**单文件代码行数绝对严禁超过 1,000 行**。健康代码区间为 150~500 行；超过 700 行时必须触发预警并规划模块拆分。
3. **禁止过渡垫片（No Forwarding Shims）**：当文件迁移至新领域目录时，必须同步修改所有调用方的引用路径，**严禁在旧路径保留仅用于重新导出的 forwarding shim 垫片文件**。
4. **严格类型安全（Zero `any` Escape Hatches）**：**绝对严禁在核心基类中使用 `[key: string]: any` 逃生舱**。基类调用派生类方法时必须声明 `protected abstract` 虚方法；通用辅助函数必须统一下沉到基类。
5. **并发排队自愈（Zero Deadlocks in Queues）**：排他性队列执行必须保证 100% 释放锁；前序 Promise 的等待必须包裹在安全容错捕获中，严防上游任务崩溃导致整条队列永久死锁。
6. **精简装配入口（Lean Application Entry）**：`src/index.ts` 纯粹作为 Cordis 插件的胶水装配层，**严格控制在 100 行以内**；RPC 路由、安全审批与工具定义必须抽离为独立模块。
7. **React 19 现代化规范**：
   - 前端组件遵循函数式组件设计，组件文件只负责 UI 骨架与交互事件连接。
   - 所有长轮询调度、手势捕获、坐标映射、ResizeObserver 等副作用必须抽离为 `src/client/hooks/` 下的独立领域 Hook。
   - 严禁在组件内部手写脏状态监听，状态订阅必须使用 `useSyncExternalStore`，重渲染使用 `useTransition`，异步状态使用 `useActionState` / `useAsyncAction`。
8. **测试镜像对应（Test Mirroring）**：`tests/` 目录严格以 1:1 镜像结构映射 `src/` 中的领域模块目录。

---

## 2. 目录结构规范

```
dsh-browser-workbench/
├── src/
│   ├── application/       # Cordis 工具定义、元数据、配置项与安全审批策略
│   │   ├── browser-tools.ts    # 30 个浏览器工具定义与参数 Schema
│   │   ├── config.ts           # 插件配置项模型与 Schemastery Schema
│   │   ├── security-policy.ts  # Pre-execute 审批与 Subagent 权限判定
│   │   └── tool-metadata.ts    # 工具动作枚举、输出格式与验证指南
│   ├── cdp/               # Chrome DevTools Protocol 原生通信、状态模型与底层事件
│   ├── client/            # 前端 React 19 客户端
│   │   ├── components/    # 纯展示型/交互型组件（面板框架、导航、实况视图、设置分区）
│   │   ├── hooks/         # 领域 Hooks（轮询流、手势、输入法代理、外部存储同步）
│   │   ├── utils/         # 纯数学变换、剪贴板验证、自动展开决策、回执格式化
│   │   ├── panel-controller.ts # 客户端面板控制器
│   │   ├── port.ts        # RPC 通信适配层
│   │   └── settings-nav-icon.ts # 设置页导航行图标认领与替换
│   ├── compat/            # DSH 宿主 RPC 路由分发器与消息协议兼容层
│   │   ├── rpc-dispatcher.ts   # /api/browser-tools 认证路由分发处理
│   │   ├── dsh-compat.ts       # 宿主 RPC 注册适配
│   │   ├── dsh-message.ts      # 浏览器通知消息封装
│   │   └── config-editor.ts    # 宿主配置编辑器适配与绑定写回
│   ├── controller/        # 会话工具仲裁、控制器状态存储与持久化
│   ├── diagnostics/       # DOM 元素审查、上下文拓扑、飞行记录仪、事件日志与故障诊断
│   ├── domain/            # 领域核心合同、协议定义、安全策略与统一错误模型 (无副作用)
│   ├── extensions/        # Chrome CRX 扩展包解压、状态投影与弹窗视图
│   ├── input/             # 用户人工接管（Takeover）、鼠标/键盘/滚轮手势注入与输入观察
│   ├── page/              # 页面生命周期、网络请求拦截、弹窗对话框与取消操作
│   ├── provider/          # Chromium 实例生命周期、外部 CDP 连接、Profile 与制品管理
│   ├── runtime/           # 运行时继承基类与引擎装配链（Lean Core）
│   ├── session/           # 会话键派生、排他队列序列化与标签页保存/恢复
│   ├── view/              # 视口尺寸规范、自适应重排算法、分屏视图与实时截屏流
│   └── index.ts           # Cordis 插件纯装配入口 (< 100 行)
├── tests/                 # 镜像单测目录（tests/cdp, tests/view, tests/page, tests/client ...）
├── lib/                   # 构建产物（CJS 浏览器端包 + ESM 运行时包）
├── DIRECTORY_SPECIFICATION.md # 目录规范与架构准则（本文档）
├── AGENTS.md              # AI Agent 规范指引
├── TECHNICAL.md           # 技术细节与安全边界说明
└── package.json           # 项目包配置与构建脚本
```

---

## 3. 各模块分工与依赖边界

| 目录 | 职责范围 | 允许依赖的下层 | 严禁行为 |
| :--- | :--- | :--- | :--- |
| **`src/domain/`** | 纯类型、协议结构体、错误码、安全校验纯函数 | 仅允许依赖 Node 内置模块（如 `node:crypto`） | 严禁依赖任何上层业务、Playwright 或 React |
| **`src/cdp/`** | CDP 原生 JSON-RPC、会话状态树、底层协议事件分发 | `src/domain/` | 严禁引入页面 DOM 操作或 UI 状态 |
| **`src/view/`** | 视口计算、等比缩放、双页分屏状态机、Screencast 截屏 | `src/domain/`, `src/cdp/` | 严禁包含工具注册逻辑 |
| **`src/input/`** | 键盘修饰键、鼠标点击坐标转换、输入法合成事件 | `src/domain/`, `src/cdp/` | 严禁直接与前端 React 代码耦合 |
| **`src/page/`** | 导航流水线、网络拦截控制、Fetch 暂停恢复、对话框 | `src/domain/`, `src/cdp/` | 严禁绕过 `CdpState` 直接私自创建 CDP 会话 |
| **`src/session/`** | 标签页恢复模型、会话排它锁、Session Key 派生 | `src/domain/` | 严禁处理复杂的页面渲染副作用；锁释放必须放 `finally` |
| **`src/extensions/`** | CRX3 解析与解包、扩展清单解析、扩展弹窗管理 | `src/domain/`, `src/cdp/` | 严禁直接写入宿主受保护目录 |
| **`src/provider/`** | 外部 CDP 端口连接、每 Session 持久化浏览器启动、Artifact 磁盘管理、Profile 持久化 | `src/domain/`, `src/cdp/` | 严禁复用用户日常浏览器 Profile 或跨 Session 共享自动启动的浏览器进程 |
| **`src/diagnostics/`** | DOM 审查、故障定位、飞行记录仪、事件时间线 | `src/domain/`, `src/cdp/` | 严禁在高频诊断快照中触发耗时网络抓取 |
| **`src/runtime/`** | 业务执行核心编排类（通过继承链逐步叠加各子领域服务） | 上述所有子领域模块 | **严禁平铺业务实现，单文件严格 < 700 行，严禁 `any` 签名** |
| **`src/application/`**| 工具定义、参数 Schema、安全审批与权限过滤 | `src/domain/`, `src/runtime/`, `src/controller/` | 严禁混入宿主 HTTP 路由细节 |
| **`src/compat/`** | 宿主 RPC 分发器与消息封装 | `src/domain/`, `src/runtime/`, `src/controller/` | 保持与 DSH 宿主 RPC 通信协议的纯净映射 |
| **`src/client/`** | 前端界面（React 19 函数式组件、领域 Hooks、几何纯函数） | `src/domain/` | 严禁直接引入后端 Node.js 模块（必须能被浏览器环境打包） |

---

## 4. 并发、类型安全与拆解设计规范

### 4.1 单文件行数红线
- **绝对上限：1,000 行**。全项目任何 `.ts` 或 `.tsx` 文件都不允许超过 1,000 行。
- **预警阈值：700 行**。一旦文件达到 700 行，必须按照“子策略抽取”或“子域下沉”进行拆解。
- **推荐区间：150 ~ 500 行**。保持文件职责单一、阅读顺畅、易于单测覆盖。

### 4.2 并发排队与锁安全性（Concurrency & Deadlock Prevention）
在 [`session-queue.ts`](./src/session/session-queue.ts) 等排他性异步任务排队逻辑中：
1. **100% 释放锁保证**：释放锁的 `release()` 必须始终置于最外层 `finally` 块中。
2. **前序异常容错**：严禁裸写 `await previous`。必须使用 `try { await previous } catch {}`，确保前序任务即使抛出未捕获异常或被 Abort，当前排队任务依然能顺利接管并正确推进，严禁留存永久未 Resolve 的悬空 Promise。
3. **多锁竞争排序**：`queueExclusiveMany` 必须先按稳定 Key 进行自然排序，按序获取锁，并在发生任何异常时逆序执行完整释放，彻底杜绝死锁。

### 4.3 核心基类与继承类型安全（Strict Hierarchy Typing）
在 [`runtime-core-foundation.ts`](./src/runtime/runtime-core-foundation.ts) 及其继承链中：
1. **严禁 `[key: string]: any` 逃生舱**：所有类必须保持严格的静态类型检查，禁止使用索引签名掩盖方法未定义错误。
2. **抽象虚方法声明**：基类若需调用子类生命周期或视图服务（如 `syncScreencasts`, `applyLiveViewport`），必须显式声明 `protected abstract methodName(...): Promise<...>`。
3. **公共方法下沉**：多个子类均需调用的辅助方法（如 `view()`, `ref()`, `modelWriteBlocked()`）必须统一下沉至基类，严禁跨继承层级的逆向调用。

### 4.4 插件入口装配架构（Lean Entry Architecture）
`src/index.ts` 仅承担插件启动胶水职责，行数控制在 **100 行以内**：
- **RPC 路由**：委派给 `src/compat/rpc-dispatcher.ts`；
- **安全审批策略**：委派给 `src/application/security-policy.ts`；
- **工具定义与 Schema**：委派给 `src/application/browser-tools.ts`；
- **生命周期注入**：负责串联 `runtime`、`controller` 并注册 Cordis 插件。

---

## 5. 前端 React 19 开发准则

1. **坚持函数式组件**：
   统一使用 `function ComponentName(props: Props) {}` 或箭头函数，禁止使用类组件。
2. **组件与副作用严格解耦**：
   - 严禁在视图组件中直接写 `setInterval` / 嵌套 `setTimeout` 进行网络轮询；
   - 严禁在组件中直接注册低级 `ResizeObserver` 或全局 DOM 事件监听；
   - 所有上述逻辑必须封装为 `src/client/hooks/` 中的领域 Hook，组件只消费 Hook 产出的纯数据与操作回调。
3. **并发与外部状态订阅**：
   - 订阅外部控制器状态（如 `PanelController`）**必须使用 `useSyncExternalStore`**，严禁使用 `useEffect` + 手动 `useState` 模拟订阅（防渲染撕裂）。
   - 视图切换（实况、诊断、网络等 Tab 切换）**必须使用 `startTransition`** 标记为非紧急渲染，保障交互点击瞬间响应。
   - 异步操作优先使用 `useActionState` / `useAsyncAction` 模式。
   - 表单无障碍关联必须使用 `useId` 保证 Label 与 Input 唯一绑定。

---

## 6. 宿主兼容与版本依赖管理（DSH Alignment）

1. **宿主 PeerDependencies 声明**：
   - 对 `@deepseek-ai/dsh-*` 的 peer 依赖必须保持灵活版本范围（如 `"^0.2.1-rc.2 || ^0.2.1-rc.3"`），禁止死板锁定单一 prerelease 版本，保证在新版 DeepSeek Harness 宿主下无冲突热载。
   - 对 `react` 的 peer 依赖统一声明为 `"^18.2.0 || ^19.0.0"`。
2. **包管理器标准**：
   - 项目唯一官方包管理器为 `pnpm`。依赖新增或版本锁定变更统一由 `pnpm install` 更新 `pnpm-lock.yaml`。

---

## 7. 质量门禁与验证流程

每次新增、修改或重构代码后，必须在终端执行以下检查，且必须全部为绿色方可交付：

```powershell
# 1. 严格 TypeScript 类型检查（0 错误）
npm run typecheck

# 2. 自动化单元测试回归（178 项全部通过）
npm test

# 3. 生产产物构建校验（双入口打包成功）
npm run build
```

---

## 8. 违规判定清单（Code Review 禁止项）

- ❌ 在核心基类中使用 `[key: string]: any` 逃生舱抹平类型错误。
- ❌ 在异步排他队列中裸写 `await previous` 导致任务失败时锁泄露死锁。
- ❌ 在 `src/index.ts` 顶层入口中平铺堆砌 200+ 行的 RPC switch-case 或大块工具定义。
- ❌ 在 `src/runtime/` 根目录下新增具体的业务功能文件（必须新建在对应领域子目录）。
- ❌ 迁移文件后保留 forwarding shim 重新导出（必须全仓替换 import 路径）。
- ❌ 任何单个文件行数超过 1,000 行。
- ❌ 在 `src/client/` 内部组件中直接 `import 'fs'` 或任何 Node.js 原生模块。
- ❌ 在前端组件内部堆砌超过 5 个离散 `useState`（应使用 `useReducer` 或抽离子组件/Hook）。
- ❌ 修改代码导致 `npm run typecheck` 报错或单测失败。
