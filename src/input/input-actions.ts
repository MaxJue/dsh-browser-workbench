import type { BrowserUserInput } from '../domain/protocol.ts'
import type { InputTraceRecord } from '../diagnostics/input-trace.ts'

export function inputTraceAction(input: BrowserUserInput): InputTraceRecord['action'] {
  if (input.action === 'insert_text') return 'insert-text'
  if (input.action === 'composition_commit') return 'composition'
  if (input.action === 'paste') return 'paste'
  if (input.action === 'key_press') return input.composing ? 'composition' : 'key-press'
  if (input.action === 'mouse_wheel') return 'wheel'
  return 'pointer'
}
