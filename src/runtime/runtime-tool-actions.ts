import { mkdir, rm, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { abortReason, fail, requireActive } from '../domain/errors.ts'
import { assertUploadPath, assertUrlAllowed } from '../domain/policy.ts'
import type { ElementHandle } from 'playwright-core'
import type { Identity, RefState, ToolOutput } from '../domain/types.ts'
import type { BrowserDebuggerInput, BrowserDiagnoseInput, BrowserEmulateInput, BrowserEvaluateInput, BrowserExtensionInput, BrowserLiveViewInput, BrowserNetworkInput, BrowserProfileInput, BrowserProviderInput, BrowserSplitViewInput, BrowserTakeoverInput } from '../domain/protocol.ts'
import { awaitBackNavigation, stopOnAbort } from '../page/page-operation.ts'
import type { EvidenceContextIdentity } from '../diagnostics/context-identity.ts'
import { BrowserRuntimeCore } from './runtime-core.ts'

function asData(value: unknown): ToolOutput['data'] {
  return value as ToolOutput['data']
}

export class BrowserRuntimeToolActions extends BrowserRuntimeCore {



  async tabs(identity: Identity, signal: AbortSignal, input: { action?: string; viewId?: string; index?: number; url?: string }): Promise<ToolOutput> {
    return this.withSession(identity, signal, async session => {
      const action = input.action ?? 'list'
      if (action !== 'list') {
        const current = session.views.get(session.activeViewId)
        if (current !== undefined) {
          const blocked = this.modelWriteBlocked(session, current, 'tabs')
          if (blocked !== undefined) return blocked
        }
      }
      if (action === 'new') {
        const previousActiveViewId = session.activeViewId
        // 蹇呴』鍦ㄥ垱寤?Playwright Page 鍓嶅畬鎴愮瓥鐣ユ牎楠岋紝閬垮厤琚嫆缁濈殑 URL 浜х敓涓嶅彲瑙佺殑绌虹櫧椤电鍜?View 鐘舵€併€?
        const rawUrl = input.url?.trim()
        const url = rawUrl === undefined || rawUrl === '' || rawUrl === 'about:blank' ? undefined : assertUrlAllowed(this.config, rawUrl)
        const page = await this.createPage(session)
        const view = this.bindView(session, page)
        if (session.splitView.enabled) {
          if (session.splitView.focusedPane === 'top') session.splitView.topViewId = view.viewId
          else session.splitView.bottomViewId = view.viewId
        }
        session.activeViewId = view.viewId
        try {
          if (url !== undefined) {
            await stopOnAbort(view.page, signal, view.page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 30000 }))
            assertUrlAllowed(this.config, view.page.url())
            await this.applyLiveViewport(session, view)
          }
        } catch (error) {
          // Page 鍒涘缓鍚庣殑瀵艰埅銆佸彇娑堟垨鏈€缁?URL 鏍￠獙澶辫触蹇呴』鏁翠綋鍥炴粴锛屽苟鎭㈠璋冪敤鍓嶇殑娲诲姩椤电锛屼繚璇?new 鎿嶄綔鍏峰鍘熷瓙鎬с€?
          await page.close({ runBeforeUnload: false }).catch(() => {})
          const previous = session.views.get(previousActiveViewId)
          const active = previous !== undefined && previous.kind === 'page' && !previous.page.isClosed() ? previous : [...session.views.values()].find(candidate => candidate.kind === 'page' && !candidate.page.isClosed())
          if (active !== undefined) {
            session.activeViewId = active.viewId
            await active.page.bringToFront().catch(() => {})
          }
          throw error
        }
      } else if (action === 'select') {
        const view = this.viewByInput(session, input.viewId, input.index)
        const pane = this.splitPaneForView(session, view.viewId)
        if (session.splitView.enabled) {
          if (pane !== undefined) session.splitView.focusedPane = pane
          else if (session.splitView.focusedPane === 'top') session.splitView.topViewId = view.viewId
          else session.splitView.bottomViewId = view.viewId
        }
        session.activeViewId = view.viewId
        await view.page.bringToFront()
        await this.syncScreencasts(session)
      } else if (action === 'close') {
        const view = this.viewByInput(session, input.viewId, input.index)
        await view.page.close({ runBeforeUnload: false })
        const next = [...session.views.values()].find(item => item.kind === 'page') ?? await this.refreshPage(session, view.page)
        session.activeViewId = next.viewId
      } else if (action !== 'list') {
        fail('INVALID_ARGS', `unknown browser_tabs action ${JSON.stringify(action)}`)
      }
      const views = [...session.views.values()].filter(view => view.kind === 'page')
      const tabs = views.map((view, index) => ({
        index,
        viewId: view.viewId,
        url: view.page.url(),
        title: '',
        active: view.viewId === session.activeViewId,
        status: view.page.isClosed() ? 'closed' : 'loaded',
      }))
      for (let index = 0; index < tabs.length; index += 1) tabs[index]!.title = await views[index]!.page.title().catch(() => '')
      return { ok: true, action: 'tabs', viewId: session.activeViewId, data: asData({ tabs }) }
    })
  }

  async navigate(identity: Identity, signal: AbortSignal, input: { url: string; viewId?: string; timeoutMs?: number }): Promise<ToolOutput> {
    return this.withSession(identity, signal, async session => {
      const view = this.view(session, input.viewId)
      const blocked = this.modelWriteBlocked(session, view, 'navigate')
      if (blocked !== undefined) return blocked
      const paused = this.paused(view, 'navigate')
      if (paused !== undefined) return paused
      const url = assertUrlAllowed(this.config, input.url)
      try {
        await this.runOnPage(session, view, signal, view.page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: input.timeoutMs ?? 30000 }))
      } catch (error) {
        if (signal.aborted) {
          return { ok: false, action: 'navigate', data: asData({ aborted: true }) }
        }
        fail('NAVIGATION_FAILED', `failed to navigate to ${url.origin}`, error)
      }
      assertUrlAllowed(this.config, view.page.url())
      await this.applyLiveViewport(session, view)
      return { ok: true, action: 'navigate', viewId: view.viewId, data: asData({ url: view.page.url(), title: await view.page.title() }) }
    })
  }

  async navigateBack(identity: Identity, signal: AbortSignal, input: { viewId?: string; timeoutMs?: number }): Promise<ToolOutput> {
    return this.withSession(identity, signal, async session => {
      const view = this.view(session, input.viewId)
      const blocked = this.modelWriteBlocked(session, view, 'navigate_back')
      if (blocked !== undefined) return blocked
      const before = view.page.url()
      await awaitBackNavigation(view.page, before, view.page.goBack({ waitUntil: 'domcontentloaded', timeout: input.timeoutMs ?? 30000 }))
      if (view.page.url() !== 'about:blank') assertUrlAllowed(this.config, view.page.url())
      await this.applyLiveViewport(session, view)
      return { ok: true, action: 'navigate_back', viewId: view.viewId, data: asData({ url: view.page.url(), title: await view.page.title() }) }
    })
  }

  async snapshot(identity: Identity, signal: AbortSignal, input: { viewId?: string; includeDiff?: boolean; maxNodes?: number }): Promise<ToolOutput> {
    return this.withSession(identity, signal, async session => {
      const view = this.view(session, input.viewId)
      const maxNodes = Math.min(Math.max(input.maxNodes ?? 80, 1), 300)
      await this.releaseViewRefs(view)
      // 鏈疆elementHandles鍏堢敱灞€閮ㄤ綔鐢ㄥ煙鎸佹湁锛屽彧鏈夋垚鍔熺敓鎴愬叕寮€Ref鐨勫彞鏌勬墠鍦ㄦ彁浜ょ偣杞Щ缁橵iew锛涘叾浣欏彞鏌勫繀椤诲湪finally閲婃斁銆?
      const handles = await view.page.locator('a,button,input,textarea,select,[role],[contenteditable="true"],[onclick],[tabindex]:not([tabindex="-1"]),div[class*="btn"],div[class*="button"],span[class*="btn"],span[class*="button"]').elementHandles()
      const nextRefs = new Map<string, RefState>()
      const retainedHandles = new Set<ElementHandle>()
      try {
        const lines: string[] = []
        const nextSnapshotGeneration = view.snapshotGeneration + 1
        for (const handle of handles) {
          if (lines.length >= maxNodes) break
          if (!await handle.isVisible().catch(() => false)) continue
          const info = await handle.evaluate(node => {
            const element = node as HTMLElement
            const tag = element.tagName.toLowerCase()
            const role = element.getAttribute('role')
            const className = typeof element.className === 'string' ? element.className : ''
            const standard = ['a', 'button', 'input', 'textarea', 'select'].includes(tag) || role !== null || element.getAttribute('contenteditable') === 'true'
            const customInteractive = typeof element.onclick === 'function' || element.hasAttribute('onclick') || element.tabIndex >= 0 || /(^|[-_\s])(btn|button)([-_\s]|$)/i.test(className)
            const disabled = 'disabled' in element && Boolean((element as HTMLButtonElement).disabled) || element.getAttribute('aria-disabled') === 'true'
            return {
              tag,
              role,
              name: element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent?.trim() || (element as HTMLInputElement).placeholder || '',
              type: (element as HTMLInputElement).type || undefined,
              interactive: standard || customInteractive,
              disabled,
            }
          })
          if (!info.interactive || info.disabled || info.name === '') continue
          const ref = `e${view.refCounter++}`
          nextRefs.set(ref, { handle, documentGeneration: view.documentGeneration, snapshotGeneration: nextSnapshotGeneration })
          lines.push(`${ref} ${info.role ?? info.tag}${info.type ? `[${info.type}]` : ''} ${JSON.stringify(info.name.slice(0, 160))}`)
        }
        view.snapshotGeneration = nextSnapshotGeneration
        for (const [ref, state] of nextRefs) {
          view.refs.set(ref, state)
          retainedHandles.add(state.handle)
        }
        const aria = await view.page.locator('body').ariaSnapshot().catch(() => '')
      const snapshotLimit = Math.min(this.config.maxOutputChars, 6000)
      const refs = `Interactive refs:\n${lines.join('\n')}`
      const ariaLimit = Math.max(snapshotLimit - refs.length - 2, 0)
      const boundedAria = aria.slice(0, ariaLimit)
      const fullSnapshot = `${boundedAria}\n\n${refs}`.slice(0, snapshotLimit)
      let diff: string | null = null
      const incrementalRequested = input.includeDiff ?? view.lastSnapshot !== undefined
      if (incrementalRequested && view.lastSnapshot !== undefined && view.lastSnapshot !== aria) {
        const previousLines = new Set(view.lastSnapshot.split('\n'))
        const currentLines = new Set(aria.split('\n'))
        const changes = [
          ...[...currentLines].filter(line => !previousLines.has(line)).map(line => `+ ${line}`),
          ...[...previousLines].filter(line => !currentLines.has(line)).map(line => `- ${line}`),
        ]
        diff = changes.join('\n').slice(0, 2000)
      }
      const incrementalSnapshot = refs.slice(0, snapshotLimit)
      const incrementalBytes = incrementalSnapshot.length + (diff?.length ?? 0)
      const useIncremental = incrementalRequested
        && view.lastSnapshot !== undefined
        && incrementalBytes < fullSnapshot.length
      // 澧為噺妯″紡濮嬬粓杩斿洖鏈疆鏈€鏂皉efs锛汚RIA鏃犲彉鍖栨椂涓嶉噸澶嶅叏鏂囷紝鏈夊彉鍖栨椂浣跨敤鏈夌晫diff銆傚閲忎笉鍒掔畻鏃惰嚜鍔ㄥ洖閫€鍏ㄦ枃锛岄伩鍏嶄负浜嗙渷瀛楃涓㈠け椤甸潰璇箟銆?
      const snapshot = useIncremental ? incrementalSnapshot : fullSnapshot
      const snapshotMode = useIncremental ? 'incremental' : 'full'
      const unchanged = view.lastSnapshot !== undefined && view.lastSnapshot === aria
      view.lastSnapshot = aria
        const truncated = handles.length > maxNodes || aria.length > ariaLimit || refs.length > snapshotLimit
        return { ok: true, action: 'snapshot', viewId: view.viewId, data: asData({ url: view.page.url(), title: await view.page.title(), documentGeneration: view.documentGeneration, snapshotGeneration: view.snapshotGeneration, snapshotMode, snapshot, diff: useIncremental ? diff : null, unchanged, truncated }) }
      } catch (error) {
        await this.releaseViewRefs(view)
        throw error
      } finally {
        await this.releaseHandles(handles.filter(handle => !retainedHandles.has(handle)))
      }
    })
  }

  async elementAction(identity: Identity, signal: AbortSignal, input: { action: string; viewId?: string; ref?: string; text?: string; key?: string; values?: string[]; timeoutMs?: number; clear?: boolean; submit?: boolean; slowly?: boolean; direction?: string; amount?: number; deltaX?: number; deltaY?: number }): Promise<ToolOutput> {
    return this.withSession(identity, signal, async session => {
      const view = this.view(session, input.viewId)
      const blocked = this.modelWriteBlocked(session, view, input.action)
      if (blocked !== undefined) return blocked
      const paused = this.paused(view, input.action)
      if (paused !== undefined) return paused
      const timeout = input.timeoutMs ?? 10000
      // 閮ㄥ垎妯″瀷浼氱敤绌哄瓧绗︿覆鍗犱綅鍙€夊瓧娈碉紱鎵ц杈圭晫缁熶竴鎶樺彔涓虹┖缂猴紝閬垮厤椤甸潰绾ф寜閿璇垽涓鸿繃鏈熷厓绱犲紩鐢ㄣ€?
      const normalizedRef = input.ref?.trim() || undefined
      let resultData: Record<string, unknown> = {}
      try {
        const handle = normalizedRef === undefined ? undefined : this.ref(view, normalizedRef)
        if (input.action === 'click') {
          if (handle === undefined) fail('INVALID_ARGS', 'browser_click requires ref; take a browser_snapshot first')
          const beforeUrl = view.page.url()
          const beforeDocumentGeneration = view.documentGeneration
          const beforeDom = await view.page.locator('body').evaluate(node => ({ elements: node.getElementsByTagName('*').length, children: node.childElementCount })).catch(() => undefined)
          await this.runOnPage(session, view, signal, handle.click({ timeout }))
          await view.page.waitForTimeout(50).catch(() => {})
          const afterUrl = view.page.url()
          const afterDom = await view.page.locator('body').evaluate(node => ({ elements: node.getElementsByTagName('*').length, children: node.childElementCount })).catch(() => undefined)
          const changeSignals = {
            url: afterUrl !== beforeUrl,
            document: view.documentGeneration !== beforeDocumentGeneration,
            dom: beforeDom !== undefined && afterDom !== undefined && (beforeDom.elements !== afterDom.elements || beforeDom.children !== afterDom.children),
          }
          resultData = { changed: changeSignals.url || changeSignals.document || changeSignals.dom, changeSignals }
        } else if (input.action === 'type') {
          if (handle === undefined) fail('INVALID_ARGS', 'browser_type requires ref; take a browser_snapshot first')
          if (input.clear ?? true) await this.runOnPage(session, view, signal, handle.fill('', { timeout }))
          if (input.slowly === true) await this.runOnPage(session, view, signal, handle.type(input.text ?? '', { delay: 35, timeout }))
          else await this.runOnPage(session, view, signal, handle.fill(input.text ?? '', { timeout }))
          if (input.submit === true) await this.runOnPage(session, view, signal, handle.press('Enter', { timeout }))
        } else if (input.action === 'hover') {
          if (handle === undefined) fail('INVALID_ARGS', 'browser_hover requires ref; take a browser_snapshot first')
          await this.runOnPage(session, view, signal, handle.hover({ timeout }))
        } else if (input.action === 'scroll') {
          if (handle !== undefined) await this.runOnPage(session, view, signal, handle.scrollIntoViewIfNeeded({ timeout }))
          else {
            const amount = input.amount ?? 300
            const dx = input.deltaX ?? (input.direction === 'left' ? -amount : input.direction === 'right' ? amount : 0)
            const dy = input.deltaY ?? (input.direction === 'up' ? -amount : input.direction === 'down' ? amount : 0)
            await this.runOnPage(session, view, signal, view.page.mouse.wheel(dx, dy))
          }
        } else if (input.action === 'press_key') {
          if (input.key === undefined || input.key === '') fail('INVALID_ARGS', 'browser_press_key requires key')
          if (handle === undefined) await this.runOnPage(session, view, signal, view.page.keyboard.press(input.key))
          else await this.runOnPage(session, view, signal, handle.press(input.key, { timeout }))
        } else if (input.action === 'select_option') {
          if (handle === undefined) fail('INVALID_ARGS', 'browser_select_option requires ref; take a browser_snapshot first')
          await this.runOnPage(session, view, signal, handle.selectOption(input.values ?? [], { timeout }))
        }
        else fail('INVALID_ARGS', `unknown browser element action ${JSON.stringify(input.action)}`)
      } catch (error) {
        if (error instanceof Error && (error as { code?: string }).code === 'STALE_REF') return this.stale(view, input.action)
        if (normalizedRef !== undefined) {
          const ref = view.refs.get(normalizedRef)
          if (ref === undefined || await ref.handle.isHidden().catch(() => true)) return this.stale(view, input.action)
        }
        throw error
      }
      return { ok: true, action: input.action, viewId: view.viewId, data: asData({ url: view.page.url(), ...resultData }) }
    })
  }

  async waitFor(identity: Identity, signal: AbortSignal, input: { viewId?: string; text?: string; textGone?: string; state?: string; time?: number; timeMs?: number; timeoutMs?: number }): Promise<ToolOutput> {
    return this.withSession(identity, signal, async session => {
      const view = this.view(session, input.viewId)
      // Schema骞抽摵鐨勫彲閫夊瓧娈靛父琚ā鍨嬩互绌哄瓧绗︿覆鎴栭浂鍊艰ˉ榻愶紱鍙湁闈炵┖鏂囨湰鍜屾鏁版椂闂存墠鏋勬垚瀹為檯鏉′欢銆?
      const text = input.text?.trim() || undefined
      const textGone = input.textGone?.trim() || undefined
      const time = input.time !== undefined && input.time > 0 ? input.time : undefined
      const timeMs = input.timeMs !== undefined && input.timeMs > 0 ? input.timeMs : undefined
      if (time !== undefined && timeMs !== undefined) fail('INVALID_ARGS', 'browser_wait_for accepts either positive time seconds or positive timeMs, not both')
      const delay = timeMs ?? (time === undefined ? undefined : Math.round(time * 1000))
      if (delay !== undefined) await new Promise<void>((resolveWait, reject) => {
        const timer = setTimeout(resolveWait, delay)
        const onAbort = () => { clearTimeout(timer); reject(abortReason(signal)) }
        signal.addEventListener('abort', onAbort, { once: true })
      })
      else if (text !== undefined) await this.runOnPage(session, view, signal, view.page.getByText(text, { exact: false }).waitFor({ state: input.state === 'hidden' ? 'hidden' : 'visible', timeout: input.timeoutMs ?? 30000 }))
      else if (textGone !== undefined) await this.runOnPage(session, view, signal, view.page.getByText(textGone, { exact: false }).waitFor({ state: 'hidden', timeout: input.timeoutMs ?? 30000 }))
      else await this.runOnPage(session, view, signal, view.page.waitForLoadState(input.state === 'networkidle' ? 'networkidle' : 'domcontentloaded', { timeout: input.timeoutMs ?? 30000 }))
      return { ok: true, action: 'wait_for', viewId: view.viewId, data: asData({ waitedMs: delay ?? null, condition: text ?? textGone ?? input.state ?? 'domcontentloaded' }) }
    })
  }

  async screenshot(identity: Identity, signal: AbortSignal, input: { viewId?: string; fullPage?: boolean }): Promise<ToolOutput> {
    return this.withSession(identity, signal, async session => {
      const view = this.view(session, input.viewId)
      const data = await view.page.screenshot({ type: 'png', fullPage: input.fullPage ?? false })
      const image = await this.attachments.saveImage({ data, mediaType: 'image/png', name: 'browser-screenshot.png' })
      return { ok: true, action: 'screenshot', viewId: view.viewId, data: asData(image) }
    })
  }

  async getAttribute(identity: Identity, signal: AbortSignal, input: { viewId?: string; ref: string; name: string }): Promise<ToolOutput> {
    return this.withSession(identity, signal, async session => {
      const view = this.view(session, input.viewId)
      if (/^(value|srcdoc|nonce)$/i.test(input.name)) fail('POLICY_DENIED', `attribute ${input.name} is not readable`)
      const value = await this.ref(view, input.ref).getAttribute(input.name)
      return { ok: true, action: 'get_attribute', viewId: view.viewId, data: asData({ name: input.name, value }) }
    })
  }

  async query(identity: Identity, signal: AbortSignal, input: { viewId?: string; frameId?: string; selector: string; field: string; attribute?: string; limit?: number }): Promise<ToolOutput> {
    return this.withSession(identity, signal, async session => {
      const view = this.view(session, input.viewId)
      let frame = view.page.mainFrame()
      let frameIdentity: EvidenceContextIdentity = {}
      if (input.frameId !== undefined && input.frameId.trim() !== '') {
        const adapter = view.cdp?.contextAdapter
        if (adapter?.isEnabled() !== true) fail('INVALID_ARGS', 'frameId query requires an active browser diagnose session')
        const topology = adapter.snapshot()
        const requested = topology.frames.find(candidate => candidate.frameId === input.frameId && candidate.viewId === view.viewId && candidate.attached)
        if (requested === undefined) fail('INVALID_ARGS', 'frameId does not identify an attached Frame in the current diagnose session')
        let mainOrigin = ''
        let frameOrigin = ''
        try { mainOrigin = new URL(view.page.url()).origin } catch {}
        try { frameOrigin = new URL(requested.url).origin } catch {}
        if (requested.oopif || mainOrigin === '' || frameOrigin !== mainOrigin) fail('POLICY_DENIED', 'FRAME_QUERY_CROSS_ORIGIN_UNAVAILABLE: cross-origin and OOPIF element queries remain unavailable')
        const matches = view.page.frames().filter(candidate => adapter.contextForFrame(candidate).frameId === requested.frameId)
        if (matches.length !== 1) fail('INVALID_ARGS', 'frameId could not be resolved to one Playwright Frame')
        frame = matches[0]!
        frameIdentity = adapter.contextForFrame(frame)
      }
      const locator = frame.locator(input.selector)
      const limit = Math.min(Math.max(input.limit ?? 10, 1), 50)
      const count = await locator.count()
      if (input.field === 'count') return { ok: true, action: 'query', viewId: view.viewId, data: asData({ count }) }
      if (input.field === 'refs') {
        // refs鏌ヨ浼氬缓绔嬩竴缁勬柊鐨勭煭鏈熷紩鐢ㄥ苟浣挎棫蹇収寮曠敤澶辨晥锛涙湭鍏紑鎴栬秴杩噇imit鐨凟lementHandle涔熷繀椤荤敱鏈疆閲婃斁銆?
        await this.releaseViewRefs(view)
        const handles = await locator.elementHandles()
        const retainedHandles = new Set<ElementHandle>()
        try {
          const nextSnapshotGeneration = view.snapshotGeneration + 1
          const nextRefs = new Map<string, RefState>()
          const refs: Array<{ ref: string; text: string; visible: boolean }> = []
          for (const handle of handles.slice(0, limit)) {
            const visible = await handle.isVisible().catch(() => false)
            const text = (await handle.evaluate(node => (node as HTMLElement).getAttribute('aria-label') || (node as HTMLElement).getAttribute('title') || node.textContent?.trim() || '').catch(() => '')).slice(0, 160)
            if (!visible || text === '') continue
            const ref = `e${view.refCounter++}`
            nextRefs.set(ref, { handle, documentGeneration: view.documentGeneration, snapshotGeneration: nextSnapshotGeneration })
            refs.push({ ref, text, visible })
          }
          view.snapshotGeneration = nextSnapshotGeneration
          for (const [ref, state] of nextRefs) {
            view.refs.set(ref, state)
            retainedHandles.add(state.handle)
          }
          return { ok: true, action: 'query', viewId: view.viewId, data: asData({ count, refs, documentGeneration: view.documentGeneration, snapshotGeneration: view.snapshotGeneration, ...frameIdentity }) }
        } catch (error) {
          await this.releaseViewRefs(view)
          throw error
        } finally {
          await this.releaseHandles(handles.filter(handle => !retainedHandles.has(handle)))
        }
      }
      const values: unknown[] = []
      for (let index = 0; index < Math.min(count, limit); index += 1) {
        const item = locator.nth(index)
        if (input.field === 'text') values.push((await item.innerText().catch(() => '')).slice(0, 400))
        else if (input.field === 'visible') values.push(await item.isVisible())
        else if (input.field === 'attribute') {
          if (input.attribute === undefined || /^(value|srcdoc|nonce)$/i.test(input.attribute)) fail('POLICY_DENIED', 'query attribute is not readable')
          values.push(await item.getAttribute(input.attribute))
        } else fail('INVALID_ARGS', `unknown browser query field ${JSON.stringify(input.field)}`)
      }
      return { ok: true, action: 'query', viewId: view.viewId, data: asData({ count, values }) }
    })
  }

  async consoleMessages(identity: Identity, signal: AbortSignal, input: { viewId?: string; clear?: boolean }): Promise<ToolOutput> {
    return this.withSession(identity, signal, async session => {
      const view = this.view(session, input.viewId)
      const messages = view.console.slice(-100)
      if (input.clear === true) view.console.length = 0
      return { ok: true, action: 'console_messages', viewId: view.viewId, data: asData({ messages }) }
    })
  }

  async networkRequests(identity: Identity, signal: AbortSignal, input: { viewId?: string; clear?: boolean }): Promise<ToolOutput> {
    return this.withSession(identity, signal, async session => {
      const view = this.view(session, input.viewId)
      const requests = view.network.slice(-150)
      if (input.clear === true) view.network.length = 0
      return { ok: true, action: 'network_requests', viewId: view.viewId, data: asData({ requests }) }
    })
  }

  async handleDialog(identity: Identity, signal: AbortSignal, input: { viewId?: string; accept: boolean; promptText?: string }): Promise<ToolOutput> {
    return this.withSession(identity, signal, async session => {
      const view = this.view(session, input.viewId)
      const blocked = this.modelWriteBlocked(session, view, 'handle_dialog')
      if (blocked !== undefined) return blocked
      if (view.dialog !== undefined) {
        const dialog = view.dialog
        view.dialog = undefined
        if (input.accept) await dialog.accept(input.promptText)
        else await dialog.dismiss()
        return { ok: true, action: 'handle_dialog', viewId: view.viewId, data: asData({ resolved: true }) }
      }
      view.dialogPolicy = { accept: input.accept, ...(input.promptText === undefined ? {} : { promptText: input.promptText }) }
      return { ok: true, action: 'handle_dialog', viewId: view.viewId, data: asData({ preconfigured: true }) }
    })
  }

  async upload(identity: Identity, signal: AbortSignal, input: { viewId?: string; ref: string; filePath: string }): Promise<ToolOutput> {
    return this.withSession(identity, signal, async session => {
      const view = this.view(session, input.viewId)
      const blocked = this.modelWriteBlocked(session, view, 'upload_file')
      if (blocked !== undefined) return blocked
      const filePath = assertUploadPath(this.config, input.filePath)
      const info = await stat(filePath)
      if (!info.isFile() || info.size > this.config.maxUploadBytes) fail('POLICY_DENIED', 'upload file is invalid or exceeds the configured size limit')
      await this.ref(view, input.ref).setInputFiles(filePath)
      return { ok: true, action: 'upload_file', viewId: view.viewId, data: asData({ name: basename(filePath), bytes: info.size }) }
    })
  }

  async download(identity: Identity, signal: AbortSignal, input: { viewId?: string; ref: string; timeoutMs?: number }): Promise<ToolOutput> {
    return this.withSession(identity, signal, async session => {
      const view = this.view(session, input.viewId)
      const blocked = this.modelWriteBlocked(session, view, 'download')
      if (blocked !== undefined) return blocked
      const [download] = await Promise.all([
        view.page.waitForEvent('download', { timeout: input.timeoutMs ?? 30000 }),
        this.ref(view, input.ref).click({ timeout: input.timeoutMs ?? 30000 }),
      ])
      const name = basename(download.suggestedFilename()).replace(/[^\w.() -]/g, '_') || 'download.bin'
      const directory = join(this.config.artifactRoot, session.key.replace(/[^\w.-]/g, '_'))
      await mkdir(directory, { recursive: true })
      const path = join(directory, `${Date.now()}-${name}`)
      await download.saveAs(path)
      const info = await stat(path)
      if (info.size > this.config.maxDownloadBytes) {
        await rm(path, { force: true })
        fail('POLICY_DENIED', 'download exceeds the configured size limit')
      }
      return { ok: true, action: 'download', viewId: view.viewId, data: asData({ artifact: path, name, bytes: info.size }) }
    })
  }

  async debugger(identity: Identity, signal: AbortSignal, input: BrowserDebuggerInput): Promise<ToolOutput> {
    return this.withSession(identity, signal, session => this.debuggerAction(session, input))
  }

  async diagnose(identity: Identity, signal: AbortSignal, input: BrowserDiagnoseInput): Promise<ToolOutput> {
    return this.withSession(identity, signal, session => this.diagnoseAction(session, input))
  }

  async networkControl(identity: Identity, signal: AbortSignal, input: BrowserNetworkInput): Promise<ToolOutput> {
    return this.withSession(identity, signal, session => this.networkAction(session, input))
  }

  async profile(identity: Identity, signal: AbortSignal, input: BrowserProfileInput): Promise<ToolOutput> {
    return this.withSession(identity, signal, session => this.profileAction(session, input))
  }

  async provider(identity: Identity, signal: AbortSignal, input: BrowserProviderInput): Promise<ToolOutput> {
    requireActive(signal)
    const session = await this.createSession(identity)
    if (input.action === 'list' || input.action === 'capabilities') {
      return this.queueSession(session, () => this.providerAction(session, input))
    }
    return this.queueSharedContext(() => this.queueSessions([session], async () => {
      requireActive(signal)
      return this.providerAction(session, input)
    }))
  }

  async extensions(identity: Identity, signal: AbortSignal, input: BrowserExtensionInput): Promise<ToolOutput> {
    requireActive(signal)
    const session = await this.createSession(identity)
    if (!this.extensionMutationRequiresSharedLock(session, input)) {
      return this.queueSession(session, async () => {
        requireActive(signal)
        return this.extensionAction(session, input)
      })
    }
    return this.queueSharedContext(async () => {
      const sessions = this.sharedSessions()
      return this.queueSessions(sessions, async () => {
        requireActive(signal)
        return this.extensionAction(session, input)
      })
    })
  }

  async emulate(identity: Identity, signal: AbortSignal, input: BrowserEmulateInput): Promise<ToolOutput> {
    return this.withSession(identity, signal, session => this.emulateAction(session, input))
  }

  async liveView(identity: Identity, signal: AbortSignal, input: BrowserLiveViewInput): Promise<ToolOutput> {
    return this.withSession(identity, signal, session => this.liveViewAction(session, input))
  }

  async splitView(identity: Identity, signal: AbortSignal, input: BrowserSplitViewInput): Promise<ToolOutput> {
    return this.withSession(identity, signal, session => this.splitViewAction(session, input))
  }

  async evaluate(identity: Identity, signal: AbortSignal, input: BrowserEvaluateInput): Promise<ToolOutput> {
    return this.withSession(identity, signal, async session => {
      const view = this.view(session, input.viewId)
      const blocked = this.modelWriteBlocked(session, view, 'evaluate')
      if (blocked !== undefined) return blocked
      return this.evaluateAction(session, input)
    })
  }

  async takeover(identity: Identity, signal: AbortSignal, input: BrowserTakeoverInput): Promise<ToolOutput> {
    return this.withSession(identity, signal, session => this.takeoverAction(session, input))
  }
}

