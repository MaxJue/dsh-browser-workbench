import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { BrowserContext } from 'playwright-core'
import { fail } from '../domain/errors.ts'
import type { BrowserProfileInput } from '../domain/protocol.ts'
import type { SessionState, ToolOutput, ViewState } from '../domain/types.ts'
import type { ArtifactStore } from './artifact-store.ts'
import type { CdpState } from '../cdp/cdp-state.ts'
import { rawCdp, string } from '../cdp/cdp-raw.ts'

export interface ProfileActionDependencies {
  session: SessionState
  view: ViewState
  state: CdpState
  context: BrowserContext
  artifactRoot: string
  maxArtifactBytes: number
  artifacts: ArtifactStore
}

function asData(value: unknown): ToolOutput['data'] {
  return value as ToolOutput['data']
}

async function readCdpStream(state: CdpState, handle: string, maxArtifactBytes: number): Promise<Buffer[]> {
  const client = rawCdp(state.session)
  const chunks: Buffer[] = []
  let eof = false
  let bytes = 0
  while (!eof) {
    const result = await client.send('IO.read', { handle, size: 1024 * 1024 })
    const data = string(result.data)
    const chunk = result.base64Encoded === true ? Buffer.from(data, 'base64') : Buffer.from(data)
    bytes += chunk.byteLength
    if (bytes > maxArtifactBytes) {
      await client.send('IO.close', { handle }).catch(() => {})
      fail('ARTIFACT_TOO_LARGE', `browser artifact exceeds the configured ${maxArtifactBytes} byte limit`)
    }
    chunks.push(chunk)
    eof = result.eof === true
  }
  await client.send('IO.close', { handle }).catch(() => {})
  return chunks
}

async function saveProfileArtifact(dependencies: ProfileActionDependencies, kind: string, name: string, data: Uint8Array | string): Promise<ToolOutput> {
  const artifact = await dependencies.artifacts.save(dependencies.session.key, kind, name, data)
  dependencies.state.profile.artifacts.push(artifact)
  return { ok: true, action: 'profile', viewId: dependencies.view.viewId, data: asData({ artifact }) }
}

