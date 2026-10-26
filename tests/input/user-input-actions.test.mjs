import assert from 'node:assert/strict'
import test from 'node:test'
import { dispatchUserInput } from '../../src/input/user-input-actions.ts'

function setup() {
  const sent = []
  const page = {
    keyboard: { press: async chord => sent.push(['keyboard', chord]) },
    evaluate: async () => ({ handled: false, target: 'input' }),
  }
  const view = {
    viewId: 'view-1',
    page,
    viewport: { width: 800, height: 600, generation: 4 },
    userPointer: undefined,
  }
  const state = {
    session: { send: async (...args) => sent.push(args) },
    latestFrame: { streamGeneration: 2, viewportGeneration: 4, sequence: 10 },
  }
  return { sent, page, view, state }
}

const base = { viewId: 'view-1', streamGeneration: 2, frameSequence: 10, viewportGeneration: 4 }

test('rejects input delivered to a stale frame and out-of-range pointer input', async () => {
  const setupState = setup()
  const stale = await dispatchUserInput({ ...setupState, input: { ...base, action: 'mouse_click', x: 10, y: 10, streamGeneration: 9 } })
  assert.equal(stale.data.code, 'STALE_LIVE_VIEW')

  const outOfRange = await dispatchUserInput({ ...setupState, input: { ...base, action: 'mouse_click', x: 800, y: 10 } })
  assert.equal(outOfRange.data.code, 'INPUT_OUT_OF_RANGE')
})

test('dispatches click, clamps wheel deltas and tracks pointer gestures', async () => {
  const clickState = setup()
  await dispatchUserInput({ ...clickState, input: { ...base, action: 'mouse_click', x: 12, y: 18, clickCount: 8 } })
  assert.deepEqual(clickState.sent, [
    ['Input.dispatchMouseEvent', { type: 'mousePressed', x: 12, y: 18, button: 'left', clickCount: 3 }],
    ['Input.dispatchMouseEvent', { type: 'mouseReleased', x: 12, y: 18, button: 'left', clickCount: 3 }],
  ])

  const pointerState = setup()
  await dispatchUserInput({ ...pointerState, input: { ...base, action: 'mouse_down', x: 20, y: 20 } })
  await dispatchUserInput({ ...pointerState, input: { ...base, action: 'mouse_move', x: 30, y: 30 } })
  await dispatchUserInput({ ...pointerState, input: { ...base, action: 'mouse_up', x: 40, y: 40 } })
  await dispatchUserInput({ ...pointerState, input: { ...base, action: 'mouse_wheel', x: 40, y: 40, deltaX: 9999, deltaY: -9999 } })
  assert.equal(pointerState.view.userPointer, undefined)
  assert.deepEqual(pointerState.sent.at(-1), ['Input.dispatchMouseEvent', { type: 'mouseWheel', x: 40, y: 40, deltaX: 2000, deltaY: -2000 }])
})

test('dispatches keyboard and composition input through the expected channels', async () => {
  const { sent, ...setupState } = setup()
  await dispatchUserInput({ ...setupState, state: { ...setupState.state, session: { send: async (...args) => sent.push(args) } }, input: { ...base, action: 'key_press', key: 'A', modifiers: ['Control', 'Control', 'Shift'] } })
  await dispatchUserInput({ ...setupState, state: { ...setupState.state, session: { send: async (...args) => sent.push(args) } }, input: { ...base, action: 'insert_text', text: 'x' } })
  await dispatchUserInput({ ...setupState, state: { ...setupState.state, session: { send: async (...args) => sent.push(args) } }, input: { ...base, action: 'composition_commit', text: '中' } })
  assert.deepEqual(sent, [
    ['keyboard', 'Control+Shift+A'],
    ['Input.insertText', { text: 'x' }],
    ['Input.imeSetComposition', { text: '中', selectionStart: 1, selectionEnd: 1 }],
    ['Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 }],
    ['Input.insertText', { text: '中' }],
  ])
})

test('rejects oversized clipboard files before dispatching page code', async () => {
  const setupState = setup()
  const huge = Buffer.alloc(8 * 1024 * 1024 + 1).toString('base64')
  await assert.rejects(dispatchUserInput({ ...setupState, input: { ...base, action: 'paste', files: [{ name: 'huge.bin', mediaType: 'application/octet-stream', data: huge }] } }), error => error.code === 'CLIPBOARD_TOO_LARGE')
})

