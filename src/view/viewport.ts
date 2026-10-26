import { fail } from '../domain/errors.ts'

export const STANDARD_VIEWPORT = { width: 1280, height: 720 } as const
export const MIN_ADAPTIVE_VIEWPORT = { width: 320, height: 240 } as const
export const MIN_SPLIT_ADAPTIVE_VIEWPORT = { width: 160, height: 120 } as const
export const MAX_ADAPTIVE_VIEWPORT = { width: 1920, height: 1200 } as const

export function normalizeAdaptiveViewport(
  width: number,
  height: number,
  minimum: { width: number; height: number } = MIN_ADAPTIVE_VIEWPORT,
): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height)) fail('INVALID_ARGS', 'adaptive viewport requires finite width and height')
  return {
    width: Math.min(Math.max(Math.round(width), minimum.width), MAX_ADAPTIVE_VIEWPORT.width),
    height: Math.min(Math.max(Math.round(height), minimum.height), MAX_ADAPTIVE_VIEWPORT.height),
  }
}
