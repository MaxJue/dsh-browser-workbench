// Config matrix verification: every runtime-observable option in `ConfigSchema`
// is exercised against a real Chrome over external CDP, so the documented policy
// is proven by behaviour instead of by reading the schema.
//
//   node --experimental-transform-types scripts/verify/e2e-config.mjs
//
// Options that only apply to the managed-launch path (executablePath, headless,
// proxy, chromiumDownload*) are covered by `tests/domain/policy.test.mjs` and
// `tests/provider/launch-config.test.mjs`; subagentInteractive is covered by
// `tests/application/security-policy.test.mjs`.
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { startFixtureServer } from './fixtures.mjs'
import { launchBrowser } from './browser.mjs'
import { BrowserRuntime } from '../../src/runtime/runtime.ts'
import { resolveConfig } from '../../src/domain/policy.ts'

const root = resolve(import.meta.dirname, '..', '..')
const sandbox = join(root, '.sandbox')
const artifactRoot = join(sandbox, 'artifacts')
const uploadDir = join(sandbox, 'upload')
const reportDir = join(sandbox, 'reports')

const results = []
const record = (name, status, detail) => {
  results.push({ name, status, detail })
  console.log(`${status === 'PASS' ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` :: ${detail}`}`)
}
const sleep = ms => new Promise(done => setTimeout(done, ms))

const attachments = {
  async saveImage(input) {
    const file = join(artifactRoot, `${Date.now()}-${input.name ?? 'image'}`)
    if (input.data !== undefined) await writeFile(file, input.data)
    return { path: file }
  },
}

let browser
let fixture
let inside
let outside
let seq = 0

const makeRuntime = overrides => {
  seq += 1
  const runtime = new BrowserRuntime(resolveConfig({
    executablePath: browser.executable,
    headless: true,
    artifactRoot,
    ...overrides,
  }), attachments)
  const identity = {
    sessionId: `verify-config-${seq}`,
    sessionCreatedAt: Date.now(),
    callId: `verify-config-${seq}`,
    rootCallId: `verify-config-${seq}`,
  }
  const signal = AbortSignal.timeout(120_000)
  return { runtime, identity, signal }
}

const connect = async ({ runtime, identity, signal }) => {
  await runtime.provider(identity, signal, { action: 'connect', endpoint: browser.endpoint })
}

const close = async session => {
  await session.runtime.dispose().catch(() => {})
}

// `step` isolates one option: fresh runtime, fresh provider connection.
const step = async (name, overrides, run, assert) => {
  const session = makeRuntime(overrides)
  try {
    await connect(session)
    const out = await run(session)
    const problem = assert === undefined ? undefined : assert(out)
    if (problem === undefined) record(name, 'PASS', JSON.stringify(out)?.slice(0, 260))
    else record(name, 'FAIL', `${problem} :: ${JSON.stringify(out)?.slice(0, 260)}`)
  } catch (error) {
    record(name, 'FAIL', String(error?.message ?? error).slice(0, 300))
  } finally {
    await close(session)
  }
}

const expectError = (name, overrides, run, pattern) => {
  const session = makeRuntime(overrides)
  return (async () => {
    try {
      await connect(session)
      const out = await run(session)
      record(name, 'FAIL', `expected an error matching ${pattern}, got ${JSON.stringify(out).slice(0, 200)}`)
    } catch (error) {
      const text = `${error?.code ?? ''} ${String(error?.message ?? error)}`
      if (pattern.test(text)) record(name, 'PASS', text.slice(0, 200))
      else record(name, 'FAIL', `unexpected error: ${text.slice(0, 260)}`)
    } finally {
      await close(session)
    }
  })()
}

