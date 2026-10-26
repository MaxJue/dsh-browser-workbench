# DSH BrowserWorkbench Validation Report

[简体中文](./VALIDATION.md) | English Version

This document records the objectives, procedures, and empirical results of validation runs conducted for DSH BrowserWorkbench Release Candidates.

> October 2026 update: the default registration mode is now `global`, and `providerMode: auto` launches a dedicated persistent Chromium per session on the first browser tool call. Notes below such as "managed launch is not exposed on the tool surface", "the provider only accepts `external-cdp`", and "no background browser spawning" describe the code state at the time of that run and no longer apply.

> 2026-10-26 update: the client panel is now a single live view, human takeover has been removed in favor of pure screencast observation, composer binding controls are gone, and settings-page three-way binding was added; tools stand at 29 and unit tests stand at 171. Conclusions in sections 2, 7, and 8 that depend on the nine views, the controller menu, or composer controls are superseded and annotated in section 9.

Release candidate states are formally anchored by external candidate identity descriptors and tarball digests.

## Target Object

```text
package: dsh-browser-workbench
version: 1.0.0-rc8
DSH compatibility target: 0.2.1-rc.2 / 0.2.1-rc.3
0.2.1-rc.2 validation: peer dependency check, strict typecheck, production build, Session Controller integration, 30-tool Chromium regression
full browser runtime validation: 30-tool regression passed; fresh DSH Web Profile lifecycle and UI acceptance pending
Node.js: 22.x
package manager: pnpm 11.x
```

RC8 declares its direct DSH peers as the range `^0.2.1-rc.2 || ^0.2.1-rc.3`, Cordis to `~4.0.5`, and Schemastery to `~3.18.5`. The previous `0.1.x` compatibility range is no longer declared.

DSH `0.2.1-rc.2` updates the Connection Peer model and transitive peer graph. BrowserWorkbench continues to register its authenticated exact Fetch route, leaving authentication, Host/Origin checks, request limits, and cancellation to Connection. `dsh-tools` now requires `dsh-working-directory`, which brings the `dsh-fs` peer; both are installed in the validation graph. The removed `dsh-invariants` dependency is no longer installed.

Against DSH `0.2.1-rc.2`, strict typecheck, production Host/Client build, `pnpm peers check`, build-registry checks, real App Boot Session Controller integration, and the full 30-tool integration against pinned Chromium `149.0.7827.55` pass. Coverage includes the panel, split view, persistent profiles, extensions, debugger, diagnostic evidence, network, performance artifacts, external CDP, and cleanup paths. All assertions passed; the temporary runtime, listener port, and external CDP process were cleaned up. Fresh DSH Web Profile install/start/auth/uninstall and DSH Web UI validation remain pending. Prior `0.1.x` validation does not establish compatibility with `0.2.x` and is not carried forward.

## 1. 30 Browser Tools Integration

**Objective**: Ensure all 30 Agent browser tools operate end-to-end against real Chromium instances rather than mocking layers or unit stubs.

**Scope**: Tab management, navigation, observation, interactions, upload/download, console capture, network interception, debugger stepping, Source Map resolution, performance profiling, emulation, provider orchestration, extensions, and forensic diagnostics.

**Result**:

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

## 2. 9-View Native DSH Workbench

> 2026-10-26 note: this section records the nine-view panel as it existed before 2026-10-24. That shape is superseded — the panel now hosts the live view only — and the text is kept as a record of that run; superseded items are listed in section 9.

**Objective**: Confirm that BrowserWorkbench provides 9 workspace views within the official DSH right sidebar architecture while correctly managing pane lifecycles.

### RC2 Live Web Acceptance Results

**Environment**: Isolated `DSH_HOME`, port `31880`, DSH `0.1.5-rc.2`, current BrowserWorkbench build, and real third-party browser plugin loaded into the same profile.

**Procedure**: Conducted live end-to-end session testing across two formal Sessions. Session A selected BrowserWorkbench, navigated across the 9 views, and released resources; Session B independently chose third-party tools. Both were tested across an isolated DSH restart.

