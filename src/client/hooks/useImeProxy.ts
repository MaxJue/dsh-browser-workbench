import { useRef } from 'react'
import type { BrowserPanelSnapshot, BrowserSplitViewPane } from '../../domain/protocol.ts'
import { extractModifiers } from '../utils/modifiers.ts'
import { encodeClipboardFile, validateClipboardLimits } from '../utils/clipboard.ts'
import type { UntracedBrowserUserInput } from './usePointerGestures.ts'

export function useImeProxy(
  snapshot: BrowserPanelSnapshot,
  livePanelRef: React.RefObject<HTMLDivElement | null>,
  liveIdentity: (pane?: BrowserSplitViewPane) => { viewId: string; streamGeneration: number; frameSequence: number; viewportGeneration: number } | undefined,
  runInput: (input: UntracedBrowserUserInput, clientRawAt?: number) => Promise<unknown>,
  setError: (error?: string) => void,
) {
  const imeProxyRef = useRef<HTMLTextAreaElement>(null)
  const imePaneRef = useRef<BrowserSplitViewPane | undefined>(undefined)
  const compositionActive = useRef(false)
  const suppressNextBeforeInput = useRef(false)

  const focusImeProxy = (clientX: number, clientY: number, pane?: BrowserSplitViewPane) => {
    const panel = livePanelRef.current
    const proxy = imeProxyRef.current
    if (panel === null || proxy === null) return
    const rect = panel.getBoundingClientRect()
    proxy.style.left = `${Math.min(Math.max(clientX - rect.left, 0), Math.max(rect.width - 1, 0))}px`
    proxy.style.top = `${Math.min(Math.max(clientY - rect.top, 0), Math.max(rect.height - 1, 0))}px`
    imePaneRef.current = pane
    proxy.focus({ preventScroll: true })
  }

  const sendKey = (event: React.KeyboardEvent, pane?: BrowserSplitViewPane) => {
    if (snapshot.control?.owner !== 'user') return
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') return
    event.stopPropagation()
    if (event.nativeEvent.isComposing || compositionActive.current || event.key === 'Process' || event.key === 'Dead') return
    event.preventDefault()
    if (['Control', 'Alt', 'Shift', 'Meta', 'AltGraph'].includes(event.key)) return
    const identity = liveIdentity(pane)
    if (identity !== undefined) {
      void runInput({ action: 'key_press', key: event.key, modifiers: extractModifiers(event), ...identity })
    }
  }

  const commitImeText = (text: string, composing = false) => {
    if (text === '' || snapshot.control?.owner !== 'user') return
    const identity = liveIdentity(imePaneRef.current)
    if (identity !== undefined) {
      void runInput({ action: composing ? 'composition_commit' : 'insert_text', text, composing, ...identity })
    }
  }

  const pasteClipboard = async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (snapshot.control?.owner !== 'user') return
    const identity = liveIdentity(imePaneRef.current)
    if (identity === undefined) return
    const clipboard = event.clipboardData
    const files = [...clipboard.files]
    const text = clipboard.getData('text/plain') || undefined
    const html = clipboard.getData('text/html') || undefined
    const uriList = clipboard.getData('text/uri-list') || undefined
    const textBytes = new TextEncoder().encode(`${text ?? ''}${html ?? ''}${uriList ?? ''}`).byteLength

    const validation = validateClipboardLimits(files, textBytes)
    if (!validation.valid) {
      event.preventDefault()
      event.stopPropagation()
      event.currentTarget.value = ''
      setError(validation.error)
      return
    }

    if (text === undefined && html === undefined && uriList === undefined && files.length === 0) return
    event.preventDefault()
    event.stopPropagation()
    suppressNextBeforeInput.current = true
    event.currentTarget.value = ''
    try {
      const encodedFiles = await Promise.all(files.map(encodeClipboardFile))
      await runInput({
        action: 'paste',
        ...(text === undefined ? {} : { text }),
        ...(html === undefined ? {} : { html }),
        ...(uriList === undefined ? {} : { uriList }),
        ...(encodedFiles.length === 0 ? {} : { files: encodedFiles }),
        ...identity,
      })
    } finally {
      window.setTimeout(() => {
        suppressNextBeforeInput.current = false
      }, 0)
    }
  }

  const imeProxyHandlers = {
    onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        !event.nativeEvent.isComposing &&
        !compositionActive.current &&
        (event.key === ' ' || event.code === 'Space')
      ) {
        event.preventDefault()
        event.stopPropagation()
        commitImeText(' ')
        event.currentTarget.value = ''
        return
      }
      if (!event.ctrlKey && !event.altKey && !event.metaKey && event.key.length === 1) return
      sendKey(event, imePaneRef.current)
    },
    onCompositionStart: () => {
      compositionActive.current = true
      suppressNextBeforeInput.current = false
    },
    onCompositionEnd: (event: React.CompositionEvent<HTMLTextAreaElement>) => {
      compositionActive.current = false
      suppressNextBeforeInput.current = true
      commitImeText(event.data, true)
      event.currentTarget.value = ''
      window.setTimeout(() => {
        suppressNextBeforeInput.current = false
      }, 0)
    },
    onPaste: (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      void pasteClipboard(event)
    },
    onBeforeInput: (event: React.FormEvent<HTMLTextAreaElement>) => {
      const input = (event as unknown as { nativeEvent: InputEvent }).nativeEvent
      if (compositionActive.current || input.isComposing || input.inputType === 'insertCompositionText') return
      if (suppressNextBeforeInput.current) {
        suppressNextBeforeInput.current = false
        event.preventDefault()
        event.currentTarget.value = ''
        return
      }
      const inputType = typeof input.inputType === 'string' ? input.inputType : ''
      if ((inputType !== '' && inputType !== 'insertText') || input.data === null || input.data === '') return
      event.preventDefault()
      commitImeText(input.data)
      event.currentTarget.value = ''
    },
  }

  return { imeProxyRef, imePaneRef, focusImeProxy, sendKey, commitImeText, imeProxyHandlers }
}
