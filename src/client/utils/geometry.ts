export interface RectBounds {
  left: number
  top: number
  width: number
  height: number
}

export interface FrameDimensions {
  width: number
  height: number
}

export interface ProjectedPoint {
  x: number
  y: number
}

/**
 * 把实况图片上的客户端坐标映射回真实浏览器的像素坐标。
 *
 * 图片用 `object-fit: contain` 等比缩放并居中，四周可能留黑边；这里按同一套缩放与偏移还算，
 * 落在黑边上（且未要求 clamp）时返回 undefined，避免把点击送到页面外。
 */
export function calculatePointProjection(
  rect: RectBounds,
  frame: FrameDimensions,
  clientX: number,
  clientY: number,
  clamp = false,
): ProjectedPoint | undefined {
  if (rect.width <= 0 || rect.height <= 0 || frame.width <= 0 || frame.height <= 0) return undefined
  const scale = Math.min(rect.width / frame.width, rect.height / frame.height)
  const renderWidth = frame.width * scale
  const renderHeight = frame.height * scale
  const left = rect.left + (rect.width - renderWidth) / 2
  const top = rect.top + (rect.height - renderHeight) / 2

  if (!clamp && (clientX < left || clientX >= left + renderWidth || clientY < top || clientY >= top + renderHeight)) {
    return undefined
  }

  return {
    x: Math.min(Math.max((clientX - left) / scale, 0), Math.max(frame.width - 1, 0)),
    y: Math.min(Math.max((clientY - top) / scale, 0), Math.max(frame.height - 1, 0)),
  }
}