try {
  await mkdir(reportDir, { recursive: true })
  await mkdir(uploadDir, { recursive: true })
  browser = await launchBrowser({ executablePath: undefined, sandboxRoot: sandbox, headless: true })
  fixture = await startFixtureServer()
  const origin = fixture.base
  const big = Buffer.alloc(4096, 0x61)
  inside = join(uploadDir, 'inside.bin')
  outside = join(sandbox, 'outside-upload.bin')
  await writeFile(inside, big.slice(0, 128))
  await writeFile(outside, big.slice(0, 128))

  // 1. Baseline: the fixture site is reachable at all.
  await step('default config reaches the fixture site', {}, async ({ runtime, identity, signal }) => {
    const tabs = await runtime.tabs(identity, signal, { action: 'new', url: `${origin}/index.html` })
    return { viewId: tabs.viewId ?? tabs.data?.viewId }
  }, out => (out.viewId === undefined ? 'no viewId returned' : undefined))

  // 2. allowedOrigins: an already-open tab on another origin is refused on navigation.
  {
    const session = makeRuntime({ allowedOrigins: [origin] })
    try {
      await connect(session)
      const { runtime, identity, signal } = session
      const tabs = await runtime.tabs(identity, signal, { action: 'new', url: `${origin}/index.html` })
      const viewId = tabs.viewId ?? tabs.data?.viewId
      const other = origin.replace('127.0.0.1', 'localhost')
      let blocked = false
      try {
        await runtime.navigate(identity, signal, { viewId, url: `${other}/second.html` })
      } catch (error) {
        blocked = /POLICY_DENIED|not allowed|origin/i.test(`${error?.code ?? ''} ${error?.message ?? ''}`)
      }
      record('allowedOrigins blocks a non-listed origin', blocked ? 'PASS' : 'FAIL', `${origin} -> ${other}`)
      const allowed = await runtime.navigate(identity, signal, { viewId, url: `${origin}/second.html` })
      record('allowedOrigins still permits the listed origin', allowed.ok === true ? 'PASS' : 'FAIL', allowed.data?.url ?? '')
    } finally {
      await close(session)
    }
  }

  // 3. allowLoopback:false
  await expectError('allowLoopback=false refuses 127.0.0.1', { allowLoopback: false }, async ({ runtime, identity, signal }) => {
    return runtime.tabs(identity, signal, { action: 'new', url: `${origin}/index.html` })
  }, /POLICY_DENIED|loopback/i)

  // 4. allowPrivateNetwork:false
  await expectError('allowPrivateNetwork=false refuses a private address', { allowPrivateNetwork: false }, async ({ runtime, identity, signal }) => {
    return runtime.tabs(identity, signal, { action: 'new', url: 'http://10.0.0.7/' })
  }, /POLICY_DENIED|private/i)

  // 5. maxOutputChars caps tool output.
  await step('maxOutputChars truncates oversized output', { maxOutputChars: 1000 }, async ({ runtime, identity, signal }) => {
    const tabs = await runtime.tabs(identity, signal, { action: 'new', url: `${origin}/index.html` })
    const viewId = tabs.viewId ?? tabs.data?.viewId
    const out = await runtime.evaluate(identity, signal, { viewId, action: 'main_world', expression: `'x'.repeat(4000)` })
    const value = String(out.data?.value ?? '')
    return { length: value.length, tail: value.slice(-1) }
  }, out => (out.length > 1200 ? `output not capped: ${out.length}` : out.tail === '…' ? undefined : 'missing truncation marker'))

  // 6. maxUploadBytes
  await expectError('maxUploadBytes refuses a larger file', { maxUploadBytes: 64 }, async ({ runtime, identity, signal }) => {
    const tabs = await runtime.tabs(identity, signal, { action: 'new', url: `${origin}/index.html` })
    const viewId = tabs.viewId ?? tabs.data?.viewId
    const refs = await runtime.query(identity, signal, { viewId, selector: '#file', field: 'refs' })
    const ref = refs.data?.refs?.[0]?.ref
    return runtime.upload(identity, signal, { viewId, ref, filePath: inside })
  }, /exceed|maxUploadBytes|too large/i)

  // 7. uploadRoots
  await expectError('uploadRoots refuses a path outside the allowed roots', { uploadRoots: [uploadDir] }, async ({ runtime, identity, signal }) => {
    const tabs = await runtime.tabs(identity, signal, { action: 'new', url: `${origin}/index.html` })
    const viewId = tabs.viewId ?? tabs.data?.viewId
    const refs = await runtime.query(identity, signal, { viewId, selector: '#file', field: 'refs' })
    const ref = refs.data?.refs?.[0]?.ref
    return runtime.upload(identity, signal, { viewId, ref, filePath: outside })
  }, /outside|roots|POLICY_DENIED/i)

  // 8. maxDownloadBytes
  await expectError('maxDownloadBytes refuses a larger download', { maxDownloadBytes: 1024 }, async ({ runtime, identity, signal }) => {
    const tabs = await runtime.tabs(identity, signal, { action: 'new', url: `${origin}/index.html` })
    const viewId = tabs.viewId ?? tabs.data?.viewId
    const refs = await runtime.query(identity, signal, { viewId, selector: '#dl', field: 'refs' })
    const ref = refs.data?.refs?.[0]?.ref
    return runtime.download(identity, signal, { viewId, ref })
  }, /exceed|maxDownloadBytes|too large/i)

  // 9. artifactRoot: profile artifacts (trace) land under the configured root.
  {
    const customRoot = join(sandbox, 'artifacts-config')
    await mkdir(customRoot, { recursive: true })
    const session = makeRuntime({ artifactRoot: customRoot })
    try {
      await connect(session)
      const { runtime, identity, signal } = session
      const tabs = await runtime.tabs(identity, signal, { action: 'new', url: `${origin}/index.html` })
      const viewId = tabs.viewId ?? tabs.data?.viewId
      await runtime.profile(identity, signal, { viewId, action: 'trace_start' })
      await sleep(500)
      await runtime.profile(identity, signal, { viewId, action: 'trace_stop' })
      const listed = await runtime.profile(identity, signal, { viewId, action: 'artifacts' })
      const count = (listed.data?.artifacts ?? []).length
      const files = await readdir(customRoot, { recursive: true })
      const written = files.filter(name => /trace|json|zip/i.test(String(name)))
      const ok = count > 0 && written.length > 0
      record('artifactRoot receives profile artifacts', ok ? 'PASS' : 'FAIL', JSON.stringify({ count, written: written.slice(0, 4) }))
    } finally {
      await close(session)
    }
  }

  // 10. externalCdpTimeoutMs bounds a dead endpoint.
  {
    const session = makeRuntime({ externalCdpTimeoutMs: 1000 })
    const started = Date.now()
    try {
      await session.runtime.provider(session.identity, session.signal, { action: 'connect', endpoint: 'http://127.0.0.1:9' })
      record('externalCdpTimeoutMs bounds a dead endpoint', 'FAIL', 'connect unexpectedly succeeded')
    } catch (error) {
      const elapsed = Date.now() - started
      const text = `${error?.code ?? ''} ${String(error?.message ?? error)}`
      const ok = elapsed < 12_000 && /timeout|timed out|fail|refused|ECONN/i.test(text)
      record('externalCdpTimeoutMs bounds a dead endpoint', ok ? 'PASS' : 'FAIL', `${elapsed}ms :: ${text.slice(0, 160)}`)
    } finally {
      await close(session)
    }
  }

  // 11. maxArtifactBytes bounds CDP stream reads (trace capture).
  await expectError('maxArtifactBytes refuses an oversized trace artifact', { maxArtifactBytes: 512 }, async ({ runtime, identity, signal }) => {
    const tabs = await runtime.tabs(identity, signal, { action: 'new', url: `${origin}/index.html` })
    const viewId = tabs.viewId ?? tabs.data?.viewId
    await runtime.profile(identity, signal, { viewId, action: 'trace_start' })
    await sleep(600)
    return runtime.profile(identity, signal, { viewId, action: 'trace_stop' })
  }, /exceed|ARTIFACT_TOO_LARGE|configured/i)

  // 12. interceptionTimeoutMs auto-continues a paused request.
  {
    const session = makeRuntime({ interceptionTimeoutMs: 1000 })
    try {
      await connect(session)
      const { runtime, identity, signal } = session
      const tabs = await runtime.tabs(identity, signal, { action: 'new', url: `${origin}/index.html` })
      const viewId = tabs.viewId ?? tabs.data?.viewId
      await runtime.networkControl(identity, signal, { viewId, action: 'enable', urlPattern: '**/api?probe=**', requestStage: 'request' })
      const started = Date.now()
      await runtime.evaluate(identity, signal, {
        viewId,
        action: 'main_world',
        expression: `(window.__probe = 'pending'), fetch('/api?probe=1').then(response => { window.__probe = 'status:' + response.status }).catch(error => { window.__probe = 'error:' + error.message }), 'started'`,
      })
      let probe = ''
      while (Date.now() - started < 15_000) {
        const out = await runtime.evaluate(identity, signal, { viewId, action: 'main_world', expression: 'window.__probe' })
        probe = String(out.data?.value ?? '')
        if (probe.startsWith('status:') || probe.startsWith('error:')) break
        await sleep(150)
      }
      const elapsed = Date.now() - started
      const paused = await runtime.networkControl(identity, signal, { viewId, action: 'list_paused' })
      const pending = (paused.data?.pausedRequests ?? []).length
      await runtime.networkControl(identity, signal, { viewId, action: 'disable' })
      const ok = probe === 'status:200' && pending === 0 && elapsed >= 800 && elapsed < 15_000
      record('interceptionTimeoutMs auto-continues a paused request', ok ? 'PASS' : 'FAIL', JSON.stringify({ probe, pending, elapsed }))
    } finally {
      await close(session)
    }
  }
} catch (error) {
  record('config verification bootstrap', 'FAIL', String(error?.stack ?? error).slice(0, 600))
} finally {
  await browser?.close().catch(() => {})
  await fixture?.close().catch(() => {})
  await rm(uploadDir, { recursive: true, force: true }).catch(() => {})
  await rm(outside, { force: true }).catch(() => {})
}

const failed = results.filter(item => item.status === 'FAIL').length
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const report = {
  generatedAt: new Date().toISOString(),
  total: results.length,
  passed: results.length - failed,
  failed,
  results,
}
await writeFile(join(reportDir, `config-${stamp}.json`), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
console.log(`\n${report.passed}/${report.total} config checks passed, ${failed} failed`)
process.exitCode = failed === 0 ? 0 : 1
