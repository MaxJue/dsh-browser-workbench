# Agent Rule: Domain Architecture & Engineering Specifications

This repository enforces strict domain-driven modularity, zero-deadlock concurrency, strict static typing, and file-size limits.

1. **Domain Directories**: All code must reside in designated packages: `domain/`, `cdp/`, `view/`, `input/`, `page/`, `session/`, `extensions/`, `provider/`, `diagnostics/`, `application/`, `compat/`, `client/`, `runtime/`.
2. **File Size Redline**: NO file may exceed 1,000 lines. Files reaching 700 lines must be split into strategies, helpers, or submodules.
3. **Lean Entry**: `src/index.ts` must remain under 100 lines, delegating RPC to `src/compat/rpc-dispatcher.ts`, safety to `src/application/security-policy.ts`, and tools to `src/application/browser-tools.ts`.
4. **Concurrency Safety**: Sequential queues (`queueExclusive`, `queueExclusiveMany`) must guarantee 100% lock release in `finally` and wrap predecessor awaits in `try { await previous } catch {}` to avoid permanent deadlocks on task rejection.
5. **Strict Typing**: NO `[key: string]: any` on base classes. Use `protected abstract` virtual methods and sink shared helpers to the base class.
6. **No Shims**: Do not leave re-export forwarding shims when relocating files. Update all call sites across the codebase.
7. **React 19 Frontend**:
   - Thin functional components.
   - Encapsulate polling, gestures, and observers in `src/client/hooks/`.
   - `useSyncExternalStore` for controller subscriptions.
   - `startTransition` for view switching.
   - `useId` for accessible labels.
8. **DSH Compatibility**: Use flexible peer ranges for `@deepseek-ai/dsh-*` (e.g., `"^0.2.1-rc.2 || ^0.2.1-rc.3"`) and use `pnpm` for dependencies.
9. **Verification Gate**:
   - `npm run typecheck` must pass with 0 errors.
   - `npm test` must pass 100% of unit tests (145/145).
   - `npm run build` must generate valid production bundles.
