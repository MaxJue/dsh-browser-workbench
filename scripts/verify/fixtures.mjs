// Fixture site used by the verification harness. Serves deterministic pages for every browser_* capability.
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'

const INDEX = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Fixture Home</title></head>
<body>
<h1>Fixture Home</h1>
<button id="btn">Increment</button>
<span id="count">0</span>
<input id="name" placeholder="Name" aria-label="Name field" />
<textarea id="notes" placeholder="Notes" aria-label="Notes field"></textarea>
<select id="sel" aria-label="Choice"><option value="a">Alpha</option><option value="b">Beta</option></select>
<input id="file" type="file" aria-label="Upload file" />
<a id="dl" href="/file.bin" download="fixture.bin">Download fixture</a>
<a id="next" href="/second.html">Second page</a>
<button id="confirm" onclick="document.getElementById('dialogout').textContent = String(confirm('proceed?'))">Confirm</button>
<button id="alert" onclick="alert('hello-alert')">Alert</button>
<button id="prompt" onclick="document.getElementById('dialogout').textContent = String(prompt('value?'))">Prompt</button>
<div id="dialogout">none</div>
<div id="hover" title="hover-target" style="padding:8px;border:1px solid #888" onmouseover="document.getElementById('hoverout').textContent='hovered'">Hover me</div>
<div id="hoverout">idle</div>
<div style="height:2400px;background:linear-gradient(#fff,#ddd)"><span>tall spacer</span></div>
<button id="deep">Deep Button</button>
<iframe id="frame" src="/frame.html" width="400" height="160" title="inline frame"></iframe>
<script>
  console.log('fixture-log', 1)
  console.info('fixture-info')
  console.warn('fixture-warn')
  console.error('fixture-error')
  fetch('/api').then(r => r.json()).then(v => { window.__api = v })
  setTimeout(() => { fetch('/api?late=1') }, 1200)
  document.getElementById('btn').addEventListener('click', () => {
    const node = document.getElementById('count')
    node.textContent = String(Number(node.textContent) + 1)
  })
  // A steady ticker keeps a statement scheduler busy so Debugger.pause always
  // has JavaScript to land on; an idle renderer can defer the paused event.
  setInterval(() => { window.__ticks = (window.__ticks ?? 0) + 1 }, 40)
</script>
</body></html>`

const SECOND = `<!doctype html><html><head><meta charset="utf-8"><title>Second Page</title></head>
<body><h1>Second Page</h1><p id="marker">second page marker</p><a href="/">back home</a></body></html>`

const SLOW = `<!doctype html><html><head><meta charset="utf-8"><title>Slow Page</title></head>
<body><h1>Slow Page</h1><div id="lazy-host">pending</div>
<script>console.log('slow-log'); setTimeout(() => { const host = document.getElementById('lazy-host'); host.textContent = 'lazy-loaded'; host.id = 'lazy' }, 700)</script>
</body></html>`

const FRAME = `<!doctype html><html><head><meta charset="utf-8"><title>Inline Frame</title></head>
<body><button id="innerbtn">Inner Button</button><p id="innertext">frame body</p></body></html>`

// A full-viewport field so a click anywhere in the live view lands on the same control.
const INPUT = `<!doctype html><html><head><meta charset="utf-8"><title>Input Fixture</title>
<style>html,body{margin:0;height:100%}#echo{position:fixed;inset:0;width:100%;height:100%;font-size:28px;border:0;outline:0;padding:24px;box-sizing:border-box}</style>
</head><body>
<input id="echo" aria-label="Echo field" placeholder="type here" />
<script>
  window.__events = []
  const field = document.getElementById('echo')
  for (const type of ['focus', 'pointerdown', 'mousedown', 'mouseup', 'pointerup', 'keydown', 'input']) {
    field.addEventListener(type, () => { window.__events.push(type) })
  }
</script>
</body></html>`

const BIN = Buffer.alloc(4096, 7)

function fixtureHandler(request, response) {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname === '/api') {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ ok: true, path: url.pathname, query: url.search }))
      return
    }
    if (url.pathname === '/file.bin') {
      response.setHeader('content-type', 'application/octet-stream')
      response.setHeader('content-disposition', 'attachment; filename="fixture.bin"')
      response.end(BIN)
      return
    }
    const pages = { '/': INDEX, '/index.html': INDEX, '/second.html': SECOND, '/slow.html': SLOW, '/frame.html': FRAME, '/input.html': INPUT }
    const body = pages[url.pathname]
    if (body === undefined) {
      response.statusCode = 404
      response.setHeader('content-type', 'text/html; charset=utf-8')
      response.end('<h1>Not Found</h1>')
      return
    }
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.setHeader('cache-control', 'no-store')
    response.end(body)
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

function closer(server) {
  return () => new Promise(done => server.close(() => done()))
}

export async function startFixtureServer() {
  const server = createServer(fixtureHandler)
  const port = await listen(server)
  return { base: `http://127.0.0.1:${port}`, close: closer(server) }
}

// The managed-launch checks need a TLS origin. Chrome only accepts it after the self-signed
// certificate in .sandbox/certs is trusted, see e2e-managed.mjs.
export async function startSecureFixtureServer({ pfxPath }) {
  const server = createHttpsServer({ pfx: readFileSync(pfxPath) }, fixtureHandler)
  const port = await listen(server)
  return { base: `https://127.0.0.1:${port}`, close: closer(server) }
}
