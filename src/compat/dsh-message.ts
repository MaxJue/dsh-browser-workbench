import { createUserMessage } from '@deepseek-ai/dsh-llm'

const SOURCE_KIND = 'dsh-browser-workbench'

/** BrowserWorkbench 在 DSH 会话中注入的可持久化通知来源。 */
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'dsh-browser-workbench': {
      kind: typeof SOURCE_KIND
      form: 'notice'
      summary: string
    }
  }
}

export function createBrowserNotice(text: string, summary: string) {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: SOURCE_KIND, form: 'notice', summary },
  })
}
