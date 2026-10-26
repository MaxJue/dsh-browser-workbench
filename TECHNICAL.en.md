# DSH BrowserWorkbench Technical Specifications

[简体中文](./TECHNICAL.md) | English Version

Version `1.0.0-rc8` targets DSH `0.2.1-rc.2` / `0.2.1-rc.3` (declared as peer range `^0.2.1-rc.2 || ^0.2.1-rc.3`), using Cordis `~4.0.5` and Schemastery `~3.18.5`.

This document specifies the configuration options, tool registration modes, browser state models, security boundaries, internal identifiers, 30 Agent tools, the live-only panel, and the settings-page binding flow. For general installation and feature overviews, see [README.en.md](./README.en.md). For test records, see [VALIDATION.en.md](./VALIDATION.en.md).

## Configuration

Complete configuration example (`cordis.patch.yml` or Profile configuration):

```yaml
- id: browser-tools
  config:
    toolRegistrationMode: global
    providerMode: auto
    # Debugging endpoint written back by the settings page "Connect to existing Chrome / Edge"; auto-connected when providerMode: external
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
    # Settings for the automatically launched per-session browser (used only by protected methods when providerMode: external):
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

### Runtime Configuration Options (22 top-level options; `sessionController` expands to 3 rows)

| Option | Default | Description |
| --- | --- | --- |
| `toolRegistrationMode` | `global` | Registration mode: `global` (registered once, every session can use the tools; degrades automatically if existing `browser_*` tools are detected), `session-select` (first-use selection per session, then permanently locked), or `disabled` (registers nothing; the browser panel is unavailable). |
| `providerMode` | `auto` | `auto` launches a dedicated persistent Chromium for the session on its first browser tool call; `external` never launches and instead auto-connects `externalCdpEndpoint` when the session first needs a browser. |
| `externalCdpEndpoint` | `''` | CDP debugging endpoint of an external Chrome/Edge (e.g. `http://127.0.0.1:9222`), written back by the settings page "Connect to existing Chrome / Edge"; used for auto-connect when `providerMode: external`, otherwise waits for an explicit `browser_provider connect`. |
| `sessionController.conflictingToolPatterns` | `['^browser_', '^chrome_', '^pilot_', '^mcp__playwright__', '^mcp__chrome_devtools__']` | Regex patterns used to detect and arbitrate conflicting third-party browser tools. |
| `sessionController.includeTools` | `[]` | Explicit tool names to include in browser tool selection arbitration. |
| `sessionController.excludeTools` | `[]` | Explicit tool names to exclude from browser tool selection arbitration. |
| `externalCdpTimeoutMs` | `15000` | Connection timeout in milliseconds when attaching to an external Chrome/Edge CDP port (minimum 1000). |
| `interceptionTimeoutMs` | `15000` | Timeout in milliseconds for paused network requests (minimum 1000). Requests automatically continue after this timeout to prevent hanging the page. |
| `subagentInteractive` | `false` | Whether delegated subagents are allowed to invoke interactive write tools (such as navigate, click, type, etc.). |
| `allowedOrigins` | `[]` | Whitelist array of allowed origins for navigation; when non-empty, navigations outside these origins are rejected with `POLICY_DENIED`. |
| `allowLoopback` | `true` | Whether navigations to loopback addresses (`127.0.0.1`, `localhost`, etc.) are permitted. |
| `allowPrivateNetwork` | `true` | Whether navigations to RFC 1918 private IPv4 network addresses are permitted. |
| `uploadRoots` | `[process.cwd()]` | Absolute root directory whitelist for `browser_upload_file`, protecting against directory traversal attacks. |
| `artifactRoot` | `$DSH_HOME/browser-tools` | Root directory on disk for persistent artifacts (Traces, Heap Snapshots, CPU Profiles, Source Maps). |
| `maxUploadBytes` | `26214400` (25MB) | Maximum file size in bytes for a single upload. |
| `maxDownloadBytes` | `104857600` (100MB) | Maximum file size in bytes for a single download. |
| `maxArtifactBytes` | `268435456` (256MB) | Maximum byte limit when reading a single artifact via `artifact_read`; larger files return `ARTIFACT_TOO_LARGE`. |
| `maxOutputChars` | `12000` | Maximum character length for text output truncation protection (minimum 1000). |
| `executablePath` | `undefined` | Local Chromium executable used by the automatic launch; when absent the plugin looks for system Chrome/Edge, then downloads Playwright Chromium. |
| `headless` | `true` | Whether the automatic launch runs headless. |
| `proxy` | `mode: 'system'` | Proxy for the automatic launch: `system`, `direct` (`--no-proxy-server`), or `custom` (supports HTTP, HTTPS, SOCKS4, SOCKS5 with separate username/password). |
| `chromiumDownloadSource` | `'auto'` | Archive mirror for Chromium downloads when no system Chrome/Edge exists: `'auto'`, `'npmmirror'`, or `'official'`. |
| `chromiumDownloadTimeoutMs` | `300000` (5 mins) | Timeout in milliseconds for Chromium downloads. |
| `sharedProfileSeedSessionId` | `undefined` | Seed Session ID for managed shared profile mode (not exposed on the tool surface). |