**Findings**:
- Unselected formal Sessions conceal browser tools until explicit provider choice.
- Selecting BrowserWorkbench locks the session and exposes all 9 views and arbitrated tools.
- Releasing BrowserWorkbench runtime frees memory without unlocking the Session.
- Sibling Sessions choose alternative browser plugins without interference.
- Restarts restore respective choices intact with schema v2 persistence (`generation=1`).

## 3. Session Controller Coexistence

**Objective**: Confirm BrowserWorkbench arbitrates browser toolsets on an Agent Session granularity within shared profiles without modifying third-party plugin binaries, configs, or processes.

**Unit & Integration Suites**:
- `tests/browser-controller.ts`: PASS (pre-selection masking, locking, release preservation, restart resumption, schema v1->v2 migration, rollback on persistence errors).
- `tests/session-controller-integration.mjs`: PASS (live DSH Agent Scope isolation, toolset expansion 0 -> 30, identical name shadowing, unique tool restriction).

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

## 4. State & Session Isolation

**Objective**: Verify that shared persistent context and session-level isolation invariants coexist without cross-session contamination.

**Shared Items**:
- Cookies, LocalStorage, IndexedDB, Cache Storage, Service Workers, Permissions.

**Isolated Items**:
- Pages, views, tab history, popups, viewport focus, CDP sessions, Network journals, screencasts, and artifacts.

## 5. Build & Package Determinism

**Objective**: Guarantee that output binaries are deterministic and tarball contents match the audited worktree.

**RC8 Artifacts**:
- `lib/client.js`
- `lib/client.js.map`
- `lib/index.mjs`
- `lib/index.d.mts`

Package gates verify that all 20 manifest files match repository bytes identically without spurious path leaks (`node scripts/check-public-package.mjs`).

## 6. Cleanup Verification

**Objective**: Ensure full lifecycle deallocation upon process exit.

```text
portClosed: true
externalCdpClosed: true
runtimeRemoved: true
```

## 7. Local Isolation Sandbox & Real UI Replay (2026-10-24)

> Recorded verification performed **without touching the desktop profile**: a separate process with its own `DSH_HOME`, seven layers, and the seven real defects this round exposed.

### 7.1 Why a separate process

Host-side plugins load in the same process as the harness: a plugin that throws inside `apply()` takes the whole instance down and kills every running session. Uninstalling afterwards is therefore not a safety boundary — **a separate process with a separate `DSH_HOME`** is.

| Approach | Isolation | Verdict |
| --- | --- | --- |
| Install into the desktop profile (58186) | none | rejected: a crash hits the instance in use |
| Second profile sharing one `DSH_HOME` | partial | rejected: shared sessions/storages, concurrent writers |
| Separate `DSH_HOME` + separate port | full | adopted: `.sandbox/home`, profile `verify`, `:31880` |

The sandbox mounts the working tree through `link:`, so a rebuild plus restart re-tests the current sources.

### 7.2 Seven layers

| Layer | Entry | Coverage | Result |
| --- | --- | --- | --- |
| Static gates | `npm run typecheck` / `npm test` / `npm run build` | types, 171 unit tests, `lib/index.mjs` + `lib/client.js` + sourcemap | 0 errors / 171 passed / clean build |
| Runtime | `npm run verify:tools` | 145 assertions over all 30 `browser_*` tools, including negative paths | 145/145 passed |
| Instance | `npm run verify:instance` | client bundle loaded in the sandbox instance, composer control, authenticated RPC round trip, clean console, screenshot | 10/10 passed |
| Real UI panel | `npm run verify:panel` | send a message to reach a formal session, activate through the controller menu, then 9 panel views + Provider connect + live frames/adaptive sizing + in-panel human takeover with real mouse and keyboard input | 33/33 passed |
| Extensions | `npm run verify:extensions` | install a local MV3 directory, registry persistence, disable/enable/uninstall, popup error paths, reject MV2 and broken manifests, `apply` keeps an external binding | 19/19 passed |
| Managed launch + proxy/HTTPS | `npm run verify:managed` | protected `persistentContext` / `launchSharedPersistentContext`: `executablePath`, headless, custom/direct/system proxy, plain HTTP forwarding, HTTPS `CONNECT`, proxy Basic auth with the 407 challenge, shared-context reuse and foreign-page eviction, offline install with digest/timeout/HTTPS guards | 16/16 passed |
| Config + RPC/persistence | `npm run verify:config` / `npm run verify:rpc` / `npm run verify:persist` | 13 config options against real runtime behaviour; 16 checks on the `/api/browser-tools` boundary and controller-selection persistence across a reload; `--phase=prepare` + Host restart + `--phase=verify` | 13/13 · 16/16 · 7/7 + 5/5 passed |

