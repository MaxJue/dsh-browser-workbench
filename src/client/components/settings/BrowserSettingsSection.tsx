import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { BrowserBindingOverview, BrowserToolChoice, Port } from '../../port.ts'
import { BrowserGlyph } from '../common/BrowserGlyph.tsx'

const DEFAULT_ENDPOINT = 'http://127.0.0.1:9222'

type ClientPlatform = 'windows' | 'mac' | 'other'

/** 启动命令随宿主操作系统不同，按浏览器 UA 判断当前桌面端所在系统。 */
function detectPlatform(): ClientPlatform {
  if (typeof navigator === 'undefined') return 'other'
  const ua = navigator.userAgent
  if (/Windows/i.test(ua)) return 'windows'
  if (/Macintosh|Mac OS X/i.test(ua)) return 'mac'
  return 'other'
}

export interface BrowserSettingsSectionProps {
  port: Port
}

const S: Record<string, CSSProperties> = {
  page: {
    display: 'flex',
    flexDirection: 'column',
    gap: 18,
    fontSize: 13,
    lineHeight: 1.55,
    color: 'var(--dsh-text-primary, #1f2328)',
  },
  header: { display: 'flex', alignItems: 'flex-start', gap: 12 },
  headerIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 34,
    height: 34,
    flex: 'none',
    borderRadius: 9,
    background: 'var(--dsh-fill-tertiary, rgba(0,0,0,0.06))',
  },
  headerText: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 },
  title: { margin: 0, fontSize: 16, fontWeight: 600, lineHeight: 1.3 },
  subtitle: { margin: 0, color: 'var(--dsh-text-secondary, #6b7280)', fontSize: 12.5 },
  options: { display: 'flex', flexDirection: 'column', gap: 10 },
  optionIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
    flex: 'none',
    borderRadius: 8,
    background: 'var(--dsh-fill-tertiary, rgba(0,0,0,0.06))',
    color: 'inherit',
  },
  optionBody: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 },
  optionTitle: { fontSize: 13.5, fontWeight: 600 },
  optionDesc: { color: 'var(--dsh-text-secondary, #6b7280)', fontSize: 12.5 },
  optionCheck: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 20,
    height: 20,
    flex: 'none',
    borderRadius: '50%',
    background: 'var(--dsh-text-primary, #1f2328)',
    color: 'var(--dsh-bg-primary, #fff)',
  },
  endpoint: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: '12px 14px',
    border: '1px solid var(--dsh-border-tertiary, rgba(0,0,0,0.08))',
    borderTop: 'none',
    borderRadius: '0 0 12px 12px',
    background: 'var(--dsh-fill-quaternary, rgba(0,0,0,0.02))',
  },
  endpointRow: { display: 'flex', alignItems: 'center', gap: 8 },
  input: {
    flex: 1,
    minWidth: 0,
    padding: '7px 10px',
    borderRadius: 8,
    border: '1px solid var(--dsh-border-secondary, rgba(0,0,0,0.12))',
    background: 'var(--dsh-bg-primary, #fff)',
    color: 'inherit',
    fontFamily: 'inherit',
    fontSize: 12.5,
  },
  hint: { margin: 0, color: 'var(--dsh-text-secondary, #6b7280)', fontSize: 12 },
  command: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    padding: '8px 10px',
    borderRadius: 8,
    border: '1px solid var(--dsh-border-tertiary, rgba(0,0,0,0.08))',
    background: 'var(--dsh-bg-primary, #fff)',
  },
  commandText: {
    flex: 1,
    minWidth: 0,
    margin: 0,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: 11.5,
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    color: 'inherit',
  },
  note: {
    margin: 0,
    padding: '10px 12px',
    borderRadius: 10,
    background: 'var(--dsh-fill-quaternary, rgba(0,0,0,0.04))',
    color: 'var(--dsh-text-secondary, #6b7280)',
    fontSize: 12.5,
  },
  error: { margin: 0, color: 'var(--dsh-text-danger, #d33)', fontSize: 12.5 },
  status: {
    display: 'flex',
    flexDirection: 'column',
    margin: 0,
    borderTop: '1px solid var(--dsh-border-tertiary, rgba(0,0,0,0.08))',
  },
  statusRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    padding: '10px 0',
    borderBottom: '1px solid var(--dsh-border-tertiary, rgba(0,0,0,0.08))',
  },
  statusKey: { color: 'var(--dsh-text-secondary, #6b7280)', fontSize: 12.5 },
  statusValue: { margin: 0, fontSize: 12.5, fontWeight: 500, textAlign: 'right', wordBreak: 'break-all' },
  footer: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  footerHint: { color: 'var(--dsh-text-secondary, #6b7280)', fontSize: 12 },
  footerActions: { display: 'flex', alignItems: 'center', gap: 8 },
  button: {
    padding: '6px 14px',
    borderRadius: 8,
    border: '1px solid var(--dsh-border-secondary, rgba(0,0,0,0.12))',
    background: 'var(--dsh-bg-primary, #fff)',
    color: 'inherit',
    fontSize: 12.5,
    fontFamily: 'inherit',
    cursor: 'pointer',
  },
  primaryButton: {
    padding: '6px 14px',
    borderRadius: 8,
    border: '1px solid var(--dsh-text-primary, #1f2328)',
    background: 'var(--dsh-text-primary, #1f2328)',
    color: 'var(--dsh-bg-primary, #fff)',
    fontSize: 12.5,
    fontFamily: 'inherit',
    cursor: 'pointer',
  },
  linkButton: {
    padding: 0,
    border: 'none',
    background: 'none',
    color: 'var(--dsh-text-secondary, #6b7280)',
    fontSize: 12,
    fontFamily: 'inherit',
    textDecoration: 'underline',
    cursor: 'pointer',
  },
}

