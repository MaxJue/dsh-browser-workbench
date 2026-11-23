import { useRef } from 'react'
import type { BrowserSplitViewPane, BrowserUserInput } from '../../domain/protocol.ts'
import { extractModifiers } from '../utils/modifiers.ts'
import { encodeClipboardFile, validateClipboardLimits } from '../utils/clipboard.ts'
import type { LiveIdentity } from './usePointerGestures.ts'

/**
 * 实况画面没有可聚焦的真实输入框，所以在面板里放一个 1px 的透明 textarea 当输入法代理。
 *
 * 点击画面时把它挪到点击位置并聚焦，之后键盘、输入法组合与粘贴都由它接收，再翻译成
 * CDP 的 insertText / key_press / paste。这样中文输入法、Backspace、方向键和剪贴板都
 * 走浏览器原生路径，而不是靠猜。
 */
export function useImeProxy(
  livePanelRef: React.RefObject<HTMLDivElement | null>,
  liveIdentity: (pane?: BrowserSplitViewPane) => LiveIdentity | undefined,
  runInput: (input: BrowserUserInput) => Promise<unknown>,
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
    if (text === '') return
    const identity = liveIdentity(imePaneRef.current)
    if (identity !== undefined) {
      void runInput({ action: composing ? 'composition_commit' : 'insert_text', text, ...identity })
    }
  }

  const pasteClipboard = async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
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
      void runInput({
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