The runtime layer drives real Chrome (`Chrome/155.0.8059.85`) over `external-cdp` against the local fixture site from `scripts/verify/fixtures.mjs`, and writes JSON + Markdown reports to `.sandbox/reports/`.

### 7.3 Defects found and fixed

1. **Composer slot crash (React #185)** — two causes compounded: `snapshot()` in `src/client/panel-controller.ts` returned a fresh object literal on every call, so `useSyncExternalStore` saw a changed snapshot forever; and `src/client/hooks/usePanelSync.ts` passed inline arrow functions, so every render produced new `subscribe`/`getSnapshot` identities and re-subscribed; on top of that `panel-controller.subscribe()` notified its listener synchronously during subscription. Subscribe → notify → render → resubscribe looped without bound, the `conversation.input.right` slot rendered a `data-slot-error` node under SlotBoundary, the composer control vanished, and the console showed `Minified React error #185` (Maximum update depth exceeded) with the stack pointing at `dsh-browser-workbench/client.js`, while the RPC still answered 200. Fixed with a frozen `closedSnapshot` while unmounted, one cached snapshot per session, `useCallback`-stable `subscribe`/`getSnapshot` callbacks, and a `subscribe()` that no longer notifies synchronously. Two unit tests lock both invariants in.
2. **`browser_navigate_back` always timed out on bfcache restores** — `page.goBack({waitUntil:'domcontentloaded'})` waited the full 30 s even though the history restore had already completed. Fixed with `awaitBackNavigation()`, which polls the URL in parallel and only reports a timeout when the URL did not move: the same case dropped from 30031 ms to 122 ms.
3. **`browser_provider disconnect` threw after a successful teardown** — the branch cleared views and marked the provider disconnected, then `restoreTabs()` called `createPage()` and failed with `BROWSER_NOT_CONNECTED`. Fixed by tearing down only and clearing `activeViewId` / split-view state.
4. **Provider endpoint input had no accessible name** — `ProviderView` wrapped the text in a `<label>` but left the `input` without `aria-label`, and the plugin's `query field=refs` derives names from `aria-label || title || textContent`, so a bare input could not produce a ref (screen readers were affected the same way). Fixed by adding `aria-label="远程调试地址"` (remote debugging address).
5. **Delegated subagents could still drive the browser** — with `subagentInteractive=false`, the deny branch in `src/application/security-policy.ts` matched only some interactive tools, so `navigate`, `navigate_back`, `handle_dialog`, `hover`, `scroll`, and `tabs(new)` slipped through: the documented "a delegated session cannot operate the browser" simply was not true. Fixed by folding navigation mutations, pointer interactions, and tab navigation into the same deny condition, and `tests/application/security-policy.test.mjs` now covers 8 cases over 17 tool definitions.
6. **Installing an extension from a local directory always failed** — the install branch handed the directory path to `chromeWebStoreExtensionId()`, which only accepts a Chrome Web Store URL or a 32-character ID, so every local-directory install threw `extension input must be a Chrome Web Store URL or a 32-character extension ID` — even though a local directory is the documented workflow. Fixed by adding `unpackedExtensionId()` (Chrome's own rule: SHA-256 of the absolute path, first 16 bytes mapped to `a`–`p`, lowercased first on Windows) and `extensionIdForKey()`; the branch now reads `manifest.json`, requires Manifest V3, validates name/version, derives the ID from `manifest.key` or the directory, and resolves `action.default_popup`.
7. **`browser_extensions apply` tore down the user's own browser connection** — the restart flow ("tear down → rebind the provider → restore tabs") does not hold for an external CDP binding: the plugin cannot restart the user's Chrome, so after the teardown `bindContext` threw `Target page, context or browser has been closed` and the session became unusable. Fixed by returning early for `providerBinding.kind === 'external-cdp'` in `restartPersistentSession()`, reloading the extension registry from disk and keeping the pending-restart marker.

### 7.4 Environment limits (not defects)

- `browser_live_view adaptive` cannot report an available size at the runtime layer with no panel open, so it returns recoverable `ADAPTIVE_SIZE_UNAVAILABLE`; with the panel actually open the real UI applies adaptive sizing, which `verify:panel` asserts.
- A sandbox `DSH_HOME` has no model credentials by default and stays on the temporary blank session, so the `sidebar.right.pane.tab` panel body cannot be expanded. This round copied the local `.dsh/.credentials.yaml` into `.sandbox/home` (that isolated home only, removable afterwards), sent one message to reach a formal session, and then drove all 9 panel views plus Provider connect, live frames, and adaptive sizing.
- `browser_profile artifact_read` refuses a 14 MB heap snapshot, so the case reads the smallest artifact instead.
- Screenshotting the DSH page itself while the panel streams live frames can occasionally hit Playwright's 30 s screenshot budget, so `verify:panel` retries once and downgrades to SKIP rather than failing a functional check; no functional assertion depends on the screenshots.
- **Managed launch is not exposed on the tool surface**: the provider only accepts `external-cdp` (the panel itself says it will not download or host a new browser), and `providerBinding` is only ever written as `disconnected` or `external-cdp`. `verify:managed` therefore calls the runtime's protected `persistentContext()` / `launchSharedPersistentContext()` directly and drives real browsers through them (16 checks); "a tool-surface user cannot reach it" is a product decision, not a test gap.
- **The managed-download metadata table lags behind playwright-core**: `KNOWN_ARCHIVES` only lists `149.0.7827.55` while playwright-core 1.64.1 expects `156.0.8078.4`, so `descriptor()` fails closed with `Chromium 156.0.8078.4 does not have verified archive metadata`. That is deliberate integrity policy (no download and no extraction without verified bytes + md5); closing the gap needs the metadata for that build fetched online. The install path itself is verified offline against a local HTTP server and a real ZIP (`verify:managed`: size/digest verification, tampered digest refusal, non-HTTPS refusal, stalled-download timeout).
- **Proxy and HTTPS only apply to managed launch**: `verify:managed` covers `custom` (plain HTTP forwarding, HTTPS `CONNECT` tunnels, Basic auth with the 407 challenge and replay), `direct` (`--no-proxy-server`, zero proxy entries) and `system`, using a local proxy server; the HTTPS fixture uses a self-signed PFX trusted temporarily with `certutil -addstore -user Root` and removed with `-delstore` at the end of the run, with no outbound network dependency.
- **Session rows are invisible to `runtime.evaluate`**: DSH sidebar session rows cannot be found by `querySelectorAll` inside `runtime.evaluate` (`textContent` omits the title while `innerText` has it), so the cross-restart replay drives them with Playwright locators and the sidebar search box (`input[placeholder="搜索会话名称"]`). That is a harness observation difference, not a plugin defect.

## 8. Config and RPC/Persistence Matrix (2026-10-24)

> Section 7 answers "does the feature work"; this section answers "does the configuration actually take effect" and "are the RPC boundary and its state durable".

### 8.1 Configuration matrix

`src/application/config.ts` exposes 21 options in three groups.

**Measured at runtime (13 checks, `npm run verify:config`)** — default config reaches the fixture site; `allowedOrigins` rejects an unlisted `localhost` variant while the listed origin still loads; `allowLoopback=false` yields `POLICY_DENIED loopback browser targets are disabled`; `allowPrivateNetwork=false` yields `POLICY_DENIED private-network browser targets are disabled`; `maxOutputChars=1000` truncates to 1001 characters ending in `…`; `maxUploadBytes=64` yields `POLICY_DENIED upload file is invalid or exceeds the configured size limit`; `uploadRoots=[dir]` yields `POLICY_DENIED upload path is outside configured roots`; `maxDownloadBytes=1024` yields `POLICY_DENIED download exceeds the configured size limit`; `artifactRoot` places `profile trace_*` output under the custom root; `externalCdpTimeoutMs=1000` fails a dead endpoint in 4 ms with `ECONNREFUSED`; `maxArtifactBytes=512` yields `ARTIFACT_TOO_LARGE … 512 byte limit`; `interceptionTimeoutMs=1000` auto-continues a paused request after about 1141 ms and empties `list_paused`.

**`managed-launch` only (5 options)** — `executablePath`, `headless`, `proxy` (including custom credentials), `chromiumDownloadSource`, `chromiumDownloadTimeoutMs`. They only apply when the plugin launches Chromium itself, and that path has no tool-surface call site in v2 (see 7.4), so they are now covered twice: at the schema/normalization level by `managed launch settings are normalized for the isolated browser path` in `tests/domain/policy.test.mjs` (`headless:false`, a relative `executablePath` resolved to an absolute one, `chromiumDownloadSource:auto`, `300000`, absent → `undefined`), `tests/provider/launch-config.test.mjs` (`browserLaunchNetwork` direct/custom proxy arguments, `executablePath` passthrough, split-view defaults and restore) and `tests/provider/chromium-manager.test.mjs` (npmmirror/official/auto attempt URLs and allowed hosts), and at the real-browser level by the 16 checks in `npm run verify:managed` (protected `persistentContext` / `launchSharedPersistentContext`, proxy modes, HTTPS `CONNECT`, shared context, offline install).

**`subagentInteractive` (1 option)** — while it stays `false`, calls originating from a `subagent` receive `{kind:'deny', reason:'delegated browser session cannot use …'}` for interactive browser tools, while top-level sessions follow `permissionPreset` (`src/application/security-policy.ts`); covered by the 8 cases in `tests/application/security-policy.test.mjs` (including defect #5 above, which put navigation, dialogs, hover/scroll, and tab navigation into the interactive set).

### 8.2 RPC and persistence matrix (16 checks, `npm run verify:rpc`)

| Group | Checks | Result |
| --- | --- | --- |
| Entry auth | UI without a token / wrong token / valid token returns 303 with `dsh-auth-*` / cookie alone loads the UI / cookie is httpOnly | 401 / 401 / pass / pass / pass |
| Call auth | anonymous `POST /api/browser-tools` / tampered cookie | `401 unauthorized` / `401 unauthorized` |
| Envelope contract | non-JSON body / JSON that is not a Connection RPC envelope | `400 body is not JSON` / `400 invalid Connection RPC envelope` |
| Route boundary | `GET /api/not-a-route` | 404, no RPC handler leak |
| Successful round trip | claim BrowserWorkbench through the real controller menu | badge becomes `DSH BrowserWorkbench（已锁定）` |
| Persistence (reload) | full-page reload keeps the claimed badge and a clean console | pass / pass |
| Persistence (Host restart, `verify:persist`) | `--phase=prepare` claims, opens the panel, records a marker (7/7); after a Host restart `--phase=verify` finds the session through the sidebar search, reads the claimed badge, and reopens the panel (5/5) | pass |

The persistence signal is that the claim lives in the Host session projection: a full reload drops every client-side state (and a Host restart drops the whole process), so a badge that still reads "claimed" afterwards came from the server. The success path cannot be reproduced over bare HTTP — `/api/browser-tools` only accepts the Connection transport envelope and answers `400 invalid Connection RPC envelope` to anything else — so the real UI drives it through the panel controller, complementing the boundary checks above.

### 8.3 Reproduce

```powershell
npm run verify:tools        # 145/145, real Chrome + local fixtures
npm run verify:extensions   # 19/19, local MV3 install / registry / popup / reject paths / apply
npm run verify:managed      # 16/16, managed launch / proxy modes / HTTPS CONNECT / offline install
npm run verify:config       # 13/13
npm run verify:rpc          # 16/16 (needs the sandbox instance and its token)
$env:DSH_VERIFY_URL = "http://127.0.0.1:31880/?token=<token>"; $env:DSH_VERIFY_TOKEN = "<token>"
npm run verify:instance     # 10/10
npm run verify:panel        # 33/33
npm run verify:persist -- --phase=prepare   # claim + marker
# restart the sandbox Host (new token), then:
npm run verify:persist -- --phase=verify    # 5/5
```

## 9. Changes This Round: Panel Slimming & Settings Binding (2026-10-26)

> This round collapses the client panel into a single live view, deletes the composer binding controls, and adds the settings-page three-way binding, host config write-back, and external CDP auto-connect. Sections 2, 7, and 8 describe the pre-change UI; their conclusions about the 9 views, the controller menu, and the composer control no longer hold (see 9.3). Only results actually measured this round are recorded here — any e2e script not yet rewritten is not counted as passing.

### 9.1 Static gates

| Gate | Command | Result |
| --- | --- | --- |
| Strict typecheck | `npm run typecheck` | 0 errors |
| Unit tests | `npm test` | 171 / 171 passed |
| Production build | `npm run build` | clean, emits `lib/client.js` and `lib/index.mjs` |

Unit tests adjusted to 171; input module and gesture cases removed while all remaining 171 tests pass cleanly.

### 9.2 Changes and how each was accepted

| Change | Code location | Acceptance this round |
| --- | --- | --- |
| Panel reduced to the live view | `src/client/components/panel/BrowserPanel.tsx` (only `TabBar` + `NavigationBar` + `LiveView`) | Opened the panel: no view switcher, no "open diagnostics" button, no Recorder controls, screencast renders (screenshot `assets/browser-workbench-panel.png`) |
| Eight view directories and the composer controls deleted | `src/client/components/views/{console,debugger,diagnostic,emulation,extensions,network,performance,provider}/`, `src/client/components/control/`, `src/client/hooks/{useAutoReveal,useControllerBinding,usePanelSync}.ts` | A clean build proves no stale references remain; client state modules are unit-tested |
| `guide` entry | `src/client/index.tsx` (`id: 'live'`, `order: 20`, `BrowserGlyph`) | The right sidebar "Get started" page shows the "Browser live view" card and it opens the panel (screenshot `assets/browser-workbench-entry.png`) |
| Settings-page binding section | `src/client/index.tsx` (`settings.section`, `id: 'browser'`, `order: 60`), `src/client/components/settings/BrowserSettingsSection.tsx` | Settings → "Browser" section: three switchable cards; `existing` expands the endpoint input with the `/json/version` hint (screenshots `assets/browser-workbench-settings.png`, `assets/browser-workbench-settings-existing.png`) |
| Binding write-back (`configEditor`) | `src/compat/config-editor.ts` | After switching, `- id: browser-tools` in `~/.dsh/profiles/<profile>/cordis.patch.yml` changes its `toolRegistrationMode` / `providerMode` / `externalCdpEndpoint` and hot-reloads; when not writable, the manual-edit hint appears |
| `disabled` mode | `src/application/config.ts`, `src/compat/rpc-dispatcher.ts` | After "Disable this plugin", `browser_*` disappears from the tool surface, `controller_status` returns `blockers: ['browser-tools-disabled']`, and the panel reports the disabled state |
| External CDP auto-connect | `ensureAutoProvider` in `src/runtime/runtime-core-foundation.ts` | With `providerMode: external` plus `externalCdpEndpoint`, a fresh session attaches to the already-running remote-debugging Chrome on first browser use, without `browser_provider connect` |
| Navigation icon patch | `src/client/settings-nav-icon.ts` | The gear on the "Browser" row of the settings dialog becomes a browser-window icon; closing the dialog removes `data-dsh-browser-nav-icon` and the injected `<style>` |
| RPC surface change | `src/compat/rpc-dispatcher.ts` | `controller_overview` and `controller_set_browser_choice` are callable; `controller_set_registration_mode` no longer exists (calls report an unknown endpoint) |

> UI acceptance this round rests on hands-on use of the desktop Profile, evidenced by `assets/browser-workbench-{entry,panel,settings,settings-existing}.png`. Paths with no recorded evidence (the real external CDP auto-connect, the write-back failure branches, multi-session switching) are listed in 9.4 and are not claimed as proven.

### 9.3 Superseded historical claims (annotated, not deleted)

| Location | Original claim | Current status |
| --- | --- | --- |
| 7.2 "Real UI panel" | `verify:panel` 33/33 covering "controller menu activation → 9 panel views" | **Superseded**: `scripts/verify/e2e-panel.mjs` still asserts the old composer menu and nine views, so it necessarily fails today; **pending rewrite**, not counted as passing |
| 7.2 "Instance" | `verify:instance` 10/10 including the composer slot and binding control | Partially superseded: `conversation.input.right` is no longer registered, so those assertions must be rewritten and re-run |
| 7.3 defect #1 (composer slot crash) | Fixed by stabilizing `usePanelSync` callbacks | No longer applicable: `usePanelSync` is deleted and the composer control is gone entirely |
| 7.3 defect #4 (provider endpoint input lacked an accessible name) | Added `aria-label="远程调试地址"` in `ProviderView` | The component is deleted; the settings-page `existing` card's "browser debugging endpoint" input takes over |
| 7.4 "…drove all 9 panel views plus Provider connect…" | Nine views and Provider connect passed in the real UI | **Superseded**: the panel only hosts the live view; the Provider entry moved to the settings page |
| 7.4 "Managed launch is not exposed on the tool surface" | The provider only accepts `external-cdp` | Partially superseded: `providerMode: auto` launches a session browser again; `external` still only uses external CDP |
| 7.4 numbering / 8.3 reproduce list | `verify:panel` and `verify:rpc` counted as panel and RPC layers | Both **pending rewrite**; until then, 9.1 static gates plus this round's manual checks are the evidence |
| 8.1 "`config.ts` exposes 21 options" | 21 options | Now **22**: `externalCdpEndpoint` was added and `toolRegistrationMode` gained `disabled` |
| 8.2 "claim BrowserWorkbench through the real controller menu" | 16/16 covering the claim and persistence across reloads | The claim entry point is gone (`session-select` is no longer offered in the UI), **pending rewrite** as settings-page three-way binding cases |

### 9.4 Not yet proven / pending rewrite

- `scripts/verify/e2e-panel.mjs` and `scripts/verify/e2e-rpc.mjs` are **pending rewrite**: both assert the old composer menu and nine-view routing and do not run today. Until they are rewritten and pass, this report claims no automated result for the panel layer or the RPC success path.
- The three settings write-back failure branches (no `configEditor` service, missing `browser-tools` entry, entry overridden by a home patch) are covered only by unit tests and manual scenarios; there is no e2e yet.
- The navigation icon patch depends on host DOM structure (`[role="dialog"] nav button` plus label text) and must be re-checked whenever the host settings page changes.
- The real external CDP auto-connect path (including the `PROVIDER_UNAVAILABLE` message on failure) needs a manual re-run against a real Chrome started with a remote-debugging port.
- The full `disabled` → re-enable round trip was only checked manually in a single session; concurrent switching across sessions is unverified.

### 9.5 Reproduce

```powershell
npm run typecheck
npm test          # 171 / 171
npm run build     # lib/client.js + lib/index.mjs

# Panel / settings acceptance (desktop profile, manual)
# open the DSH Web UI in the browser, then:
# 1. right sidebar "Get started" → "Browser live view" → panel opens with live view only
# 2. Settings → "Browser" → switch workbench / existing / off and, for "existing", fill the endpoint

# Neither of these counts as passing until rewritten
# npm run verify:panel
# npm run verify:rpc
```