function optionStyle(active: boolean, enabled: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    width: '100%',
    padding: '14px 16px',
    boxSizing: 'border-box',
    border: `1px solid ${active ? 'var(--dsh-text-primary, #1f2328)' : 'var(--dsh-border-secondary, rgba(0,0,0,0.1))'}`,
    borderRadius: 12,
    background: active ? 'var(--dsh-fill-quaternary, rgba(0,0,0,0.03))' : 'var(--dsh-bg-primary, #fff)',
    color: 'inherit',
    fontSize: 13,
    fontFamily: 'inherit',
    textAlign: 'left',
    cursor: enabled ? 'pointer' : 'not-allowed',
    opacity: enabled ? 1 : 0.55,
    transition: 'border-color 120ms ease, background 120ms ease',
  }
}

function ExternalIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 3v4" />
      <path d="M15 17v4" />
      <rect x="6" y="7" width="12" height="10" rx="2.5" />
      <path d="M3 11v2a2 2 0 0 0 2 2h1" />
      <path d="M21 11v2a2 2 0 0 1-2 2h-1" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <span style={S.optionCheck} aria-hidden>
      <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3.5 8.5 6.5 11.5 12.5 5" />
      </svg>
    </span>
  )
}

function CopyCommand({ lines }: { lines: string[] }) {
  const [copied, setCopied] = useState(false)
  const copy = async (): Promise<void> => {
    const text = lines.join('\n')
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      document.execCommand('copy')
      area.remove()
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div style={S.command}>
      <pre style={S.commandText}>{lines.join('\n')}</pre>
      <button type="button" style={S.button} onClick={() => void copy()}>
        {copied ? '已复制' : '复制'}
      </button>
    </div>
  )
}

