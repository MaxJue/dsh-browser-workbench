# DSH BrowserWorkbench Release Notes

## Version 1.0.0-rc9

### Overview

`dsh-browser-workbench` version `1.0.0-rc9` moves the plugin from DSH `0.2.1-rc.2` / `0.2.1-rc.3` to DSH `0.2.2-rc.5`. Functionally it is the same workbench as rc8; the release is a host-compatibility upgrade.

---

### Host Compatibility Changes

- **DSH peers raised to `^0.2.2-rc.5`**: every direct `@deepseek-ai/dsh-*` peer now declares the rc.5 range instead of the rc.2/rc.3 range, and all development dependencies are pinned to `0.2.2-rc.5`.
- **Cordis `~4.1.0` / Schemastery `~3.19.0`**: aligned with the rc.5 host dependency graph.
- **`@deepseek-ai/dsh-error` added**: DSH `0.2.2-rc.5` moves the `HarnessError` base class into its own package and `dsh-llm` re-exports it. The plugin's `BrowserError` keeps extending `HarnessError` with the unchanged `(message, code, options)` constructor; the new package is declared so the type resolves instead of silently degrading to `any`.
- **Loader patch dialect revalidated**: `cordis.patch.yml` keeps the `insert` list dialect under loader 1.1.0; the composed profile tree still yields the `browser-tools` entry.
- **Client slots revalidated**: `sidebar.right.pane.tab` (keyed by the tab type id), `settings.section`, `sidebarRightTabs.register`, and the guide entry contract are unchanged in shape; the right-sidebar guide card and panel body load on rc.5 without console errors.
- **Build script without `npm`**: `npm run build` became `tsc --noEmit -p tsconfig.json && tsdown`, so the verification gate no longer depends on an npm binary being on `PATH`.

### Panel Auto-Reveal Restored

- **Agent activity opens the panel again**: `src/client/auto-reveal-watcher.ts` installs inside `ctx.effect` and subscribes to the main Session and its `running` flag from `ctx.uiSession`. During a running turn with the panel closed, it polls the read-only `panel_activity` endpoint once per second and calls `controller.open('live')` only when the probe reports page content it has not shown before. A probe allocates no View and starts no screencast.
- **It never fights the user for attention**: at most one automatic reveal per turn. Closing an auto-revealed panel suppresses the rest of that turn; a finished turn resets the suppression so the next turn gets one fresh chance. The `shouldAutoReveal` / `activitySignature` decision kept from the earlier design is now genuinely wired to the panel controller.
- **Entry point unchanged**: the sidebar's "开始" → 「浏览器实况」 guide card still opens the panel by hand, and the composer still carries no browser binding control.

### Live Page Input Restored

- **The live picture is interactive again**: clicking, typing, drag, wheel, IME composition, and paste inside the right-sidebar panel now reach the real page. `src/client/hooks/usePointerGestures.ts` and `src/client/hooks/useImeProxy.ts` (a 1px transparent `textarea` IME proxy focused at the click point) turn panel events into `src/input/user-input-actions.ts` CDP calls through the panel-only `user_input` RPC endpoint.
- **Coordinates and frames are bound together**: `src/client/utils/geometry.ts` projects clicks through the `object-fit: contain` letterboxing; every input carries `viewId` / `streamGeneration` / `frameSequence` / `viewportGeneration`, and a stale stream or viewport answers `STALE_LIVE_VIEW` instead of clicking into another picture.
- **No model tool was added**: the write-back path serves humans only and shares the per-Session queue with the model tools, so both sides serialize on the same page. Clipboard paste keeps the 8 files / 8MB per file / 16MB total limits.

### Verification

- Strict typecheck: 0 errors.
- Unit tests: 186/186 pass (`node --experimental-strip-types --test tests/**/*.test.mjs`).
- Production build: `lib/index.mjs`, `lib/index.d.mts`, and `lib/client.js` build cleanly.
- 29-tool Chromium regression: 140/140 assertions pass on local Chrome `158.0.8127.37`.
- Isolated DSH `0.2.2-rc.5` Web profile: Host plugin mounts, authenticated `/api/browser-tools` round trip succeeds (`registrationMode: global`, `configurable: true`), the right-sidebar guide card opens the `BrowserWorkbench` panel, and the page reports no console errors.

Still pending: rewriting the panel and RPC e2e scripts for the current UI, manual install/launch/uninstall acceptance on a brand-new DSH Web profile, macOS/Linux hardware acceptance, and the first npm publication.

---

## Version 1.0.0-rc8

### Overview

