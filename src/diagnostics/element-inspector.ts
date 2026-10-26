import { createHash } from 'node:crypto'
import type { ElementHandle } from 'playwright-core'
import { fail } from '../domain/errors.ts'
import type { SessionState, ViewState } from '../domain/types.ts'
import type { ApplicationIdentity, ApplicationRegistry } from './application-registry.ts'
import type { BuildRegistry } from './build-registry.ts'
import type { ElementEvidence } from './debug-session-store.ts'

export async function inspectElement(
  view: ViewState,
  ref: string,
  getHandle: (view: ViewState, ref: string) => ElementHandle,
): Promise<ElementEvidence> {
  const handle = getHandle(view, ref)
  const ownerFrame = await handle.ownerFrame().catch(() => null)
  const frameIdentity = ownerFrame === null || view.cdp?.contextAdapter?.isEnabled() !== true ? {} : view.cdp.contextAdapter.contextForFrame(ownerFrame)
  const connected = await handle.evaluate(node => node.isConnected).catch(() => false)
  if (!connected) fail('STALE_REF', `browser ref ${JSON.stringify(ref)} is detached; take a new snapshot or query`)
  const evidence = await handle.evaluate((node) => {
    if (!(node instanceof Element)) throw new Error('browser diagnose inspect requires an Element ref')
    const summarize = (element: Element) => {
      const elementRect = element.getBoundingClientRect()
      const elementStyle = getComputedStyle(element)
      const className = typeof element.className === 'string' ? element.className : element.getAttribute('class') ?? ''
      return {
        tag: element.tagName.toLowerCase(),
        ...(element.id === '' ? {} : { id: element.id.slice(0, 120) }),
        ...(className === '' ? {} : { className: className.slice(0, 200) }),
        ...(element.getAttribute('role') === null ? {} : { role: element.getAttribute('role')?.slice(0, 80) }),
        ...((element.getAttribute('aria-label') || element.getAttribute('title') || '').trim() === ''
          ? {}
          : { accessibleName: (element.getAttribute('aria-label') || element.getAttribute('title') || '').trim().slice(0, 200) }),
        box: { x: elementRect.x, y: elementRect.y, width: elementRect.width, height: elementRect.height },
        styles: {
          display: elementStyle.display,
          visibility: elementStyle.visibility,
          opacity: elementStyle.opacity,
          pointerEvents: elementStyle.pointerEvents,
          position: elementStyle.position,
          zIndex: elementStyle.zIndex,
        },
      }
    }
    const rect = node.getBoundingClientRect()
    const style = getComputedStyle(node)
    const clippingAncestors = []
    const stackingContexts = []
    let ancestor = node.parentElement
    while (ancestor !== null && (clippingAncestors.length < 8 || stackingContexts.length < 8)) {
      const ancestorStyle = getComputedStyle(ancestor)
      if (clippingAncestors.length < 8 && /hidden|clip|scroll|auto/.test(`${ancestorStyle.overflowX} ${ancestorStyle.overflowY}`)) {
        const ancestorRect = ancestor.getBoundingClientRect()
        clippingAncestors.push({
          tag: ancestor.tagName.toLowerCase(),
          ...(ancestor.id === '' ? {} : { id: ancestor.id.slice(0, 120) }),
          ...(typeof ancestor.className !== 'string' || ancestor.className === '' ? {} : { className: ancestor.className.slice(0, 200) }),
          overflowX: ancestorStyle.overflowX,
          overflowY: ancestorStyle.overflowY,
          box: { x: ancestorRect.x, y: ancestorRect.y, width: ancestorRect.width, height: ancestorRect.height },
        })
      }
      if (stackingContexts.length < 8 && ((ancestorStyle.position !== 'static' && ancestorStyle.zIndex !== 'auto')
        || ancestorStyle.transform !== 'none'
        || ancestorStyle.filter !== 'none'
        || ancestorStyle.isolation === 'isolate'
        || Number(ancestorStyle.opacity) < 1)) {
        stackingContexts.push(summarize(ancestor))
      }
      ancestor = ancestor.parentElement
    }
    const visible = style.display !== 'none'
      && style.visibility !== 'hidden'
      && Number(style.opacity) > 0
      && rect.width > 0
      && rect.height > 0
    const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    const centerInsideViewport = center.x >= 0 && center.y >= 0 && center.x < innerWidth && center.y < innerHeight
    const topNode = centerInsideViewport ? document.elementFromPoint(center.x, center.y) : null
    const topElement = topNode instanceof Element ? topNode : null
    const nodeRoot = node.getRootNode()
    const retargetedHost = nodeRoot instanceof ShadowRoot ? nodeRoot.host : null
    const targetMatches = topElement !== null && (topElement === node || node.contains(topElement) || topElement === retargetedHost)
    const occlusionChain = []
    let occluder = targetMatches ? null : topElement
    while (occluder !== null && occlusionChain.length < 8) {
      occlusionChain.push(summarize(occluder))
      occluder = occluder.parentElement
    }
    const selectorHints = []
    if (node.id !== '') selectorHints.push(`#${CSS.escape(node.id)}`)
    for (const attribute of ['data-testid', 'data-test', 'data-qa']) {
      const value = node.getAttribute(attribute)
      if (value !== null && value !== '') selectorHints.push(`[${attribute}=${JSON.stringify(value.slice(0, 120))}]`)
    }
    const role = node.getAttribute('role')
    const accessibleName = (node.getAttribute('aria-label') || node.getAttribute('title') || (node instanceof HTMLInputElement ? node.placeholder : '') || '').trim().slice(0, 200)
    if (role !== null && role !== '') selectorHints.push(`[role=${JSON.stringify(role.slice(0, 80))}]`)
    if (accessibleName !== '') selectorHints.push(`[aria-label=${JSON.stringify(accessibleName)}]`)
    if (selectorHints.length === 0) selectorHints.push(node.tagName.toLowerCase())
    const canvas = node instanceof HTMLCanvasElement
      ? {
          cssWidth: rect.width,
          cssHeight: rect.height,
          backingWidth: node.width,
          backingHeight: node.height,
          deviceScaleFactor: devicePixelRatio,
          backingScaleX: rect.width === 0 ? null : node.width / rect.width,
          backingScaleY: rect.height === 0 ? null : node.height / rect.height,
          centerLocalPoint: { x: center.x - rect.left, y: center.y - rect.top },
        }
      : undefined
    const matrix = (value: DOMMatrix | SVGMatrix | null) => value === null ? undefined : { a: value.a, b: value.b, c: value.c, d: value.d, e: value.e, f: value.f }
    const rootGenerationsKey = '__dshShadowRootGenerations'
    const rootCounterKey = '__dshShadowRootCounter'
    const globals = globalThis as typeof globalThis & { [key: string]: unknown }
    const rootGenerations = globals[rootGenerationsKey] instanceof WeakMap
      ? globals[rootGenerationsKey] as WeakMap<ShadowRoot, number>
      : new WeakMap<ShadowRoot, number>()
    globals[rootGenerationsKey] = rootGenerations
    let rootCounter = typeof globals[rootCounterKey] === 'number' ? globals[rootCounterKey] as number : 0
    const shadowHosts: Array<{ tag: string; id?: string }> = []
    const slotPath: Array<{ name: string; assigned: boolean }> = []
    const composedTreePath: string[] = []
    const maxShadowDepth = 8
    let shadowDepth = 0
    let rootGeneration = 0
    let current: Node | null = node
    while (current !== null && shadowDepth < maxShadowDepth) {
      if (current instanceof Element) {
        composedTreePath.push(current.tagName.toLowerCase())
        if (current.assignedSlot !== null) slotPath.push({ name: current.assignedSlot.name, assigned: true })
      }
      const root = current.getRootNode()
      if (!(root instanceof ShadowRoot)) break
      shadowDepth += 1
      let generation = rootGenerations.get(root)
      if (generation === undefined) {
        generation = ++rootCounter
        rootGenerations.set(root, generation)
      }
      rootGeneration = generation
      shadowHosts.push({ tag: root.host.tagName.toLowerCase(), ...(root.host.id === '' ? {} : { id: root.host.id.slice(0, 120) }) })
      current = root.host
    }
    const shadowTruncated = current !== null && current.getRootNode() instanceof ShadowRoot
    globals[rootCounterKey] = rootCounter
    const ownerSvg = node instanceof SVGElement ? node.ownerSVGElement ?? (node instanceof SVGSVGElement ? node : null) : null
    const ownerViewBox = ownerSvg?.viewBox?.baseVal
    const svgSurface = node instanceof SVGGraphicsElement
      ? {
          rendererType: 'svg' as const,
          tag: node.tagName.toLowerCase(),
          localBBox: (() => { try { const box = node.getBBox(); return { x: box.x, y: box.y, width: box.width, height: box.height } } catch { return undefined } })(),
          clientRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          ...(matrix(node.getCTM()) === undefined ? {} : { ctm: matrix(node.getCTM()) }),
          ...(matrix(node.getScreenCTM()) === undefined ? {} : { screenCtm: matrix(node.getScreenCTM()) }),
          ...(ownerViewBox === undefined ? {} : { viewBox: { x: ownerViewBox.x, y: ownerViewBox.y, width: ownerViewBox.width, height: ownerViewBox.height } }),
          ...(ownerSvg?.preserveAspectRatio?.baseVal === undefined ? {} : { preserveAspectRatio: ownerSvg.getAttribute('preserveAspectRatio') ?? 'xMidYMid meet' }),
          fill: style.fill,
          stroke: style.stroke,
          pointerEvents: style.pointerEvents,
          ...(style.clipPath === 'none' ? {} : { clipPath: style.clipPath }),
          ...(style.mask === 'none' ? {} : { mask: style.mask }),
          ...(style.filter === 'none' ? {} : { filter: style.filter }),
          pointerHit: targetMatches,
        }
      : undefined
    const canvasSurface = node instanceof HTMLCanvasElement
      ? {
          rendererType: 'canvas' as const,
          capabilityLevel: 'surface-only' as const,
          contextType: (node.getContext('2d') !== null ? '2d' : 'unknown') as '2d' | 'unknown',
          cssWidth: rect.width,
          cssHeight: rect.height,
          backingWidth: node.width,
          backingHeight: node.height,
          deviceScaleFactor: devicePixelRatio,
          backingScaleX: rect.width === 0 ? null : node.width / rect.width,
          backingScaleY: rect.height === 0 ? null : node.height / rect.height,
          coordinate: {
            viewportPoint: center,
            canvasCssPoint: { x: center.x - rect.left, y: center.y - rect.top },
            canvasBackingPoint: {
              x: rect.width === 0 ? 0 : (center.x - rect.left) * node.width / rect.width,
              y: rect.height === 0 ? 0 : (center.y - rect.top) * node.height / rect.height,
            },
            inBounds: center.x >= rect.left && center.x < rect.right && center.y >= rect.top && center.y < rect.bottom,
          },
        }
      : undefined
    const shadowSurface = shadowDepth > 0
      ? {
          rendererType: 'shadow-dom' as const,
          rootType: 'open' as const,
          capability: 'open-inspectable' as const,
          depth: shadowDepth,
          maxDepth: maxShadowDepth,
          truncated: shadowTruncated,
          ...(shadowTruncated ? { degradationReason: 'max-shadow-depth-exceeded' as const } : {}),
          rootGeneration,
          shadowHosts,
          slotPath,
          composedTreePath,
          ...(topElement === null ? {} : { retargetedTarget: { tag: topElement.tagName.toLowerCase(), ...(topElement.id === '' ? {} : { id: topElement.id.slice(0, 120) }) } }),
          shadowTargetMatches: targetMatches,
        }
      : undefined
    const shadowHostModes = globals.__dshShadowHostModes instanceof WeakMap ? globals.__dshShadowHostModes as WeakMap<Element, ShadowRootMode> : undefined
    const shadowHostMode = shadowHostModes?.get(node)
    const shadowHostSurface = shadowSurface === undefined && shadowHostMode !== undefined
      ? {
          rendererType: 'shadow-dom' as const,
          rootType: shadowHostMode,
          capability: shadowHostMode === 'open' ? 'open-inspectable' as const : 'host-only' as const,
          depth: 0,
          maxDepth: maxShadowDepth,
          truncated: false,
          rootGeneration: 0,
          shadowHosts: [{ tag: node.tagName.toLowerCase(), ...(node.id === '' ? {} : { id: node.id.slice(0, 120) }) }],
          slotPath: [],
          composedTreePath: [node.tagName.toLowerCase()],
          ...(topElement === null ? {} : { retargetedTarget: { tag: topElement.tagName.toLowerCase(), ...(topElement.id === '' ? {} : { id: topElement.id.slice(0, 120) }) } }),
          shadowTargetMatches: targetMatches,
        }
      : undefined
    const surface = shadowSurface ?? shadowHostSurface ?? svgSurface ?? canvasSurface ?? { rendererType: 'html' as const }
    let portalRoot: HTMLElement | null = node instanceof HTMLElement ? node : node.parentElement
    while (portalRoot !== null && !['fixed', 'absolute'].includes(getComputedStyle(portalRoot).position)) {
      portalRoot = portalRoot.parentElement
    }
    const portal = portalRoot === null
      ? undefined
      : {
          candidate: true,
          root: summarize(portalRoot),
          overflow: {
            top: Math.max(0, -rect.top),
            right: Math.max(0, rect.right - innerWidth),
            bottom: Math.max(0, rect.bottom - innerHeight),
            left: Math.max(0, -rect.left),
          },
        }
    return {
      identityBase: {
        tag: node.tagName.toLowerCase(),
        ...(role === null || role === '' ? {} : { role: role.slice(0, 80) }),
        ...(accessibleName === '' ? {} : { accessibleName }),
        selectorHints: selectorHints.slice(0, 5),
      },
      textFingerprintSource: (node.textContent || '').trim().slice(0, 500),
      visible,
      viewportIntersection: visible && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight,
      box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      styles: {
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        pointerEvents: style.pointerEvents,
        position: style.position,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        minWidth: style.minWidth,
        maxWidth: style.maxWidth,
        width: style.width,
        zIndex: style.zIndex,
        transform: style.transform,
        filter: style.filter,
        isolation: style.isolation,
      },
      clippingAncestors,
      stackingContexts,
      hitTest: {
        point: center,
        topElement: topElement === null ? null : summarize(topElement),
        targetMatches,
        occlusionChain,
      },
      ...(canvas === undefined ? {} : { canvas }),
      ...(portal === undefined ? {} : { portal }),
      surface,
    }
  })
  const { identityBase, textFingerprintSource, ...details } = evidence
  const textFingerprint = textFingerprintSource === ''
    ? undefined
    : createHash('sha256').update(textFingerprintSource).digest('hex').slice(0, 20)
  return {
    ref,
    identity: {
      resolution: 'resolved-by-ref',
      ref,
      viewId: view.viewId,
      documentGeneration: view.documentGeneration,
      navigationId: view.navigationId,
      ...frameIdentity,
      ...identityBase,
      ...(textFingerprint === undefined ? {} : { textFingerprint }),
    },
    ...details,
  }
}

