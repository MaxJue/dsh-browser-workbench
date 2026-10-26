// Launches a throwaway Chromium for the verification harness and exposes its DevTools endpoint.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'

const CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolvePort(port))
    })
  })
}

async function waitForVersion(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) return await response.json()
    } catch {}
    await new Promise(done => setTimeout(done, 150))
  }
  throw new Error(`browser did not expose DevTools on port ${port}`)
}

export async function launchBrowser({ executablePath, sandboxRoot, headless = true } = {}) {
  const executable = executablePath ?? CANDIDATES.find(existsSync)
  if (executable === undefined) throw new Error('no Chrome/Edge executable found')
  const profileDir = resolve(sandboxRoot, `chrome-profile-${Date.now()}`)
  await mkdir(profileDir, { recursive: true })
  const port = await freePort()
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-breakpad',
    '--disable-crash-reporter',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--remote-allow-origins=*',
    '--no-sandbox',
    'about:blank',
  ]
  if (headless) args.unshift('--headless=new')
  const child = spawn(executable, args, { stdio: 'ignore', windowsHide: true })
  let exitCode
  child.on('exit', code => { exitCode = code })
  let version
  try {
    version = await waitForVersion(port)
  } catch (error) {
    child.kill()
    throw error
  }
  return {
    endpoint: `http://127.0.0.1:${port}`,
    version: version.Browser,
    executable,
    profileDir,
    async close({ removeProfile = true } = {}) {
      if (exitCode === undefined) {
        child.kill()
        await new Promise(done => {
          const timer = setTimeout(done, 5000)
          child.once('exit', () => { clearTimeout(timer); done() })
        })
      }
      if (removeProfile) await rm(profileDir, { recursive: true, force: true }).catch(() => {})
    },
  }
}