> [!NOTE]
> With `providerMode: auto`, `executablePath`, `headless`, proxy, and Chromium download settings all apply to the automatically launched per-session browser; `npm run verify:managed` still exercises the protected methods directly. If no system Chrome/Edge is available the plugin downloads Playwright Chromium, so "never launches or downloads a browser" is no longer the default behavior.

## Tool Registration Modes

BrowserWorkbench supports three registration modes and uses `global` by default: a new session needs no extra pick, and both the tools and the browser are immediately available. The settings page's three-way binding corresponds one-to-one with these modes, so users never have to edit configuration by hand.

| Config | Settings-page choice | Registration | Browser source |
| --- | --- | --- | --- |
| `global` + `providerMode: auto` | DSH BrowserWorkbench | Registers all 30 `browser_*` tools | Launches a per-session Chromium |
| `global` + `providerMode: external` | Connect to existing Chrome / Edge | Registers all 30 `browser_*` tools | Auto-connects `externalCdpEndpoint` |
| `session-select` | Not offered by the settings page (implementation and tests only) | Registers after the first per-session selection | Depends on that selection |
| `disabled` | Disable this plugin | Registers nothing | Nothing allocated; every panel endpoint returns the disabled error |

> [!NOTE]
> The settings page writes a single global binding and does not support per-session binding. `session-select` can still be enabled by editing the configuration, but the settings page does not offer it.

### 1. Global Mode (`global`, Default)

```yaml
- id: browser-tools
  config:
    toolRegistrationMode: global
```

Registers all 30 tools into DSH globally. If pre-existing `browser_*` tools are detected at bootstrap, BrowserWorkbench automatically degrades to `session-select` to prevent cordis registration conflicts.

### 2. Session-Select Mode (`session-select`, Optional)

```yaml
- id: browser-tools
  config:
    toolRegistrationMode: session-select
```

- **Concealed State**: Prior to an explicit choice, browser tools are concealed from the Agent to prevent premature invocation. The settings page only writes a global binding and offers no per-session selection, so this mode is entered through RPC (`controller_activate` / `controller_select_other`) or by editing the Profile patch.
- **Provider Choice**: `controller_activate` selects DSH BrowserWorkbench; `controller_select_other` selects a pre-existing third-party browser tool in the current Profile.
- **Exclusive Locking**: When BrowserWorkbench is selected, all 30 tools are bound to the current Agent Scope; identical tool names from third parties are shadowed, and exclusive third-party browser tools are hidden for that Session only. Selecting third-party tools leaves BrowserWorkbench dormant without creating browser resources.
- **Persistence Across Restarts**: Selection choices are persisted in schema v2 records (`$DSH_HOME/browser-tools/controller/sessions/`). Sibling sessions remain independent, and choices resume cleanly after DSH restarts or Agent Scope replacements.
- **Session Locking Rule**: Plugin choice cannot be switched mid-session to prevent cross-plugin reference pollution. Switching tools requires opening a new Session.
- **Release Preserves Choice**: Releasing BrowserWorkbench via `controller_release` disconnects CDP and clears page views without unbinding the tool selection. Re-invoking tools simply prompts reconnecting the Provider.
- **Third-Party Non-Interference**: BrowserWorkbench never stops, modifies, or uninstalls third-party plugins.

### 3. Disabled Mode (`disabled`)

```yaml
- id: browser-tools
  config:
    toolRegistrationMode: disabled
```