export async function refreshApplications(
  session: SessionState,
  view: ViewState,
  applications: ApplicationRegistry,
  builds: BuildRegistry,
): Promise<ApplicationIdentity[]> {
  const contextTopology = view.cdp?.contextAdapter?.isEnabled() ? view.cdp.contextAdapter.snapshot() : undefined
  const mainFrame = contextTopology?.frames.find(frame => frame.mainFrame && frame.viewId === view.viewId)
  const shell = applications.upsert(session.key, {
    viewId: view.viewId,
    kind: 'shell',
    name: await view.page.title().catch(() => 'Shell') || 'Shell',
    origin: (() => { try { return new URL(view.page.url()).origin } catch { return undefined } })(),
    ...(mainFrame?.frameId === undefined ? {} : { frameId: mainFrame.frameId }),
    signals: ['confirmed-main-frame', 'active-browser-view'],
    counterEvidence: [],
    confidence: mainFrame === undefined ? 'candidate' : 'confirmed',
  })
  const buildTopology = builds.snapshot(session.key)
  for (const build of buildTopology.builds.filter(build => build.active && (mainFrame?.frameId === undefined || build.frameId === mainFrame.frameId))) {
    applications.bindBuild(session.key, shell.applicationId, build.buildId)
  }
  for (const frame of contextTopology?.frames.filter(frame => frame.viewId === view.viewId && !frame.mainFrame && frame.attached) ?? []) {
    const target = contextTopology?.targets.find(target => target.targetId === frame.targetId)
    const application = applications.upsert(session.key, {
      viewId: view.viewId,
      kind: 'iframe',
      name: frame.name || (() => { try { return new URL(frame.url).hostname } catch { return 'iframe application' } })(),
      origin: frame.origin,
      frameId: frame.frameId,
      signals: [frame.oopif ? 'confirmed-oopif-frame' : 'confirmed-frame', target === undefined ? 'target-unavailable' : 'target-associated'],
      counterEvidence: target === undefined ? ['Target identity is unavailable.'] : [],
      confidence: frame.confidence,
    })
    for (const build of buildTopology.builds.filter(build => build.active && build.frameId === frame.frameId)) {
      applications.bindBuild(session.key, application.applicationId, build.buildId)
    }
  }
  const roots = await view.page.locator('[data-dsh-application]').evaluateAll(elements => elements.slice(0, 24).map((element, index) => {
    const name = element.getAttribute('data-dsh-application')?.trim() || `application-${index + 1}`
    const kind = element.getAttribute('data-dsh-application-kind')
    const remoteEntry = element.getAttribute('data-remote-entry')
    const selector = element.id !== '' ? `#${CSS.escape(element.id)}` : `[data-dsh-application=${JSON.stringify(name)}]`
    return { name, kind, remoteEntry, selector }
  }))
  for (const root of roots) {
    const moduleFederation = root.kind === 'module-federation'
    applications.upsert(session.key, {
      viewId: view.viewId,
      kind: moduleFederation ? 'module-federation' : 'root',
      name: root.name,
      rootSelector: root.selector,
      signals: ['explicit-application-root', ...(root.remoteEntry === null ? [] : ['explicit-remote-entry'])],
      counterEvidence: moduleFederation && root.remoteEntry === null ? ['Module Federation kind is declared without a remoteEntry signal.'] : [],
      confidence: moduleFederation && root.remoteEntry === null ? 'candidate' : 'confirmed',
    })
  }
  return applications.snapshot(session.key).applications
}

export async function elementApplication(
  session: SessionState,
  view: ViewState,
  ref: string,
  getHandle: (view: ViewState, ref: string) => ElementHandle,
  applications: ApplicationRegistry,
  builds: BuildRegistry,
): Promise<ElementEvidence['application']> {
  const applicationList = await refreshApplications(session, view, applications, builds)
  const handle = getHandle(view, ref)
  const selector = await handle.evaluate(node => {
    if (!(node instanceof Element)) return undefined
    let current: Element | null = node
    while (current !== null) {
      const root = current.closest('[data-dsh-application]')
      if (root !== null) {
        const name = root.getAttribute('data-dsh-application')?.trim()
        if (name === undefined || name === '') return undefined
        return root.id !== '' ? `#${CSS.escape(root.id)}` : `[data-dsh-application=${JSON.stringify(name)}]`
      }
      const tree = current.getRootNode()
      current = tree instanceof ShadowRoot ? tree.host : null
    }
    return undefined
  })
  const application = selector === undefined
    ? applicationList.find(value => value.kind === 'shell' && value.active)
    : applicationList.find(value => value.rootSelector === selector && value.active)
  return application === undefined ? undefined : { applicationId: application.applicationId, kind: application.kind, name: application.name, confidence: application.confidence }
}