export async function profileRecordAction(input: BrowserProfileInput, dependencies: ProfileActionDependencies): Promise<ToolOutput> {
  const { session, view, state } = dependencies
  const client = rawCdp(state.session)
  if (input.action === 'trace_start') {
    if (state.profile.traceActive) fail('PROFILE_ALREADY_ACTIVE', 'trace is already active for this view')
    await client.send('Tracing.start', {
      transferMode: 'ReturnAsStream',
      traceConfig: {
        recordMode: 'recordUntilFull',
        includedCategories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'v8.execute', 'blink.user_timing'],
      },
    })
    state.profile.traceActive = true
    return { ok: true, action: 'trace_start', viewId: view.viewId, data: asData({ active: true }) }
  }
  if (input.action === 'playwright_trace_start') {
    if (session.playwrightTraceViewId !== undefined) fail('PROFILE_ALREADY_ACTIVE', `Playwright trace is already active for view ${session.playwrightTraceViewId}`)
    await dependencies.context.tracing.start({ screenshots: true, snapshots: true, sources: true })
    session.playwrightTraceViewId = view.viewId
    return { ok: true, action: 'playwright_trace_start', viewId: view.viewId, data: asData({ active: true }) }
  }
  if (input.action === 'playwright_trace_stop') {
    if (session.playwrightTraceViewId === undefined) fail('PROFILE_NOT_ACTIVE', 'Playwright trace is not active for this context')
    const staging = join(dependencies.artifactRoot, 'staging')
    await mkdir(staging, { recursive: true })
    const path = join(staging, `${session.key.replace(/[^\w.-]/g, '_')}-${view.viewId}-${Date.now()}.zip`)
    try {
      await dependencies.context.tracing.stop({ path })
      session.playwrightTraceViewId = undefined
      const data = await readFile(path)
      return saveProfileArtifact(dependencies, 'playwright-trace', `playwright-trace-${view.viewId}.zip`, data)
    } finally {
      await rm(path, { force: true })
    }
  }
  if (input.action === 'trace_stop') {
    if (!state.profile.traceActive) fail('PROFILE_NOT_ACTIVE', 'trace is not active for this view')
    state.profile.traceCompletion = new Promise(resolve => { state.profile.resolveTrace = resolve })
    await client.send('Tracing.end')
    const completion = await Promise.race([
      state.profile.traceCompletion,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('trace completion timed out')), 30000)),
    ])
    const stream = string(completion.stream)
    state.profile.traceActive = false
    state.profile.traceCompletion = undefined
    if (stream === '') fail('PROFILE_FAILED', 'trace completed without a data stream')
    const chunks = await readCdpStream(state, stream, dependencies.maxArtifactBytes)
    const artifact = await dependencies.artifacts.saveChunks(session.key, 'trace', `trace-${view.viewId}.json`, chunks)
    state.profile.artifacts.push(artifact)
    return { ok: true, action: 'trace_stop', viewId: view.viewId, data: asData({ artifact }) }
  }
  if (input.action === 'cpu_start') {
    if (state.profile.cpuActive) fail('PROFILE_ALREADY_ACTIVE', 'CPU profile is already active for this view')
    await client.send('Profiler.enable')
    await client.send('Profiler.start')
    state.profile.cpuActive = true
    return { ok: true, action: 'cpu_start', viewId: view.viewId, data: asData({ active: true }) }
  }
  if (input.action === 'cpu_stop') {
    if (!state.profile.cpuActive) fail('PROFILE_NOT_ACTIVE', 'CPU profile is not active for this view')
    const result = await client.send('Profiler.stop')
    state.profile.cpuActive = false
    return saveProfileArtifact(dependencies, 'cpu-profile', `cpu-${view.viewId}.json`, JSON.stringify(result.profile ?? result))
  }
  if (input.action === 'coverage_start') {
    if (state.profile.jsCoverageActive || state.profile.cssCoverageActive) fail('PROFILE_ALREADY_ACTIVE', 'coverage is already active for this view')
    await view.page.coverage.startJSCoverage({ resetOnNavigation: false, reportAnonymousScripts: true })
    await view.page.coverage.startCSSCoverage({ resetOnNavigation: false })
    state.profile.jsCoverageActive = true
    state.profile.cssCoverageActive = true
    return { ok: true, action: 'coverage_start', viewId: view.viewId, data: asData({ active: true }) }
  }
  if (input.action === 'coverage_stop') {
    if (!state.profile.jsCoverageActive && !state.profile.cssCoverageActive) fail('PROFILE_NOT_ACTIVE', 'coverage is not active for this view')
    const [js, css] = await Promise.all([
      state.profile.jsCoverageActive ? view.page.coverage.stopJSCoverage() : Promise.resolve([]),
      state.profile.cssCoverageActive ? view.page.coverage.stopCSSCoverage() : Promise.resolve([]),
    ])
    state.profile.jsCoverageActive = false
    state.profile.cssCoverageActive = false
    const summary = {
      javascript: js.map(item => ({ url: item.url, sourceBytes: Buffer.byteLength(item.source ?? ''), functions: item.functions })),
      css: css.map(item => ({ url: item.url, textBytes: Buffer.byteLength(item.text ?? ''), ranges: item.ranges })),
    }
    return saveProfileArtifact(dependencies, 'coverage', `coverage-${view.viewId}.json`, JSON.stringify(summary))
  }
  if (input.action === 'heap_snapshot') {
    if (state.profile.heapSnapshotChunks !== undefined) fail('PROFILE_ALREADY_ACTIVE', 'heap snapshot is already active for this view')
    state.profile.heapSnapshotChunks = []
    state.profile.heapSnapshotBytes = 0
    state.profile.heapSnapshotOverflow = undefined
    try {
      await client.send('HeapProfiler.enable')
      await client.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false, captureNumericValue: true })
      if (state.profile.heapSnapshotOverflow === true) fail('ARTIFACT_TOO_LARGE', `heap snapshot exceeds the configured ${dependencies.maxArtifactBytes} byte limit`)
      const chunks = state.profile.heapSnapshotChunks
      const artifact = await dependencies.artifacts.saveChunks(session.key, 'heap-snapshot', `heap-${view.viewId}.heapsnapshot`, chunks)
      state.profile.artifacts.push(artifact)
      return { ok: true, action: 'heap_snapshot', viewId: view.viewId, data: asData({ artifact }) }
    } finally {
      state.profile.heapSnapshotChunks = undefined
      state.profile.heapSnapshotBytes = undefined
      state.profile.heapSnapshotOverflow = undefined
    }
  }
  if (input.action === 'heap_sampling_start') {
    if (state.profile.heapSamplingActive) fail('PROFILE_ALREADY_ACTIVE', 'heap sampling is already active for this view')
    await client.send('HeapProfiler.enable')
    await client.send('HeapProfiler.startSampling', { samplingInterval: 32768 })
    state.profile.heapSamplingActive = true
    return { ok: true, action: 'heap_sampling_start', viewId: view.viewId, data: asData({ active: true }) }
  }
  if (input.action === 'heap_sampling_stop') {
    if (!state.profile.heapSamplingActive) fail('PROFILE_NOT_ACTIVE', 'heap sampling is not active for this view')
    const result = await client.send('HeapProfiler.stopSampling')
    state.profile.heapSamplingActive = false
    return saveProfileArtifact(dependencies, 'heap-sampling', `heap-sampling-${view.viewId}.json`, JSON.stringify(result.profile ?? result))
  }
  fail('INVALID_ARGS', `unknown browser_profile action ${JSON.stringify(input.action)}`)
}
