export const MAX_CLIPBOARD_FILES = 8
export const MAX_CLIPBOARD_SINGLE_FILE_BYTES = 8 * 1024 * 1024 // 8MB
export const MAX_CLIPBOARD_TOTAL_BYTES = 16 * 1024 * 1024 // 16MB

export interface ClipboardEncodedFile {
  name: string
  mediaType: string
  data: string
}

export function validateClipboardLimits(
  files: readonly { size: number }[],
  textBytes: number,
): { valid: true } | { valid: false; error: string } {
  if (files.length > MAX_CLIPBOARD_FILES) {
    return { valid: false, error: '剪贴板内容超过限制：最多 8 个文件、单个文件 8MB、总计 16MB。' }
  }
  if (files.some(file => file.size > MAX_CLIPBOARD_SINGLE_FILE_BYTES)) {
    return { valid: false, error: '剪贴板内容超过限制：最多 8 个文件、单个文件 8MB、总计 16MB。' }
  }
  const fileBytes = files.reduce((total, file) => total + file.size, 0)
  if (textBytes + fileBytes > MAX_CLIPBOARD_TOTAL_BYTES) {
    return { valid: false, error: '剪贴板内容超过限制：最多 8 个文件、单个文件 8MB、总计 16MB。' }
  }
  return { valid: true }
}

export async function encodeClipboardFile(file: File): Promise<ClipboardEncodedFile> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)))
  }
  return {
    name: file.name || 'clipboard.bin',
    mediaType: file.type || 'application/octet-stream',
    data: btoa(binary),
  }
}