`dsh-browser-workbench` version `1.0.0-rc8` is an agent-native browser DevTools workbench for DeepSeek Harness (DSH). It provides globally registered session-scoped tools, an automatically launched per-session Chromium (plus optional external Chrome/Edge CDP connection), 29 customized browser automation tools, and a live-only workspace panel integrated into the DSH Web right sidebar, with a three-way browser binding section in DSH settings.

---

### Key Features & Improvements

#### 1. Global Tool Registration & Multi-Plugin Coexistence
- **`global` Mode (Default)**: The 29 tools are registered profile-wide once; new sessions can call them immediately with no first-use pick or manual bind.
- **Optional `session-select` Mode**: For multi-plugin environments, `toolRegistrationMode: session-select` keeps the per-session selection implementation, where the choice is locked for that session. It remains configurable in the Profile patch and covered by tests, but the settings page no longer offers it (the settings page writes one global binding for all sessions).
- **Selection Masking**: Only in `session-select`, and only before an explicit choice, browser tools are concealed from the Agent to prevent premature invocation.
- **Persistence Across Restarts**: Selection status is persisted in schema v2 format (`$DSH_HOME/browser-tools/controller/sessions/`), surviving DSH host restarts and Agent Scope replacements.
- **Automatic Fallback**: In `global` mode, detecting pre-existing `browser_*` tools automatically degrades to `session-select` to prevent Cordis registration conflicts.

#### 2. Automatic Per-Session Browser & Optional External CDP
- **Automatic Launch**: With `providerMode: auto` (default), the first browser tool call in a session launches that session's dedicated persistent Chromium (`browser_provider connect` with `provider: managed` also works).
- **Session Isolation**: Every session gets its own user-data-dir; pages, cookies, login state, and the browser process are not shared, so different projects run side by side without interfering.
- **Optional External CDP**: "连接现有 Chrome / Edge" in the DSH settings section writes `providerMode: external` plus `externalCdpEndpoint` (e.g. `http://127.0.0.1:9222`) into the Profile patch. With `providerMode: external`, the first browser use in a session attaches to that endpoint automatically (`ensureAutoProvider` → `connectExternalCdp`), without a manual `browser_provider connect`; a failed attach raises `PROVIDER_UNAVAILABLE` with the endpoint and a remote-debugging hint.
- **State Preservation**: When attaching over external CDP, cookies, localStorage, credentials, and browser tabs remain natively in the user's browser; disconnecting CDP leaves the browser tabs untouched.

#### 3. 29 Agent Browser Automation Tools
All tools are defined under `src/application/browser-tools.ts` with strict schema validation:
- **Navigation & Page Operations (14 tools)**: `browser_tabs`, `browser_navigate`, `browser_navigate_back`, `browser_snapshot`, `browser_click`, `browser_hover`, `browser_scroll`, `browser_type`, `browser_press_key`, `browser_select_option`, `browser_wait_for`, `browser_get_attribute`, `browser_query`, `browser_handle_dialog`.
- **Observation, Files & Network (6 tools)**: `browser_take_screenshot`, `browser_console_messages`, `browser_network_requests`, `browser_upload_file`, `browser_download`, `browser_network_control`.
- **Debugging & Runtime Environment (6 tools)**: `browser_debugger`, `browser_diagnose`, `browser_profile`, `browser_emulate`, `browser_evaluate`, `browser_provider`.
- **Workbench & Display (3 tools)**: `browser_live_view`, `browser_split_view`, `browser_extensions`.

#### 4. Live-Only Native DSH Workbench Panel (React 19)
Integrated into the DSH Web right sidebar (`sidebar.right.pane.tab`), also reachable from the "浏览器实况" card on the sidebar's "开始" (Get started) page:
- **Live View (`live`)**: Page screencast streaming, display mode switching (standard 1280x720 / adaptive reflow), split-view geometry controls, and drag-to-share panes.
- **Panel Chrome**: Tab bar, address bar with back/forward/reload, and an in-panel close action; the panel is bound to one session and strictly isolated per Session.
- **Scope of the panel today**: the panel renders the live view only. The former console, network, debugger, performance, diagnostic, provider, extensions, and emulation views were removed; their capabilities remain available to the Agent through `browser_console_messages`, `browser_network_control`, `browser_debugger`, `browser_profile`, `browser_diagnose`, `browser_provider`, `browser_extensions`, and `browser_emulate`. `browser_diagnose` and `browser_profile` are unchanged, including their profile artifacts.
- **Binding in DSH settings**: a dedicated "浏览器" settings section (`id: browser`, `order: 60`) switches between DSH BrowserWorkbench, an existing Chrome/Edge endpoint, and disabling the plugin.

