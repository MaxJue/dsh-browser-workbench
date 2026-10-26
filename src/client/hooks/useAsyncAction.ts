import { useState, useTransition } from 'react'

export interface AsyncActionState<T> {
  data?: T
  error?: string
  isPending: boolean
  execute: (...args: any[]) => Promise<T | undefined>
  clearError: () => void
  setError: (error?: string) => void
}

/**
 * 跨 React 18/19 统一的异步动作 Hook，提供非阻塞过渡（useTransition）、自动 isPending 状态与异常拦截
 */
export function useAsyncAction<TArgs extends any[], TResult>(
  action: (...args: TArgs) => Promise<TResult>,
  fallbackErrorMessage = '操作失败，请重试。',
): AsyncActionState<TResult> {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string>()
  const [data, setData] = useState<TResult>()

  const execute = async (...args: TArgs): Promise<TResult | undefined> => {
    setError(undefined)
    try {
      let result: TResult | undefined
      await new Promise<void>((resolve, reject) => {
        startTransition(async () => {
          try {
            result = await action(...args)
            setData(result)
            resolve()
          } catch (cause) {
            reject(cause)
          }
        })
      })
      return result
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message || fallbackErrorMessage)
      return undefined
    }
  }

  const clearError = () => setError(undefined)

  return { data, error, isPending, execute, clearError, setError }
}
