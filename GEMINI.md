# Gemini / Antigravity Agent Workspace Rules

This repository enforces strict domain-driven modularity, strict file-size limits, zero-deadlock concurrency, strict static typing, and React 19 standards. All AI agents must follow these rules:

1. **Domain Structure**:
   - Modules belong to their dedicated domain folders: `src/cdp/`, `src/view/`, `src/input/`, `src/page/`, `src/session/`, `src/extensions/`, `src/provider/`, `src/diagnostics/`, `src/domain/`, `src/application/`, `src/compat/`, `src/client/`.
   - Never flat-dump business files into `src/runtime/`.
   - Entry file `src/index.ts` must remain a lean assembly layer (< 100 lines).
   - Test suites must mirror the domain directories (`tests/<domain>/`).

2. **File Size Limit (< 1,000 Lines)**:
   - **Strictly NO file may exceed 1,000 lines**.
   - Keep files in the 150~500 line range. Files reaching 700 lines must be split into sub-modules.

3. **Concurrency & Deadlock Prevention**:
   - In `queueExclusive` and sequential queues, wrap predecessor awaits in `try { await previous } catch {}` and ensure `release()` is inside `finally`.
   - Multi-state locks must acquire by stable key order and release in reverse order even during acquisition failures.

4. **Strict Typing (Zero `any` Escape Hatches)**:
   - Strictly forbid `[key: string]: any` on runtime base classes.
   - Use `protected abstract` for operations orchestrated by base classes but implemented by subclasses.
   - Sink shared helpers to the base class to prevent reverse inheritance calls.

5. **No Migration Shims**:
   - When moving files, update all import paths across the codebase.
   - Do NOT leave re-export forwarding shim files.

6. **React 19 & Frontend Guidelines**:
   - Encapsulate polling, gestures, observers, and math into dedicated hooks under `src/client/hooks/`.
   - Use `useSyncExternalStore` for external store subscriptions to avoid tearing.
   - Use `startTransition` for view switching.
   - Use `useId` for accessible labels and inputs.

7. **DSH Compatibility**:
   - Declare `@deepseek-ai/dsh-*` peer dependencies using flexible ranges (`"^0.2.1-rc.2 || ^0.2.1-rc.3"`).
   - Manage packages with `pnpm` and commit `pnpm-lock.yaml`.

8. **Mandatory Quality Gates**:
   - `npm run typecheck` must pass with 0 errors.
   - `npm test` must pass all tests (145/145 pass).
   - `npm run build` must generate valid bundles.

For the comprehensive specification, see [`DIRECTORY_SPECIFICATION.md`](./DIRECTORY_SPECIFICATION.md).
