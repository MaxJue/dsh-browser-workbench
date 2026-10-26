<div align="center">

# DSH BrowserWorkbench

### The full Chromium DevTools toolchain, handed to your DSH agent

Not just a viewer. It clicks, sets breakpoints, captures requests, resolves Source Maps — and keeps the evidence.

![License](https://img.shields.io/badge/license-MIT-2563EB?style=for-the-badge)
![DSH](https://img.shields.io/badge/DSH-0.2.1--rc.2%20%7C%200.2.1--rc.3-7C3AED?style=for-the-badge)
![Node](https://img.shields.io/badge/Node-%5E22.19.0%20%7C%7C%20%3E%3D24.0.0-16A34A?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Tests](https://img.shields.io/badge/tests-170%20passing-22C55E?style=for-the-badge)
![Status](https://img.shields.io/badge/status-1.0.0--rc8%20%C2%B7%20not%20on%20npm-F97316?style=for-the-badge)

[Install from source](#installation) · [See it work](#what-it-looks-like) · [30 tools](#feature-reference) · [Verification](#verification-results) · [Technical details](./TECHNICAL.md) <br> <br>
English | [简体中文](./README.md)

</div>

---

> [!IMPORTANT]
> This is an independently developed community plugin. It is not published, maintained, or endorsed by DeepSeek, and it does not modify DeepSeek Harness core code.<br>
> The current version is `1.0.0-rc8` and **has not been published to npm yet** (see [PUBLISHING.md](./PUBLISHING.md)). Use the [source-install](#installation) flow below.<br>
> The project is still under active development — file an issue for bugs or anything unexpected.
>
>> *If this plugin saves you time, a star helps others find it. Thanks!*

## Current status

| Item | Reality |
| --- | --- |
| Version | `1.0.0-rc8` (release candidate) |
| Target host | DSH `0.2.1-rc.2` / `0.2.1-rc.3` (exact peer range), Cordis `~4.0.5`, Schemastery `~3.18.5` |
| npm status | **Not published.** The first release has not been made; installing from npm does not work yet |
| Repository contents | Source, tests, docs; **no** `lib/` build output, no `node_modules`, `.sandbox`, or `.npm-cache` |
| Verified | Strict typecheck, 170 unit tests, production build, 30-tool regression against real Chromium, seven-layer verification in a separate process with its own `DSH_HOME` |
| Still pending | Manual install/launch/auth/uninstall acceptance on a brand-new DSH Web profile; first npm release |
| Not claimed | DSH `0.1.x` (RC7 and earlier), macOS/Linux hardware, third-party browser plugins |

## What this plugin is

Front-end debugging hurts because you cannot see the page structure, cannot see the request details, cannot get a breakpoint to land, and the error is one line of text. Agents have it worse on a complex page: they can take a screenshot, describe it, and then get stuck in a loop of "try reloading" and "try clearing the cache".

BrowserWorkbench embeds a full Chromium workbench in the DSH Web sidebar and ships 30 purpose-built automation tools. The agent can read page structure, drive elements, read the Console, trace requests, set breakpoints, walk call stacks, resolve Source Maps, profile performance, and record the full state before and after an operation — all inside one session.

**The tool surface only accepts external CDP connections.** Agents connect through `browser_provider` to a Chrome or Edge instance the user already started with remote debugging. The plugin does not browse, download, or host a new browser; pages, tabs, and login state stay in the user's own browser. The implementation and tests for managed launch (`executablePath`, `headless`, proxies) are still present, but this version does not expose them on the tool surface — see [Known boundaries](#known-boundaries).

![BrowserWorkbench live workbench embedded in DSH Web](./assets/browser-workbench-hero.png)

## Contents

- [Current status](#current-status)
- [What it looks like](#what-it-looks-like)
- [Installation](#installation)
- [Feature reference](#feature-reference)
- [Directory layout](#directory-layout)
- [Development and verification](#development-and-verification)
- [Known boundaries](#known-boundaries)
- [Compatibility](#compatibility)
- [Feedback](#feedback)
- [License](#license)

## What it looks like

### One window, the whole debugging loop

The agent conversation, the real page, the tab strip, the address bar, and the debug output all live in the DSH right sidebar. When a page breaks you do not juggle windows — DOM structure, Console output, Network requests, and script stacks are right there. The screenshot below is a completed diagnostic run against the DeepSeek homepage: tool calls and conclusions on the left, the same page live on the right.

**A typical hunt:** the layout suddenly falls apart. The agent calls `browser_snapshot`, reads the DOM, and finds a container whose `display` was flipped to `none` by an async script. It then sets a breakpoint with `browser_debugger`, resolves the Source Map, and finds an update-ordering bug in the original source.

### Pick once, stay consistent for the session

![Choosing the browser toolset for a formal session](./assets/browser-workbench-session-controller-1.png)

Before a formal session uses a browser for the first time, it has to pick BrowserWorkbench or another browser toolset already present in the profile. Until then the session exposes no browser tools to the agent.

![BrowserWorkbench stays locked for the session after selection](./assets/browser-workbench-session-controller-2.png)

Once BrowserWorkbench is selected, that session uses only BrowserWorkbench. If another browser toolset was picked instead, BrowserWorkbench registers no tools and creates no browser resources for that session. The choice cannot be changed mid-session — start a new session to switch. Other sessions choose independently, and third-party plugins are neither stopped nor modified.

Releasing BrowserWorkbench resources closes its pages and debug state, but does not undo the session's selection. The choice also survives a DSH restart or an agent-scope replacement.

### Minified in production? Get the source back

![Debugger with the real script list and Source Maps](./assets/browser-workbench-debugger.png)

Webpack squeezed the code into a single line? Fine. Connect the CDP debugger and the script list shows the bundles the page actually loaded; every script opens its source and Source Map in place. Breakpoints, stepping, call stacks, and scope stay where they belong.

### Request ordering, made obvious

![Real request sequence in the Network journal](./assets/browser-workbench-network.png)

The capture list is a real, time-ordered record: document, styles, scripts, fonts, xhr, each with its status code. Interception rules toggle on demand, so first paint and later interactions can be compared separately. This is the fastest way to catch state overwrites and late responses.

### Two live pages, watched together

![Two-page split live view in BrowserWorkbench](./assets/browser-workbench-split-view.png)

Two real pages, separate frames, separate focus. Stack them for responsive checks, place them side by side for cross-page comparison — the screenshot shows the Chinese and English versions of the same site, side by side.

### Preserve the scene, prove the claim

![Debug session, topology, recorder, and action timeline](./assets/browser-workbench-diagnose-1.png)

A debug session bundles page identity, the action timeline, context topology, and build identity.

![Checkpoint, compare, incident, and takeover summaries](./assets/browser-workbench-diagnose-2.png)

Take a checkpoint before and after an operation: compare reports environment comparability, a regression verdict (`fixed` / `regressed`), and an incident summary — and it handles purely visual changes such as scrolling.

### Performance problems have nowhere to hide

![Performance toolbar and artifacts](./assets/browser-workbench-performance.png)

CPU spiking? Memory leaking? Trace the main thread, profile for hot functions, snapshot the heap for retained objects. Trace and CPU Profile are written out as artifacts with their sizes attached, so large files never flood the model's context.

## Installation

Requires Node.js `^22.19.0` or `>=24.0.0`, pnpm, and a DSH Web profile that starts cleanly.

### Build from source (the only reliable path today)

The repository does not ship `lib/`, so build first:

```powershell
git clone https://github.com/MaxJue/dsh-browser-workbench.git
cd dsh-browser-workbench
pnpm install --frozen-lockfile --ignore-scripts
npm run build        # produces lib/index.mjs, lib/index.d.mts, lib/client.js
```

Pack it and add it to the profile:

```powershell
npm pack             # produces dsh-browser-workbench-1.0.0-rc8.tgz
dsh plugin --profile web add ./dsh-browser-workbench-1.0.0-rc8.tgz --ignore-scripts --config.auto-install-peers=false
```

You can also add the repository directory directly (`dsh plugin --profile web add <absolute path>`); after that, code changes only need `npm run build`, no reinstall.

> The npm form `dsh plugin --profile web add dsh-browser-workbench@1.0.0-rc8` fails until the first publish, because the package is not on the registry.

Enable it in the profile's `cordis.patch.yml`:

```yaml
- insert:
    - id: browser-tools
      name: dsh-browser-workbench
```

Start Chrome with remote debugging (for example `chrome.exe --remote-debugging-port=9222`), then start DSH Web. Open a new session, open the BrowserWorkbench panel on the right, and follow the three steps in "connect an existing Chrome" to bind `http://127.0.0.1:9222`. If the connection fails, check the Chrome process, its launch flags, and the port.

Upgrading from the historical `dsh-browser-tools` package? Remove the old package first. Keep `id: browser-tools` and `$DSH_HOME/browser-tools`. Never install both packages into the same profile.

## Feature reference

### Browsing and interaction

| Capability | Description | Tools |
| --- | --- | --- |
| Tabs | List, create, switch, and close tabs | `browser_tabs` |
| Navigation | Open URLs, go back, go forward, reload | `browser_navigate`, `browser_navigate_back` |
| Read the page | Read structure, element geometry, attributes, and query results | `browser_snapshot`, `browser_get_attribute`, `browser_query` |
| Drive the page | Click, hover, scroll, type, press keys, select options, wait for changes | `browser_click`, `browser_hover`, `browser_scroll`, `browser_type`, `browser_press_key`, `browser_select_option`, `browser_wait_for` |
| Dialogs | Accept or dismiss page dialogs and answer prompts | `browser_handle_dialog` |
| Run scripts | Evaluate JavaScript in the page or on an element | `browser_evaluate` |
| Screenshots | Save the current page image | `browser_take_screenshot` |
| Upload and download | Upload local files, capture and save downloads | `browser_upload_file`, `browser_download` |

### Console and requests

| Capability | Description | Tools |
| --- | --- | --- |
| Read the Console | Logs, warnings, errors, and duplicate messages | `browser_console_messages` |
| Inspect requests | URL, method, status, resource type, and ordering | `browser_network_requests` |
| Inspect payloads | Read request and response bodies | `browser_network_requests` |
| Pause requests | Intercept traffic at the request or response stage | `browser_network_control` |
| Continue or abort | Release or abort a paused request | `browser_network_control` |
| Mock responses | Return a custom status, headers, and body | `browser_network_control` |
| Replay | Re-issue a request that already happened | `browser_network_control` |
| Auto-release | Release on interception timeout so the page never hangs | `browser_network_control` |

### Breakpoints and source

| Capability | Description | Tools |
| --- | --- | --- |
| Attach the debugger | Connect the CDP debugger to the current page | `browser_debugger` |
| Breakpoint control | Set breakpoints, pause, resume, step over, step into, step out | `browser_debugger` |
| Call stacks | Function order, script position, and pause reason | `browser_debugger` |
| Variables | Local, closure, and global scope values | `browser_debugger` |
| Scripts | Loaded scripts and runtime source | `browser_debugger` |
| Source Maps | Map minified positions back to original file, line, and column | `browser_debugger`, `browser_diagnose` |
| Build identity | Record script content and build identity so you never read the wrong version | `browser_diagnose` |
| Execution contexts | Separate main world, isolated world, and paused frame | `browser_debugger`, `browser_diagnose` |

### Performance and diagnostics

| Capability | Description | Tools |
| --- | --- | --- |
| Trace recording | Record main thread, network, and rendering | `browser_profile` |
| Action recording | Save page actions, snapshots, requests, and timelines | `browser_profile` |
| CPU profiling | Find the functions and call paths burning CPU | `browser_profile` |
| Coverage | JavaScript and CSS usage | `browser_profile` |
| Memory | Heap snapshots for retained objects | `browser_profile` |
| Allocation growth | Heap sampling for allocation hotspots in long tasks | `browser_profile` |
| Diagnostic sessions | Keep page, actions, context, and build information together | `browser_diagnose` |
| Checkpoints | Capture page and identity state before and after an operation | `browser_diagnose` |
| Compare | Diff two checkpoints and flag changes and regressions | `browser_diagnose` |
| Incidents | Aggregate actions, Console, requests, identity, and compare results | `browser_diagnose` |
| Key event recording | Off, Rolling, Deep, Metadata-only, and Incident modes | `browser_diagnose` |
| Large artifacts | Store traces, profiles, heaps, and reports under the session directory | `browser_profile`, `browser_diagnose` |

### Live view and human takeover

| Capability | Description | Tools |
| --- | --- | --- |
| Live view | Watch the current page in the sidebar | `browser_live_view` |
| Adaptive sizing | Page follows the panel size so input coordinates stay correct | `browser_live_view`, `browser_emulate` |
| Stacked split | Watch two pages at once | `browser_split_view` |
| Side-by-side split | Place two pages horizontally | `browser_split_view` |
| Human clicks | Operate the page with the mouse directly | `browser_takeover` |
| Human typing | Type text and shortcuts with the keyboard | `browser_takeover` |
| CJK input | Chinese input works without splitting into wrong keys | `browser_takeover` |
| Paste | Uses the final paste event, never clipboard history | `browser_takeover` |
| Takeover | Take control temporarily, then hand it back to the agent | `browser_takeover` |
| Stale input guard | Rejects outdated coordinates after size or frame changes | `browser_takeover` |

### Extensions and browser environment

| Capability | Description | Tools |
| --- | --- | --- |
| Extension boundary | In external CDP mode, `browser_extensions` is a read-only compatibility endpoint: it does not read, install, start, or stop extensions | `browser_extensions` |
| Connect a browser | Attach to a Chrome/Edge started with remote debugging | `browser_provider` |
| Keep browser state | Cookies, cache, permissions, and extensions stay in the user's browser | `browser_provider` |
| Disconnect | Releases only DSH's CDP connection, never closes the user's browser | `browser_provider` |
| Emulate devices | Viewport, device, locale, time zone, network, CPU, and offline | `browser_emulate` |
| Emulate permissions | Control page permissions | `browser_emulate` |

### Session control

| Capability | Description |
| --- | --- |
| First choice | Before a formal session uses a browser, pick BrowserWorkbench or another browser toolset |
| Session lock | The browser plugin cannot change within a session; start a new session to switch |
| Protection before choosing | Until a choice is made, the session exposes no recognised browser tools to the agent |
| On-demand registration | Selecting BrowserWorkbench registers the 30 tools for that session only |
| Global mode | With `toolRegistrationMode: global`, the plugin claims global registration for the profile |
| Safe downgrade | If global mode finds existing browser tools, it falls back to per-session choice |
| Tool shadowing | Selecting BrowserWorkbench shadows same-named tools for that session and hides third-party browser-only tools |
| Release resources | Closes BrowserWorkbench pages and debug state without undoing the session lock |
| Restart recovery | The saved choice is restored after a DSH restart or agent-scope replacement |
| Session isolation | One session's choice, tabs, and debug state never change another's |
| Shared site state | Cookies, LocalStorage, IndexedDB, Cache Storage, HTTP cache, Service Worker, and permissions are shared across sessions |
| Isolated page state | Pages, views, tabs, popups, the active page, and split focus are per-session |
| Isolated debug state | Debugger, request interception, refs, snapshots, and live frames are per-session |
| Isolated files | Artifacts, takeover, and controller state are per-session |
| Page provenance | `window.open()` pages inherit the correct owner; pages with unknown provenance are never exposed to other sessions |
| Layout restore | After a browser context is rebuilt, each session's URL, active tab, and split layout are restored |

## Directory layout

```
src/
├── application/   tool definitions (30 browser_* tools), config schema, safety policy, metadata
├── cdp/           CDP sessions and protocol-level events (debugger / fetch / screencast / profile / script)
├── client/        React 19 panel UI: components, hooks, utils, panel-controller
├── compat/        DSH version compatibility layer, message and RPC dispatch
├── controller/    session-level controller arbitration (browser-controller)
├── diagnostics/   forensics: flight recorder, context/build identity, incidents, Source Maps
├── domain/        pure protocol contracts: types, protocol, errors, policy
├── extensions/    CRX3 unpacking, extension registry, extension popups
├── input/         human takeover, keyboard/mouse/pointer gestures, input observation
├── page/          navigation, network recording and interception, dialogs, page diagnostics
├── provider/      external CDP connection, managed launch config, persistent profile, artifact store
├── runtime/       orchestration layer (every file stays in the hundreds of lines)
├── session/       session keys, exclusive task queue, tab restoration
└── view/          viewports, adaptive reflow, split view, screencast sync

tests/             mirrors src/ one to one
scripts/verify/    e2e verification scripts and local fixture site
```

Source size: `src/` is 138 files and roughly 16.3k lines; `tests/` is 55 files and 170 cases. Architecture constraints live in [AGENTS.md](./AGENTS.md) and [DIRECTORY_SPECIFICATION.md](./DIRECTORY_SPECIFICATION.md).

## Development and verification

Three static gates must pass before a commit:

```powershell
npm run typecheck    # tsc --noEmit, 0 errors
npm test             # all 170 unit tests pass
npm run build        # tsdown, produces lib/index.mjs and lib/client.js
```

When you need a real browser, run the relevant layer on demand (**nothing downloads Chromium implicitly**; supply a ready browser and the local fixture site yourself):

```powershell
npm run verify:tools       # runtime layer: 145 assertions over the 30 browser_* tools (real Chrome + fixture site)
npm run verify:extensions  # extension layer: MV3 local install, registry persistence, start/stop/uninstall, popup, bad input (19)
npm run verify:managed     # managed layer: executablePath/headless, three proxy modes, HTTPS CONNECT, offline install (16)
npm run verify:sandbox     # boot a separate DSH_HOME instance and print the tokenised URL
npm run verify:instance    # instance layer: client bundle, composer controls, auth RPC round trip (10)
npm run verify:panel       # panel layer: formal session -> controller activation -> 9 views -> provider -> live view -> takeover (33)
npm run verify:config      # config layer: real runtime effect of 13 options
npm run verify:rpc         # RPC/persistence layer: auth boundary, envelope contract, controller choice across reloads (16)
npm run verify:persist -- --phase=prepare   # claim the controller and record a marker
npm run verify:persist -- --phase=verify    # re-check after a host restart (needs a fresh token)
```

The full seven-layer record, the 7 real defects fixed this round, and the unreachable paths are documented in [VALIDATION.md](./VALIDATION.md) sections 14 and 15.

### Verification results

| Layer | Entry point | Result |
| --- | --- | --- |
| Static gates | `typecheck` / `test` / `build` | 0 errors / 170 passing / build clean |
| Runtime | `verify:tools` | 145/145 |
| Instance | `verify:instance` | 10/10 |
| Real UI panel | `verify:panel` | 33/33 |
| Extensions | `verify:extensions` | 19/19 |
| Managed launch + proxies/HTTPS | `verify:managed` | 16/16 |
| Config | `verify:config` | 13/13 |
| RPC | `verify:rpc` | 16/16 |
| Persistence | `verify:persist` | prepare 7/7 + verify 5/5 |

The runtime layer uses real Chrome (`155.0.8059.85`) connected over `external-cdp` to the local fixture site. One caveat: the 30-minute recorder retention conclusion comes from **virtual-time simulation**. It proves the retention and eviction boundaries, not 30 minutes of wall-clock soak testing.

## Known boundaries

These are real behaviours intentionally kept in this version, not TODOs:

- **Managed launch is not on the tool surface**: `browser_provider` only accepts `external-cdp`, and `providerBinding` has just two write points, `disconnected` and `external-cdp`. Managed settings such as `executablePath`, `headless`, and proxies only take effect in protected runtime methods and are exercised by `verify:managed`.
- **Managed download metadata lags**: `KNOWN_ARCHIVES` in `src/provider/chromium-manager.ts` only lists `149.0.7827.55`, while playwright-core 1.64.1 expects `156.0.8078.4`; with missing metadata the download fails closed. That is a deliberate integrity policy, not a bug.
- **`browser_live_view adaptive` needs the panel**: without an open panel there is no size report, so the call returns the recoverable `ADAPTIVE_SIZE_UNAVAILABLE`.
- **Extensions are read-only**: in external CDP mode `browser_extensions` is a read-only compatibility endpoint over the historical registry; installing, starting, and stopping extensions means operating the connected browser directly.
- **`subagentInteractive` defaults to `false`**: delegated sub-sessions are rejected when they call interactive tools such as navigation, clicking, or dialogs; top-level sessions follow the permission preset for allow/ask.
- **Out of scope**: DRM, Native Messaging, Manifest V2, CAPTCHA/verification challenges, Passkey/WebAuthn, anti-automation policies on arbitrary sites, and the business correctness of the app under test.

## Compatibility

Version `1.0.0-rc8` targets DSH `0.2.1-rc.2` / `0.2.1-rc.3` and requires Cordis `~4.0.5`, Schemastery `~3.18.5`, and Node `^22.19.0 || >=24.0.0`. RC7 and earlier do not support DSH `0.2.x`, and verification conclusions from the `0.1.x` era do not apply.

Measured on Windows with Node 22.x, pnpm 11.x, and real Chrome; macOS, Linux, and other Chromium builds have not been tested on hardware.

Candidate status is defined by the external candidate-identity file and the tarball digest; the description in this repository alone cannot prove that a version has a Git tag, a GitHub Release, or an npm publication.

## Technical details

Full configuration, tool registration modes, state model, security boundaries, internal identifiers, and the tool list live in [TECHNICAL.md](./TECHNICAL.md).

## Feedback

Bugs, compatibility problems, and feature requests go to [GitHub Issues](https://github.com/MaxJue/dsh-browser-workbench/issues). Include the DSH version, BrowserWorkbench version, OS, Node.js version, and any other browser plugins loaded — it makes triage much faster.

Report security issues privately per [SECURITY.en.md](./SECURITY.en.md). Never put credentials, cookies, session data, or unredacted logs in a public issue.

## License

[MIT](./LICENSE)
