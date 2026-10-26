import { fail } from '../domain/errors.ts'
import type { BrowserUserInput } from '../domain/protocol.ts'
import type { SessionState, ToolOutput, ViewState } from '../domain/types.ts'
import type { CdpState } from '../cdp/cdp-state.ts'
import { rawCdp } from '../cdp/cdp-raw.ts'

export interface UserInputActionDependencies {
  session: SessionState
  view: ViewState
  state: CdpState
  input: BrowserUserInput
}

function asData(value: unknown): ToolOutput['data'] {
  return value as ToolOutput['data']
}

function recoverable(viewId: string, code: string, message: string): ToolOutput {
  return { ok: false, action: 'user_input', viewId, data: asData({ code, recoverable: true, message }) }
}

export async function dispatchUserInput(dependencies: UserInputActionDependencies): Promise<ToolOutput> {
  const { input, view, state } = dependencies
  const client = rawCdp(state.session)
  const frame = state.latestFrame
  if (
    frame === undefined
    || frame.streamGeneration !== input.streamGeneration
    || frame.viewportGeneration !== input.viewportGeneration
    || view.viewport.generation !== input.viewportGeneration
  ) {
    return recoverable(view.viewId, 'STALE_LIVE_VIEW', 'The live view changed before the user input was delivered. Wait for the newest frame and try again.')
  }
  const coordinateInput = input.action === 'mouse_click' || input.action === 'mouse_down' || input.action === 'mouse_move' || input.action === 'mouse_up' || input.action === 'mouse_wheel'
  if (coordinateInput && (input.x < 0 || input.x >= view.viewport.width || input.y < 0 || input.y >= view.viewport.height)) {
    return recoverable(view.viewId, 'INPUT_OUT_OF_RANGE', 'The pointer coordinate is outside the current browser viewport.')
  }
  if (input.action === 'mouse_click') {
    const button = input.button ?? 'left'
    const clickCount = Math.min(Math.max(input.clickCount ?? 1, 1), 3)
    await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: input.x, y: input.y, button, clickCount })
    await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: input.x, y: input.y, button, clickCount })
  } else if (input.action === 'mouse_down') {
    const button = input.button ?? 'left'
    const clickCount = Math.min(Math.max(input.clickCount ?? 1, 1), 3)
    if (view.userPointer !== undefined) {
      await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: input.x, y: input.y, button: view.userPointer.button, clickCount: view.userPointer.clickCount }).catch(() => {})
    }
    await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: input.x, y: input.y, button, clickCount })
    view.userPointer = { button, clickCount, streamGeneration: input.streamGeneration, viewportGeneration: input.viewportGeneration }
  } else if (input.action === 'mouse_move') {
    const pointer = view.userPointer
    if (pointer === undefined || pointer.streamGeneration !== input.streamGeneration || pointer.viewportGeneration !== input.viewportGeneration) {
      return recoverable(view.viewId, 'POINTER_GESTURE_NOT_ACTIVE', 'The pointer drag is no longer active. Press again before moving.')
    }
    const buttons = pointer.button === 'left' ? 1 : pointer.button === 'right' ? 2 : 4
    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: input.x, y: input.y, button: pointer.button, buttons })
  } else if (input.action === 'mouse_up') {
    const pointer = view.userPointer
    if (pointer === undefined || pointer.streamGeneration !== input.streamGeneration || pointer.viewportGeneration !== input.viewportGeneration) {
      return recoverable(view.viewId, 'POINTER_GESTURE_NOT_ACTIVE', 'The pointer drag is no longer active. Press again before releasing.')
    }
    try {
      await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: input.x, y: input.y, button: pointer.button, clickCount: pointer.clickCount })
    } finally {
      view.userPointer = undefined
    }
  } else if (input.action === 'mouse_wheel') {
    const deltaX = Math.min(Math.max(input.deltaX, -2000), 2000)
    const deltaY = Math.min(Math.max(input.deltaY, -2000), 2000)
    await client.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: input.x, y: input.y, deltaX, deltaY })
  } else if (input.action === 'key_press') {
    const modifiers = [...new Set(input.modifiers ?? [])]
    await view.page.keyboard.press([...modifiers, input.key].join('+'))
  } else if (input.action === 'insert_text') {
    await client.send('Input.insertText', { text: input.text })
  } else if (input.action === 'composition_commit') {
    const selection = [...input.text].length
    await client.send('Input.imeSetComposition', { text: input.text, selectionStart: selection, selectionEnd: selection })
    await client.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 })
    await client.send('Input.insertText', { text: input.text })
  } else {
    const files = input.files ?? []
    const decodedFiles = files.map(file => ({ ...file, bytes: Buffer.from(file.data, 'base64') }))
    const textBytes = Buffer.byteLength(input.text ?? '') + Buffer.byteLength(input.html ?? '') + Buffer.byteLength(input.uriList ?? '')
    const fileBytes = decodedFiles.reduce((total, file) => total + file.bytes.byteLength, 0)
    if (decodedFiles.some(file => file.bytes.byteLength > 8 * 1024 * 1024) || textBytes + fileBytes > 16 * 1024 * 1024) {
      fail('CLIPBOARD_TOO_LARGE', 'clipboard paste exceeds the 8MB per-file or 16MB total limit')
    }
    const pasteResult = await view.page.evaluate(({ text, html, uriList, files }) => {
      const target = document.activeElement instanceof HTMLElement ? document.activeElement : document.body
      const transfer = new DataTransfer()
      if (text !== undefined && text !== '') transfer.setData('text/plain', text)
      if (html !== undefined && html !== '') transfer.setData('text/html', html)
      if (uriList !== undefined && uriList !== '') transfer.setData('text/uri-list', uriList)
      for (const file of files) {
        const binary = atob(file.data)
        const bytes = new Uint8Array(binary.length)
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
        transfer.items.add(new File([bytes], file.name, { type: file.mediaType }))
      }
      const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, composed: true, clipboardData: transfer })
      target.dispatchEvent(event)
      return { handled: event.defaultPrevented, target: target.tagName.toLowerCase() }
    }, { text: input.text, html: input.html, uriList: input.uriList, files })
    if (!pasteResult.handled && input.text !== undefined && input.text !== '') await client.send('Input.insertText', { text: input.text })
    return { ok: true, action: 'user_input', viewId: view.viewId, data: asData({ action: input.action, formats: [input.text === undefined ? undefined : 'text/plain', input.html === undefined ? undefined : 'text/html', input.uriList === undefined ? undefined : 'text/uri-list'].filter(Boolean), files: files.length, bytes: textBytes + fileBytes, handled: pasteResult.handled, target: pasteResult.target }) }
  }
  return { ok: true, action: 'user_input', viewId: view.viewId, data: asData({ action: input.action }) }
}
