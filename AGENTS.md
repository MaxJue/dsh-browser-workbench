# Agent Rules & Architecture Guidelines

This repository follows a strict domain-driven architecture and code organization standard. All AI agents working in this codebase must adhere to the following rules:

---

## 1. Directory Structure & Domain Modularity

- **Domain-First Organization**: Every new or refactored module must be placed in its designated domain directory:
  - `src/domain/`: Pure protocol contracts, interfaces, error codes, and validation policies (zero side effects, no Playwright/React).
  - `src/cdp/`: Raw CDP JSON-RPC client, CDP session state, and protocol-level event listeners.
  - `src/view/`: Viewport models, adaptive reflow algorithms, split-view controllers, and screencast sync.
  - `src/input/`: User takeover, keyboard/mouse/pointer gesture dispatchers, and input observation.
  - `src/page/`: Page navigation pipelines, network interception controls, fetch pause/resume, and dialog handlers.
  - `src/session/`: Session keys, exclusive task queueing, and tab restoration logic.
  - `src/extensions/`: Chrome CRX3 unpacker, extension registry, and extension popup windows.
  - `src/provider/`: External CDP connection, profile store, and artifact storage.
  - `src/diagnostics/`: DOM element inspection, context topology, flight recorder, and incident diagnostic reports.
  - `src/runtime/`: Thin runtime orchestration layers (< 700 lines each).
  - `src/client/`: React 19 frontend UI (modularized into `components/`, `hooks/`, `utils/`, `core/`).
  - `tests/`: Must mirror the `src/` directory layout 1:1 (`tests/cdp/`, `tests/view/`, `tests/page/`, etc.).

- **NO Flat Dumping Grounds**: NEVER create flat business modules directly inside `src/runtime/`. All feature code belongs to its corresponding domain package.

---

## 2. Hard File Size Redline: ZERO Files > 1,000 Lines

- **Hard Limit**: **Strictly NO file may exceed 1,000 lines of code**.
- **Warning Threshold**: Any file approaching **700 lines** must be refactored and decomposed into strategy handlers, sub-services, or helper utilities.
- **Ideal Range**: 150 ~ 500 lines per file, ensuring single responsibility and high testability.

---

## 3. Strict Deletion of Shims (No Legacy Re-export Shims)

- When moving or decomposing files, **always update all import sites directly across the entire project**.
- **NEVER leave re-export forwarding shim files** (e.g. `export * from '../new-path'`). Delete old files completely upon migration.

---

## 4. Frontend & React 19 Standards

- **Functional Components Only**: Use functional components with typed props.
- **Hook Encapsulation**: Keep UI components thin. NEVER place raw polling loops, `ResizeObserver`, pointer capture chains, or low-level geometry math directly inside UI component files. Always extract them into dedicated hooks in `src/client/hooks/`.
- **Concurrent & External Store Subscriptions**:
  - Always use `useSyncExternalStore` for external controller/store subscriptions (e.g., `PanelController`) to avoid tearing.
  - Wrap multi-view tab switching in `startTransition` to keep navigation responsive.
  - Use `useId` for accessible form/input label bindings.
  - Use `useActionState` / `useAsyncAction` for asynchronous RPC interactions.

---

## 5. Verification Gate (Must Pass 100%)

Before finishing any task, run the full verification pipeline:
1. `npm run typecheck` (`tsc --noEmit -p tsconfig.json`) -> **Must have 0 errors**.
2. `npm test` (`node --experimental-strip-types --test tests/**/*.test.mjs`) -> **100% of unit tests must pass (171/171 passed, 0 failed)**.
3. `npm run build` (`tsdown`) -> **Must build cleanly** (`lib/client.js` and `lib/index.mjs`).

Refer to [`DIRECTORY_SPECIFICATION.md`](./DIRECTORY_SPECIFICATION.md) for full architectural details.

---

## 6. Reply Style (User Preference, Non-Negotiable)

- **先做事，再说话**：默认直接改代码/执行命令，不要先写长篇分析、方案对比或论证。
- **回复极简**：结论 1-3 句；改动只列文件与关键点；不复述代码，不解释显而易见的东西。
- **只在两种情况下展开**：用户明确问「为什么」；或遇到真正的阻塞（需要用户操作/授权）。阻塞说明也不超过 5 行。
- 中文回复，不用 emoji，不写「好的」「我来帮你」这类客套开场。
