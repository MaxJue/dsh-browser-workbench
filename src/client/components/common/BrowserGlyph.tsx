/**
 * 浏览器窗口字形。
 *
 * 同时用在设置分区标题、选项卡片和右侧栏「开始」页的入口卡上：宿主对每个入口只渲染
 * 一个 22/26px 的图标组件，所以这里按 `size` 缩放，描边宽度保持视觉一致。
 */
export function BrowserGlyph({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M3 9h18" />
      <circle cx="6.2" cy="6.5" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  )
}
