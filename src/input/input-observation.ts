import type { ViewState } from '../domain/types.ts'
import { inputSensitivity } from '../diagnostics/input-trace.ts'

export interface InputObservation {
  sensitivity: ReturnType<typeof inputSensitivity>
  initialLength: number
}

export interface InputObservationResult {
  observed: boolean
  composing: boolean
  prevented: boolean
  beforeInputObserved: boolean
  compositionStarted: boolean
  compositionUpdated: boolean
  compositionEnded: boolean
  events: Array<{ type: string; composing: boolean; defaultPrevented: boolean; inputType: string; length: number }>
  targetReplaced: boolean
  focusLost: boolean
  initialLength: number
  finalLength: number
}

export async function beginInputObservation(view: ViewState, inputTraceId: string): Promise<InputObservation> {
  const snapshot = await view.page.evaluate((traceId) => {
    const key = '__dshBrowserInputTraces'
    const root = globalThis as typeof globalThis & { [key: string]: Record<string, unknown> }
    const traces = root[key] as Record<string, { target: Element | null; initialLength: number; events: Array<{ type: string; composing: boolean; defaultPrevented: boolean; inputType: string; length: number }>; listeners: Array<[string, EventListener]> }> | undefined ?? {}
    root[key] = traces
    const target = document.activeElement
    const lengthOf = (element: Element | null) => {
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return element.value.length
      if (element instanceof HTMLElement && element.isContentEditable) return (element.textContent ?? '').length
      return 0
    }
    const events: Array<{ type: string; composing: boolean; defaultPrevented: boolean; inputType: string; length: number }> = []
    const listeners: Array<[string, EventListener]> = []
    for (const type of ['compositionstart', 'compositionupdate', 'compositionend', 'beforeinput', 'input', 'change']) {
      const listener: EventListener = event => {
        const input = event as InputEvent
        queueMicrotask(() => events.push({
          type,
          composing: input.isComposing === true,
          defaultPrevented: event.defaultPrevented,
          inputType: typeof input.inputType === 'string' ? input.inputType.slice(0, 80) : '',
          length: lengthOf(event.target instanceof Element ? event.target : target),
        }))
      }
      document.addEventListener(type, listener, true)
      listeners.push([type, listener])
    }
    const initialLength = lengthOf(target)
    traces[traceId] = { target, initialLength, events, listeners }
    const element = target instanceof HTMLElement ? target : null
    return {
      inputType: element instanceof HTMLInputElement ? element.type : '',
      autocomplete: element?.getAttribute('autocomplete') ?? '',
      name: element?.getAttribute('name') ?? '',
      id: element?.id ?? '',
      ariaLabel: element?.getAttribute('aria-label') ?? '',
      initialLength,
    }
  }, inputTraceId)
  return { sensitivity: inputSensitivity(snapshot), initialLength: snapshot.initialLength }
}

export async function finishInputObservation(view: ViewState, inputTraceId: string): Promise<InputObservationResult> {
  return view.page.evaluate((traceId) => {
    const key = '__dshBrowserInputTraces'
    const root = globalThis as typeof globalThis & { [key: string]: Record<string, unknown> }
    const traces = root[key] as Record<string, { target: Element | null; initialLength: number; events: Array<{ type: string; composing: boolean; defaultPrevented: boolean; inputType: string; length: number }>; listeners: Array<[string, EventListener]> }> | undefined
    const trace = traces?.[traceId]
    const lengthOf = (element: Element | null) => {
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return element.value.length
      if (element instanceof HTMLElement && element.isContentEditable) return (element.textContent ?? '').length
      return 0
    }
    if (trace === undefined) return {
      observed: false,
      composing: false,
      prevented: false,
      beforeInputObserved: false,
      compositionStarted: false,
      compositionUpdated: false,
      compositionEnded: false,
      events: [],
      targetReplaced: false,
      focusLost: false,
      initialLength: 0,
      finalLength: 0,
    }
    for (const [type, listener] of trace.listeners) document.removeEventListener(type, listener, true)
    delete traces?.[traceId]
    const finalTarget = document.activeElement
    const targetReplaced = trace.target !== null && !trace.target.isConnected
    const focusLost = trace.target !== null && finalTarget !== trace.target
    return {
      observed: trace.events.length > 0,
      composing: trace.events.some(event => event.composing || event.type === 'compositionstart') && !trace.events.some(event => event.type === 'compositionend'),
      prevented: trace.events.some(event => event.type === 'beforeinput' && event.defaultPrevented),
      beforeInputObserved: trace.events.some(event => event.type === 'beforeinput'),
      compositionStarted: trace.events.some(event => event.type === 'compositionstart'),
      compositionUpdated: trace.events.some(event => event.type === 'compositionupdate'),
      compositionEnded: trace.events.some(event => event.type === 'compositionend'),
      events: trace.events.slice(0, 32),
      targetReplaced,
      focusLost,
      initialLength: trace.initialLength,
      finalLength: lengthOf(finalTarget),
    }
  }, inputTraceId)
}
