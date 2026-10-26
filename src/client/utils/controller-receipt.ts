// 释放回执只描述“上一次释放成功发生在何时”，不声称当前一定没有浏览器资源：
// 释放之后任意一次 BrowserWorkbench 工具调用都会重新创建页面和浏览器资源。

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** 把时间戳格式化为本地 HH:MM:SS；非法时间戳返回 undefined，避免出现 Invalid Date 文案。 */
export function releaseReceiptTime(releasedAt: number | undefined): string | undefined {
  if (releasedAt === undefined || !Number.isFinite(releasedAt) || releasedAt <= 0) return undefined
  const date = new Date(releasedAt)
  if (Number.isNaN(date.getTime())) return undefined
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** 控制行上的即时回执，例如 `已释放 · 14:09:41`。 */
export function releaseReceiptText(releasedAt: number | undefined): string | undefined {
  const time = releaseReceiptTime(releasedAt)
  return time === undefined ? undefined : `已释放 · ${time}`
}
