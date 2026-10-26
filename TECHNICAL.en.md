# DSH BrowserWorkbench Technical Specifications

[简体中文](./TECHNICAL.md) | English Version

Version `1.0.0-rc8` targets DSH `0.2.1-rc.2`, using Cordis `4.0.5` and Schemastery `3.18.5`.

This document describes the configuration options, browser state model, and security boundaries of BrowserWorkbench. For general installation and feature overviews, see [README.en.md](./README.en.md). For test credentials, see [VALIDATION.en.md](./VALIDATION.en.md).

## Configuration

Complete configuration example:

```yaml
- id: browser-tools
  config:
    toolRegistrationMode: session-select
    allowLoopback: true
    allowPrivateNetwork: true
    allowedOrigins: []
    uploadRoots: []
    maxUploadBytes: 26214400
    maxDownloadBytes: 104857600
    maxArtifactBytes: 268435456
    maxOutputChars: 12000
    interceptionTimeoutMs: 15000
    externalCdpTimeoutMs: 15000
    subagentInteractive: false
    sessionController:
      includeTools: []
      excludeTools: []
```

| Option | Default | Description |
| --- | --- | --- |
| `toolRegistrationMode` | `session-select` | Selects a browser toolset per formal Session on first use, then permanently locks it. `global` is reserved for standalone profiles and automatically degrades when other browser tools are detected. |
| `sessionController.includeTools` | `[]` | Explicit tool names to include in browser tool selection arbitration. |
| `sessionController.excludeTools` | `[]` | Explicit tool names to exclude from browser tool selection arbitration. |
| `externalCdpTimeoutMs` | `15000` | CDP connection timeout for the user's Chrome/Edge, in milliseconds. |
| `allowedOrigins` | `[]` | Restricts navigations to explicit origins when non-empty. |
| `allowLoopback` | `true` | Allows navigations to `127.0.0.1` and `localhost`. |
| `allowPrivateNetwork` | `true` | Allows navigations to private RFC 1918 IPv4 ranges. |
| `uploadRoots` | Current process CWD | Approved directories from which local files can be uploaded. |
| `subagentInteractive` | `false` | Whether Subagents are allowed to invoke interactive and write actions. |

The source still accepts legacy `executablePath`, `headless`, proxy, profile, and Chromium download fields so historical configuration can be read; the current default path does not launch or download a managed browser. The managed implementation itself (`persistentContext()` / `launchSharedPersistentContext()`, proxy routing, Chromium download) is still present and is exercised directly by `npm run verify:managed`; only the tool surface (a provider that accepts `external-cdp` alone) does not expose it to users.

## Tool Registration Modes

BrowserWorkbench supports two modes. `session-select` is recommended for multi-plugin environments.

### 1. Global Mode (`global`)
```yaml
- id: browser-tools
  config:
    toolRegistrationMode: global
```
Registers all 30 tools into DSH globally. If pre-existing `browser_*` tools are detected at bootstrap, BrowserWorkbench automatically degrades to `session-select` to prevent cordis registration conflicts.

### 2. Session-Select Mode (`session-select`)
```yaml
- id: browser-tools
  config:
    toolRegistrationMode: session-select
```
- **Concealed State**: Prior to selection, browser tools are concealed from the Agent to prevent premature invocation.
- **Provider Choice**: On first browser use, the user or model selects either DSH BrowserWorkbench or pre-existing third-party browser tools.
- **Session Locking**: Selection permanently binds that Session. Switching plugins requires creating a new Session.
- **Shadowing & Masking**: When BrowserWorkbench is selected, identical tool names from third parties are shadowed, and exclusive third-party browser tools are restricted for that Session only.
- **Non-Interference**: If third-party tools are chosen, BrowserWorkbench steps aside without allocating pages or registering tools.

## State Models & Isolation

BrowserWorkbench implements a dual-layer state model:

### Shared Across Sessions
- Cookies, LocalStorage, SessionStorage, IndexedDB, Cache Storage.
- HTTP caches and Service Workers.
- Web permissions and browser state remain owned by the connected browser.

### Isolated Per Session
- Browser pages, tabs, popups, and tab navigation history.
- Active viewport focus and split-view geometry.
- CDP debugger sessions, network interception journal, and action timeline.
- Takeover input locks and diagnostic artifacts.

## Security & Isolation Invariants

1. **Path Traversal Protection**: Uploads and downloads are bound to explicit directories. Path escaping or symlink traversal attempts are rejected.
2. **Credential Sanitization**: Debugger scopes, network logs, and console entries automatically redact tokens, passwords, and authorization headers.
3. **Takeover Exclusivity**: When manual takeover is active, Agent write interactions are halted with `USER_TAKEOVER_ACTIVE` to prevent conflicting actions.
4. **Graceful Degradation**: If browser resources are disposed, the session lock remains recorded in schema v2 persistence, safely resuming upon DSH restarts.
