export type KeyboardModifier = 'Control' | 'Alt' | 'Shift' | 'Meta'

export function extractModifiers(event: {
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}): KeyboardModifier[] {
  const modifiers: KeyboardModifier[] = []
  if (event.ctrlKey) modifiers.push('Control')
  if (event.altKey) modifiers.push('Alt')
  if (event.shiftKey) modifiers.push('Shift')
  if (event.metaKey) modifiers.push('Meta')
  return modifiers
}