export function BrowserSettingsSection({ port }: BrowserSettingsSectionProps) {
  const [overview, setOverview] = useState<BrowserBindingOverview | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [actionError, setActionError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [endpoint, setEndpoint] = useState(DEFAULT_ENDPOINT)
  const [endpointOpen, setEndpointOpen] = useState(false)
  const [platform] = useState<ClientPlatform>(detectPlatform)

  const reload = useCallback(async () => {
    try {
      const next = await port.overview()
      setOverview(next)
      setError(undefined)
      if (next.endpoint !== undefined && next.endpoint !== '') setEndpoint(next.endpoint)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [port])

  useEffect(() => {
    void reload()
  }, [reload])

  const write = useCallback(async (choice: BrowserToolChoice, target?: string) => {
    setBusy(true)
    setActionError(undefined)
    try {
      await port.setBrowserChoice(choice, target)
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
      await reload()
      // 补丁写入后 Loader 会重新加载插件，稍后再取一次概览以拿到新的绑定。
      window.setTimeout(() => void reload(), 800)
    }
  }, [port, reload])

  if (overview === undefined) {
    return (
      <div style={S.page}>
        {error === undefined ? '正在读取浏览器绑定…' : <p style={S.error}>{error}</p>}
      </div>
    )
  }

  const configured = overview.configuredMode === 'disabled'
    ? 'off'
    : overview.providerMode === 'external' ? 'existing' : 'workbench'
  const activeCount = overview.sessions.filter(entry => entry.snapshot.status === 'active').length
  const enabled = overview.configurable && !busy
  const downgraded = overview.registrationMode !== overview.configuredMode
  const effectiveLabel = overview.registrationMode === 'disabled'
    ? '本插件已停用'
    : overview.providerMode === 'external'
      ? `连接现有浏览器（${overview.endpoint ?? '未设置端点'}）`
      : overview.registrationMode === 'global'
        ? 'DSH BrowserWorkbench（自动启动）'
        : 'DSH BrowserWorkbench（按会话）'
  const showEndpoint = configured === 'existing' || endpointOpen

  return (
    <div style={S.page}>
      <header style={S.header}>
        <span style={S.headerIcon} aria-hidden>
          <BrowserGlyph size={18} />
        </span>
        <div style={S.headerText}>
          <h2 style={S.title}>浏览器</h2>
          <p style={S.subtitle}>浏览器工具只归属于一套实现，所有会话共享同一份绑定。</p>
        </div>
      </header>

      <div style={S.options} role="radiogroup" aria-label="浏览器工具绑定">
        <div>
          <button
            type="button"
            role="radio"
            aria-checked={configured === 'workbench'}
            style={optionStyle(configured === 'workbench', enabled)}
            disabled={!enabled}
            onClick={() => { setEndpointOpen(false); void write('workbench') }}
          >
            <span style={S.optionIcon} aria-hidden>
              <BrowserGlyph size={18} />
            </span>
            <span style={S.optionBody}>
              <span style={S.optionTitle}>DSH BrowserWorkbench</span>
              <span style={S.optionDesc}>为本插件自动启动独立的 Chromium，页面、Cookie 与登录态按会话隔离。</span>
            </span>
            {configured === 'workbench' ? <CheckIcon /> : null}
          </button>
        </div>

        <div>
          <button
            type="button"
            role="radio"
            aria-checked={configured === 'existing'}
            style={{
              ...optionStyle(configured === 'existing', enabled),
              ...(showEndpoint && configured === 'existing' ? { borderRadius: '12px 12px 0 0' } : {}),
            }}
            disabled={!enabled}
            onClick={() => setEndpointOpen(true)}
          >
            <span style={S.optionIcon} aria-hidden>
              <ExternalIcon />
            </span>
            <span style={S.optionBody}>
              <span style={S.optionTitle}>连接现有 Chrome / Edge</span>
              <span style={S.optionDesc}>不启动新浏览器，直接连上你平时用的那个窗口，沿用它的登录态与扩展。</span>
            </span>
            {configured === 'existing' ? <CheckIcon /> : null}
          </button>

          {showEndpoint ? (
            <div style={S.endpoint}>
              <div style={S.endpointRow}>
                <input
                  style={S.input}
                  value={endpoint}
                  spellCheck={false}
                  placeholder={DEFAULT_ENDPOINT}
                  aria-label="浏览器调试端点"
                  onChange={event => setEndpoint(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' && enabled && endpoint.trim() !== '') void write('existing', endpoint.trim())
                  }}
                />
                <button
                  type="button"
                  style={S.primaryButton}
                  disabled={!enabled || endpoint.trim() === ''}
                  onClick={() => void write('existing', endpoint.trim())}
                >
                  连接
                </button>
              </div>
              <p style={S.hint}>
                浏览器必须先用调试模式启动，端口与上方端点一致（示例 9222；被占用就换一个并同步改这里）。
                启动后在那个窗口里正常登录，Agent 的浏览器调用就作用在这个窗口。
              </p>
              {platform !== 'mac' ? (
                <>
                  <p style={S.hint}>Windows（cmd，整行复制直接粘贴执行）：</p>
                  <CopyCommand
                    lines={[
                      'start "" "%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%TEMP%\\dsh-chrome"',
                    ]}
                  />
                  <p style={S.hint}>Edge 同理（默认装在 %ProgramFiles(x86)%）：</p>
                  <CopyCommand
                    lines={[
                      'start "" "%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe" --remote-debugging-port=9222 --user-data-dir="%TEMP%\\dsh-edge"',
                    ]}
                  />
                  <p style={S.hint}>
                    提示找不到文件说明浏览器不在默认目录（例如只装给当前用户，或装在非系统盘）：
                    把引号里的路径换成你的真实安装位置即可，不需要切换盘符或目录。
                  </p>
                </>
              ) : null}
              {platform !== 'windows' ? (
                <>
                  <p style={S.hint}>macOS（终端）：</p>
                  <CopyCommand
                    lines={[
                      'open -na "Google Chrome" --args --remote-debugging-port=9222 --user-data-dir=/tmp/dsh-chrome',
                      'open -na "Microsoft Edge" --args --remote-debugging-port=9222 --user-data-dir=/tmp/dsh-edge',
                    ]}
                  />
                  <p style={S.hint}>
                    提示找不到应用时，换成可执行文件的完整路径：
                    <code>/Applications/Google Chrome.app/Contents/MacOS/Google Chrome</code>。
                  </p>
                </>
              ) : null}
              <p style={S.hint}>
                启动后访问 <code>http://127.0.0.1:9222/json/version</code> 能看到 JSON 才算成功；
                Chrome 自带的「允许远程调试」开关不提供该接口，不要用它。
              </p>
            </div>
          ) : null}
        </div>
      </div>

      {!overview.configurable ? (
        <p style={S.note}>
          {overview.configurableMessage ?? '绑定无法在此切换。'}
          {' '}
          可手改 <code>~/.dsh/profiles/desktop/cordis.patch.yml</code> 中 <code>- id: browser-tools</code> 的配置。
        </p>
      ) : null}

      {downgraded ? (
        <p style={S.note}>
          运行时实际生效为{effectiveLabel}（配置与实际不一致，可能被其他浏览器插件抢占）。
        </p>
      ) : null}

      {error !== undefined ? <p style={S.error}>{error}</p> : null}
      {actionError !== undefined ? <p style={S.error}>{actionError}</p> : null}

      <dl style={S.status}>
        <div style={S.statusRow}>
          <dt style={S.statusKey}>当前生效</dt>
          <dd style={S.statusValue}>{effectiveLabel}</dd>
        </div>
        <div style={S.statusRow}>
          <dt style={S.statusKey}>浏览器会话</dt>
          <dd style={S.statusValue}>{activeCount === 0 ? '暂无' : `${activeCount} 个会话正在使用`}</dd>
        </div>
      </dl>

      <footer style={S.footer}>
        <button
          type="button"
          style={S.linkButton}
          disabled={!enabled}
          onClick={() => void write(configured === 'off' ? 'workbench' : 'off')}
        >
          {configured === 'off' ? '恢复使用本插件' : '停用本插件，把浏览器工具让给其他插件'}
        </button>
        <div style={S.footerActions}>
          <span style={S.footerHint}>切换后立即写入配置并热重载。</span>
          <button type="button" style={S.button} disabled={busy} onClick={() => void reload()}>
            刷新
          </button>
        </div>
      </footer>
    </div>
  )
}