Registers no `browser_*` tools at all and allocates no browser resources, handing browser capability to other plugins (this is what the settings page's "Disable this plugin" writes).

- **No tools for the Agent**: `browser_*` never appears on the tool surface.
- **Panel unavailable**: the panel and every session-level RPC endpoint return "DSH BrowserWorkbench is currently disabled, the browser panel is unavailable".
- **State still observable**: `controller_status` returns `registrationMode: 'disabled'`, `mode: 'unselected'`, `blockers: ['browser-tools-disabled']`; `controller_overview` still reports the current binding.
- **Recoverable**: picking any binding again on the settings page writes the config back and hot-reloads.

Controller RPC endpoints (mounted under authenticated route `/api/browser-tools`):

| Endpoint | Session-scoped | Description |
| --- | --- | --- |
| `controller_overview` | No | Settings-page data source: `registrationMode`, `configuredMode`, `configurable`, `configurableMessage?`, `providerMode`, `choice`, `endpoint?`, plus `sessions` (`[{ sessionId, createdAt?, snapshot }]`, aggregated from `BrowserController.list()`). |
| `controller_set_browser_choice` | No | Writes the global binding: `{ choice: 'workbench' \| 'existing' \| 'off', endpoint? }`; `existing` requires a valid endpoint, otherwise it returns "connecting to an existing Chrome/Edge requires a debugging endpoint, e.g. http://127.0.0.1:9222". |
| `controller_status` | Yes | Returns the current registration mode and arbitration snapshot; under `disabled` it returns `registrationMode: 'disabled'`, `mode: 'unselected'`, `blockers: ['browser-tools-disabled']`. |
| `controller_activate` | Yes | Selects BrowserWorkbench under `session-select`. |
| `controller_select_other` | Yes | Selects third-party browser tools under `session-select`. |
| `controller_release` | Yes | Releases runtime resources without changing generations or unbinding tools. |

`controller_activate` and `controller_select_other` are only allowed in the `unselected` state; under `disabled` they return "browser capability has been handed to another plugin, DSH BrowserWorkbench registered no tools". `controller_release` frees runtime resources but does not change generations or unbind tools. The former `controller_set_registration_mode` endpoint was removed: registration mode is no longer rewritten directly by an endpoint but changes indirectly through `controller_set_browser_choice` and the config write-back.

## State Models & Isolation

- **Default State**: New Sessions start `disconnected`; no browser is launched eagerly.
- **Automatic Launch**: With `providerMode: auto` (default), the first browser tool call in a session (or the panel's "+" new-tab action) launches that session's dedicated persistent Chromium; later calls reuse it. With `providerMode: external` nothing is launched; the session auto-connects the `externalCdpEndpoint` written by the settings page instead (see "External CDP Auto-Connect").
- **Per-Session Isolation**: Each session uses its own user-data-dir (`$DSH_HOME/browser-tools/profiles/sessions/<session>/default`); pages, cookies, login state, and the browser process are never shared, even across sessions of the same project.
- **Optional External Connection**: Entering a remote debugging address (e.g. `http://127.0.0.1:9222`) on the settings page's "Connect to existing Chrome / Edge" makes every session auto-attach to the user's running Chrome/Edge on first need; an explicit `browser_provider connect` still works too. `providerMode: external` allows only this path.
- **Shared Across Sessions** (only when several sessions attach to the same external browser): Cookies, LocalStorage, SessionStorage, IndexedDB, Cache Storage, HTTP caches, Service Workers, and browser permissions remain natively owned by that browser instance.
- **Isolated Per Session**:
  - Browser pages, tabs, popups, and tab navigation history.
  - Active viewport focus, split-view geometry, and adaptive layout state.
  - CDP debugger sessions, breakpoints, stepping state, and call frames.
  - Network request interception journal, paused requests, and mock rules.
  - ARIA element references (refs), snapshot diffs, and screencast frame streams.
  - Forensic Checkpoints, Flight Recorder logs, and disk artifacts.
  - Human takeover locks and ownership state.
- **Safe Teardown**: Calling `browser_provider disconnect` drops the CDP protocol transport without closing or killing the user's browser.

## Security & Isolation Invariants

1. **Protocol Restriction**: Only HTTP and HTTPS page navigations are permitted. Embedded credentials in URLs are rejected.
2. **Authenticated Host RPC**: Communication routes strictly through Connection-authenticated `/api/browser-tools`. Non-JSON requests return `400`, unauthenticated requests return `401`.
3. **Directory Traversal Protection**: Uploads and downloads are bound to explicit directories (`uploadRoots` and `artifactRoot`). Path escaping and symlink traversal are rejected.
4. **Credential Redaction**: Debugger scopes, network logs, and console entries automatically redact sensitive headers, cookies, tokens, and passwords.
5. **Approval Policies**: `browser_evaluate` is always classified as a sensitive operation requiring approval. When `subagentInteractive=false`, subagents are barred from interactive write actions.
6. **Clipboard Protection**: Takeover paste handling only receives the final PasteEvent without reading or storing host system clipboard history.
7. **Human Challenge Safety**: CAPTCHA, SMS/email verification codes, Passkey/WebAuthn, and device confirmation prompts require immediate automated cessation and human takeover.
8. **Viewport Generation Safety**: Adaptive live view uses host initialization states, serial size reports, and viewport generations to reject stale dimensions from overriding stable viewports.

## Internal Identifiers

The following stable identifiers are preserved for backwards compatibility with existing sessions, controller evidence, and configuration stores:

```text
Controller mode/id: dsh-browser-tools
RPC Endpoint: /api/browser-tools
Data directory: $DSH_HOME/browser-tools
LocalStorage prefix: dsh-browser-tools.*
Cordis plugin id: browser-tools
```

## 30 Agent Tools

### 1. Navigation & Page Operations (14 tools)

| Tool | Core Parameters | Description |
| --- | --- | --- |
| `browser_tabs` | `action`: list/new/select/close, `viewId`, `index`, `url` | Manage browser tabs within the current DSH session. |
| `browser_navigate` | `url`, `viewId`, `timeoutMs` | Navigate the active tab to a complete HTTP/HTTPS URL. |
| `browser_navigate_back` | `viewId`, `timeoutMs` | Navigate back in history with parallel polling for bfcache resilience. |
| `browser_snapshot` | `viewId`, `includeDiff`, `maxNodes` | Return compact ARIA snapshot, refreshed short-lived refs, and bounded diffs. |
| `browser_click` | `ref`, `viewId`, `timeoutMs` | Click an element identified by a snapshot or query ref. |
| `browser_hover` | `ref`, `viewId`, `timeoutMs` | Hover over an element identified by a snapshot ref. |
| `browser_scroll` | `ref`, `direction`, `amount`, `deltaX`, `deltaY` | Scroll an element into view or scroll the page. |
| `browser_type` | `ref`, `text`, `clear`, `submit`, `slowly` | Type text into an editable element ref. |
| `browser_press_key` | `key`, `ref`, `viewId` | Dispatch a keyboard keypress to the focused page or a specific ref. |
| `browser_select_option` | `ref`, `values` | Select option elements in a dropdown identified by ref. |
| `browser_wait_for` | `text`, `textGone`, `state`, `time`, `timeMs` | Wait for text appearance, disappearance, DOM state, or timeout. |
| `browser_get_attribute` | `ref`, `name` | Read a non-sensitive attribute from an element ref. |
| `browser_query` | `selector`, `field`: count/text/visible/attribute/refs | Execute bounded CSS selector queries without running untrusted JavaScript. |
| `browser_handle_dialog` | `accept`, `promptText` | Accept or dismiss alert/confirm/prompt dialogs. |

### 2. Observation, Files & Network (6 tools)

| Tool | Core Parameters | Description |
| --- | --- | --- |
| `browser_take_screenshot` | `viewId`, `fullPage` | Capture a PNG screenshot and persist it in the DSH attachment store. |
| `browser_console_messages` | `viewId`, `clear` | Read bounded console messages, warnings, and errors for the selected tab. |
| `browser_network_requests` | `viewId`, `clear` | Inspect bounded, URL-redacted network requests in chronological order. |
| `browser_upload_file` | `ref`, `filePath` | Securely upload a local file from an approved upload root. |
| `browser_download` | `ref`, `timeoutMs` | Trigger a download via element click and save it in the artifact store. |
| `browser_network_control` | `action`: enable/disable/list_paused/continue/abort/fulfill/body/replay | Control Fetch interception, inspect/mock response bodies, and resume traffic. |

### 3. Debugging & Runtime Environment (6 tools)

| Tool | Core Parameters | Description |
| --- | --- | --- |
| `browser_debugger` | `action`: attach/detach/pause/resume/step_over/step_into/step_out/call_frames/scripts/script_source/source_map/scope_variables/set_breakpoint/remove_breakpoint` | CDP JavaScript debugger stepping, call stack inspection, and Source Map retrieval. |
| `browser_diagnose` | `action`: start/status/inspect/checkpoint/compare/report/stop/recorder_*` | Diagnostic sessions, Checkpoints, 4-signal Comparators, Incident reports, and Flight Recorder. |
| `browser_profile` | `action`: trace_start/trace_stop/playwright_trace_start/cpu_start/coverage_start/heap_snapshot/heap_sampling_start/artifacts/artifact_read` | Collect Trace, CPU profile, code coverage, and Heap Snapshot artifacts. |
| `browser_emulate` | `action`: viewport/device/locale/timezone/network/cpu/offline/permissions/reset` | Emulate viewport dimensions, mobile devices, timezone, network throttling, and permissions. |
| `browser_evaluate` | `action`: isolated/main_world/paused_frame, `expression`, `awaitPromise` | Safely evaluate JavaScript in an isolated world, main world, or paused stack frame. |
| `browser_provider` | `action`: list/connect/disconnect/capabilities, `provider`: managed/external-cdp, `endpoint` | `managed` launches this session's dedicated browser; `external-cdp` attaches to an existing Chrome/Edge debugging endpoint |

### 4. Workbench & Control Ownership (4 tools)

| Tool | Core Parameters | Description |
| --- | --- | --- |
| `browser_live_view` | `action`: status/standard/adaptive | Query or switch live display modes (standard 1280x720 or adaptive reflow). |
| `browser_split_view` | `action`: status/open/close/swap/assign/focus/ratio/orientation | Control two-page split view orientation, pane assignment, and ratio. |
| `browser_extensions` | `action`: list | Read-only endpoint for inspecting historical extension registry entries. |
| `browser_takeover` | `action`: status/request/return/cancel | Manage exclusive human control; while active, Agent write actions return `USER_TAKEOVER_ACTIVE`. |

## Live-Only Panel

The client panel is now a single view: `src/client/components/panel/BrowserPanel.tsx` renders exactly three parts — `TabBar` (tabs), `NavigationBar` (address bar plus back/forward/refresh), and `LiveView` (screencast, human takeover, split view, drag-to-share, close panel). On activation it always calls `controller.update(sessionId, tab.id, 'live')`; there is no view routing any more.

- **Screencast**: live frame stream plus in-panel mouse/keyboard takeover; the `standard`/`adaptive` modes of `browser_live_view` are unchanged.
- **Split view**: the open/close/swap/assign/focus/ratio/orientation semantics of `browser_split_view` are unchanged.
- **Diagnostics and performance**: the panel's "Open diagnostics" button and the Recorder (Rolling/Deep/stop/mark) controls were removed, while the `browser_diagnose` and `browser_profile` Agent tools keep their full capability; on the client only `views/live/DiagnosticOverlay.tsx` (used by `LivePane`) remains for on-site hints.
- **Panel lifecycle**: the tab bar and right-sidebar tab lifecycle are still governed by DSH native Tab mechanisms with strict per-session isolation.

### 1. Panel Entry

`sidebarRightTabs` registers the panel together with a `guide` card, so the right sidebar's "Get started" page shows a "Browser live view" entry:

| Field | Value |
| --- | --- |
| `id` / panel id | `live` / `dsh-browser-workbench/browser` |
| `order` | `20` |
| `title` | "Browser live view" |
| `description` | "Watch and take over the browser the Agent is driving" |
| `icon` | `BrowserGlyph` (`src/client/components/common/BrowserGlyph.tsx`) |

`conversation.input.right` is no longer registered: there is no binding control next to the composer, and no `useAutoReveal` auto-opened panel. Binding is chosen on the settings page; the live view is opened from the right sidebar.

### 2. Settings-Page Binding Section

`src/client/index.tsx` registers `settings.section` through `ctx.effect`: `id: 'browser'`, `order: 60`, label "Browser", component `src/client/components/settings/BrowserSettingsSection.tsx`. The component uses inline styles exclusively, because CSS Modules do not apply inside the host settings scope.

- **Three binding cards** (radiogroup "Browser tool binding"): `workbench` "DSH BrowserWorkbench" (launches a dedicated Chromium, isolated per session), `existing` "Connect to existing Chrome / Edge" (launches nothing, reuses the user's login state and extensions, expands a debugging-endpoint input defaulting to `http://127.0.0.1:9222`, with Windows/macOS launch commands and a `/json/version` validation hint), and `off` "Disable this plugin".
- **State and degradation**: shows the active binding and browser session list from `controller_overview`; when the binding is not writable it points at `~/.dsh/profiles/<profile>/cordis.patch.yml`, entry `- id: browser-tools`; when the runtime-effective value differs from configuration it warns that another browser plugin may have taken over.
- **Immediate effect**: switching writes the configuration back and triggers a hot reload, after which the panel refreshes.

### 3. Navigation Icon Patch

The host's `settings.section` registration takes no icon argument, and the left navigation row icon is hard-coded by the host's `navIcon(id)` as a gear. `src/client/settings-nav-icon.ts` watches the settings dialog with a `MutationObserver`, claims the "Browser" row by label text, tags it with `data-dsh-browser-nav-icon`, and replaces the gear with a browser-window mask SVG via `::before`. The approach mirrors a patch used by the community plugin dshmarket and is disposed together with `ctx.effect`.

## Binding Write-Back Path

The settings page's three-way choice does not mutate runtime objects directly; it writes the Profile patch through the host configuration editor:

| Choice (`BrowserToolChoice`) | Profile patch written |
| --- | --- |
| `workbench` | `toolRegistrationMode: global`, `providerMode: auto` |
| `existing` | `toolRegistrationMode: global`, `providerMode: external`, `externalCdpEndpoint: <endpoint>` |
| `off` | `toolRegistrationMode: disabled` |

`src/compat/config-editor.ts` implements the path: `ctx.get('configEditor')` obtains the host `@deepseek-ai/dsh-config-editor` service → `entries()` finds the entry with `id: 'browser-tools'` → `edit(entry, current => ({ ...current, ...browserChoicePatch(choice, endpoint) }))` writes `~/.dsh/profiles/<profile>/cordis.patch.yml` → the host triggers a Cordis hot reload. `browserChoiceOf()` reads the current three-way choice back from the entry, and `browserSettingsWriteState()` reports whether writing is possible.

All three failure cases (no config-editor service, missing entry, entry overridden by a home patch) return readable messages instead of failing silently, for example "the current DSH build provides no configuration editor service, so the browser binding can only be edited in the Profile patch by hand" and "the Profile patch has no configuration entry with id browser-tools, so the binding cannot be written back". Exports: `BROWSER_ENTRY_ID`, `browserChoicePatch`, `browserChoiceOf`, `browserSettingsWriteState`, `writeBrowserChoice`.

## External CDP Auto-Connect

With `providerMode: external` and a configured `externalCdpEndpoint`, the session connects straight to that endpoint the first time it needs a browser, without an explicit `browser_provider connect`:

1. `RuntimeCoreFoundation.ensureAutoProvider()` first checks `session.providerBinding.kind === 'disconnected'` and returns immediately when already connected or connecting.
2. When `providerMode === 'external'` and `externalCdpEndpoint` is non-empty, `assertCdpEndpoint()` validates it and `connectExternalCdp(endpoint, externalCdpTimeoutMs, …)` attaches.
3. On success it writes `session.providerBinding = { kind: 'external-cdp', ...connection, endpoint }`; later tool calls reuse that binding.
4. On failure it raises `PROVIDER_UNAVAILABLE`: "connecting to the browser with remote debugging enabled failed (`<endpoint>`): … Make sure the browser was started with `--remote-debugging-port`."

An empty endpoint disables auto-connect and falls back to an explicit `browser_provider connect`. Safe teardown is unchanged: disconnecting only drops the CDP transport and never kills the user's browser.

## Removed Client Modules

Modules removed by the panel slimming; neither documentation nor code exposes their entry points any more:

| Removed | Former purpose |
| --- | --- |
| `src/client/components/views/{console,debugger,diagnostic,emulation,extensions,network,performance,provider}/` | The eight non-live view component directories |
| `src/client/components/control/{BrowserControl,ControllerMenu,ArbitratedToolsDialog}.tsx` | Composer binding control, controller menu, arbitration tools dialog |
| `src/client/hooks/{useAutoReveal,useControllerBinding,usePanelSync}.ts` | Auto-open panel, binding-state subscription, panel sync |
| `controller_set_registration_mode` (RPC endpoint) | The old registration-mode write path, superseded by the config write-back behind `controller_set_browser_choice` |

`LiveView.tsx`, `LivePane.tsx`, `LiveControls.tsx`, and `DiagnosticOverlay.tsx` remain under `src/client/components/views/live/`.