---

### Core Bug Fixes in rc8

During end-to-end sandbox verification and real UI replay, the following 7 issues were identified and resolved:
1. **Composer Slot Crash (React error #185)**: Eliminated infinite re-subscription loops in `panel-controller.ts` and `usePanelSync.ts` by returning stable snapshot identities and refraining from synchronous notifications during subscription. (The composer control and `usePanelSync.ts` were deleted later in this round together with the `conversation.input.right` slot, so this code path no longer exists; the invariant it protected is now moot.)
2. **`browser_navigate_back` bfcache Restore Timeout**: Replaced rigid `domcontentloaded` waits with parallel URL polling (`awaitBackNavigation()`), cutting bfcache history restore latency from 30,031ms to 122ms.
3. **`browser_provider disconnect` Post-Teardown Exception**: Fixed teardown flow so that disconnect cleanly cleans up views without attempting to recreate pages in a disconnected provider.
4. **Provider Input Accessible Name**: Added `aria-label="远程调试地址"` to the endpoint input, enabling selector querying via `query field=refs` and screen reader accessibility. (`ProviderView` was removed with the eight non-live views; the equivalent accessible name now lives on the "浏览器调试端点" input of the settings section.)
5. **Subagent Interactive Security Policy Gaps**: Unified navigation mutations, pointer interactions, and tab creation under the subagent interactive denial check when `subagentInteractive=false`.
6. **Local Directory Extension Installation**: Added unpacked extension ID derivation (`unpackedExtensionId()`) and manifest validation to support installing local MV3 directories.
7. **`browser_extensions apply` External CDP Resilience**: Fixed extension restart handling so external CDP connections are preserved without tearing down the user's running browser session.

---

### Verification & Quality Gates

- **Static Typing**: `npm run typecheck` (`tsc --noEmit -p tsconfig.json`) passes with 0 errors.
- **Unit Test Suite**: `npm test` passes **171 of 171 tests** across the domain test directories (174 at the 2026-10-24 run; this round added the three-way binding patch mapping, `controller_overview` / `controller_set_browser_choice`, the `disabled` branch, `externalCdpEndpoint` pass-through, and `BrowserController.list()` cases).
- **Build Output**: `npm run build` compiles clean bundles (`lib/index.mjs`, `lib/index.d.mts`, `lib/client.js`, `lib/client.js.map`).
- **Package Determinism**: `node scripts/check-public-package.mjs` verifies all 25 packaged files match repository bytes.
- **End-to-End Regression** (numbers below are the 2026-10-24 sandbox run; see the pending-rewrite notes):
  - `npm run verify:tools`: 145/145 assertions passed on real Chromium.
  - `npm run verify:instance`: 10/10 assertions passed in isolated DSH instance. Its composer-control step no longer applies, so the script needs a rewrite before it can be counted again.
  - `npm run verify:panel`: 33/33 assertions passed in the real UI at that run — but through the nine-view panel and the composer controller menu, both of which were removed. The script is **pending rewrite** and is not counted as passing.
  - `npm run verify:extensions`: 19/19 assertions passed.
  - `npm run verify:managed`: 16/16 assertions passed.
  - `npm run verify:config`: 13/13 assertions passed.
  - `npm run verify:rpc`: 16/16 assertions passed at that run; it claims through the removed controller menu and still asserts `controller_set_registration_mode`, so it is **pending rewrite** and not counted as passing.
  - `npm run verify:persist`: 7/7 prepare + 5/5 verify passed across host restarts.

### Client Panel Slimming, Settings Binding & External CDP Auto-Connect (2026-10-26)

- **Live-only panel**: `BrowserPanel.tsx` now renders only `TabBar` + `NavigationBar` + `LiveView`; the 9-view routing and the eight view directories (`console`, `debugger`, `diagnostic`, `emulation`, `extensions`, `network`, `performance`, `provider`) are deleted. `DiagnosticOverlay.tsx` stays, because `LivePane` uses it. The "open diagnostics" button and the Recorder (Rolling/Deep, stop, mark) controls were removed from `LiveView`/`LiveControls`; `browser_diagnose` and `browser_profile` themselves are unchanged.
- **Composer controls removed**: the whole `src/client/components/control/` directory (`BrowserControl`, `ControllerMenu`, `ArbitratedToolsDialog`) and `src/client/hooks/{useAutoReveal,useControllerBinding,usePanelSync}.ts` were deleted; `conversation.input.right` is no longer registered, and the panel no longer auto-opens on activation.
- **Panel entry**: `sidebarRightTabs` registration now includes a `guide` card (`id: 'live'`, `order: 20`, title "浏览器实况", description "查看 Agent 正在操作的浏览器", icon from the new `src/client/components/common/BrowserGlyph.tsx`), so the sidebar's "开始" page offers a way in.
- **Settings-page binding section**: `ctx.effect` registers `settings.section` (`id: browser`, `order: 60`, label "浏览器") rendering `src/client/components/settings/BrowserSettingsSection.tsx`, built with inline styles because CSS Modules do not apply inside the host settings scope.
- **Three-way binding**: a single `BrowserToolChoice = 'workbench' | 'existing' | 'off'` maps to the Profile patch — `workbench` → `toolRegistrationMode: global` + `providerMode: auto`; `existing` → `global` + `providerMode: external` + `externalCdpEndpoint`; `off` → `toolRegistrationMode: disabled`. One global binding for all sessions; per-session binding is not offered in the UI.
- **Host write-back via `configEditor`**: `src/compat/config-editor.ts` obtains `@deepseek-ai/dsh-config-editor` through `ctx.get('configEditor')`, finds the `id: 'browser-tools'` entry via `entries()`, and calls `edit(entry, current => ({ ...current, ...browserChoicePatch(...) }))`, which writes `~/.dsh/profiles/<profile>/cordis.patch.yml` and triggers a hot reload. Missing service, missing entry, or an entry overridden by a home patch each return a readable message instead of failing silently.
- **`disabled` mode**: no browser tools are registered, `controller_status` answers `registrationMode: 'disabled'`, `mode: 'unselected'`, `blockers: ['browser-tools-disabled']`, and every session-level endpoint returns the same "当前已停用 DSH BrowserWorkbench，浏览器面板不可用" error. Switching back to `workbench` restores everything.
- **`externalCdpEndpoint` + auto-connect**: new `externalCdpEndpoint: z.string()` option; `toolRegistrationMode` becomes `global | session-select | disabled` (default `global`). `ensureAutoProvider` in `src/runtime/runtime-core-foundation.ts` connects the configured endpoint with `externalCdpTimeoutMs` when `providerMode === 'external'`, stores `providerBinding = { kind: 'external-cdp', ...endpoint }`, and raises `PROVIDER_UNAVAILABLE` on failure.
- **RPC surface**: added `controller_overview` (no session required; returns `registrationMode`, `configuredMode`, `configurable`, `configurableMessage?`, `providerMode`, `choice`, `endpoint?`, and `sessions` from the new `BrowserController.list()`), added `controller_set_browser_choice ({ choice, endpoint? })`, and **removed** `controller_set_registration_mode`.
- **Settings navigation icon**: `src/client/settings-nav-icon.ts` swaps the host's fixed gear icon on the "浏览器" settings row for a browser-window icon, using a `MutationObserver`, the `data-dsh-browser-nav-icon` marker, and a mask-based SVG `::before` (same approach as the community `dshmarket` plugin).
- **Docs & screenshots**: README screenshots refreshed for the new entry card, the live-only panel, and the settings section in both binding states (`assets/browser-workbench-entry.png`, `panel.png`, `settings.png`, `settings-existing.png`).
- **Gates**: `typecheck` 0 errors, `npm test` 171/171, `npm run build` clean. `verify:panel` and `verify:rpc` are pending rewrite and are not claimed as passing.

---

### Removal of Human Takeover (2026-10-26)

- **Pure observation live view**: The manual takeover mechanism and its dedicated input pipeline (`browser_takeover`, `src/input/`, `usePointerGestures`, `useImeProxy`, `clipboard.ts`, `geometry.ts`) have been completely removed.
- **Unimpeded Agent control**: Removed the `USER_TAKEOVER_ACTIVE` execution blocker and user-takeover locks; Agent automation retains full unblocked ownership of the browser context.
- **Tools consolidated to 29**: Total registered automation tools reduced from 30 to 29; unit test suite adjusted from 178 to 171 passing tests.

---

### Compatibility

| Component | Supported Version Range |
| --- | --- |
| DeepSeek Harness (DSH) | `0.2.2-rc.5` (peer range: `^0.2.2-rc.5`) |
| Cordis | `~4.1.0` |
| Schemastery | `~3.19.0` |
| React | `^18.2.0 \|\| ^19.0.0` |
| Node.js | `^22.19.0 \|\| >=24.0.0` |
| Package Manager | `pnpm` (>= 9.x, tested with pnpm 11.x) |

