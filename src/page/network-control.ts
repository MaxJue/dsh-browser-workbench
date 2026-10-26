import { fail } from '../domain/errors.ts'
import type { BrowserNetworkInput } from '../domain/protocol.ts'
import type { ToolOutput } from '../domain/types.ts'
import type { ArtifactReference } from '../provider/artifact-store.ts'
import type { CdpState } from '../cdp/cdp-state.ts'
import { rawCdp, string } from '../cdp/cdp-raw.ts'
import { projectPausedCdpRequests, releasePausedCdpRequests } from './paused-requests.ts'

interface ReplayResult {
  status: number
  body: Buffer
}

export interface NetworkControlDependencies {
  state: CdpState
  viewId: string
  maxOutputChars: number
  saveArtifact(kind: string, name: string, body: Buffer): Promise<ArtifactReference>
  replay(url: string, method: string, postData?: string): Promise<ReplayResult>
}

function asData(value: unknown) {
  return value as ToolOutput['data']
}

export async function networkControlAction(input: BrowserNetworkInput, dependencies: NetworkControlDependencies) {
  const { state, viewId } = dependencies
  const client = rawCdp(state.session)
  if (input.action === 'enable') {
    const stages = input.requestStage === 'request' ? ['Request'] : input.requestStage === 'response' ? ['Response'] : ['Request', 'Response']
    const patterns = stages.map(requestStage => ({
      urlPattern: input.urlPattern?.trim() || '*',
      ...(input.resourceType === undefined ? {} : { resourceType: input.resourceType }),
      requestStage,
    }))
    await client.send('Fetch.enable', { patterns, handleAuthRequests: false })
    state.networkEnabled = true
  } else if (input.action === 'disable') {
    await releasePausedCdpRequests(state)
    await client.send('Fetch.disable').catch(() => {})
    state.networkEnabled = false
  } else if (input.action !== 'list_paused') {
    if (input.requestId === undefined) fail('INVALID_ARGS', `${input.action} requires requestId`)
    const paused = state.pausedRequests.get(input.requestId)
    if (paused === undefined) return { ok: false as const, action: 'network_control', viewId, data: asData({ code: 'UNKNOWN_PAUSED_REQUEST', recoverable: true, message: 'The paused request expired or was already handled.', next: { tool: 'browser_network_control', arguments: { action: 'list_paused', viewId } } }) }
    if (input.action === 'body') {
      let body = paused.postData ?? ''
      let base64Encoded = false
      if (paused.requestStage === 'response') {
        const result = await client.send('Fetch.getResponseBody', { requestId: paused.requestId })
        body = string(result.body)
        base64Encoded = result.base64Encoded === true
      }
      const raw = base64Encoded ? Buffer.from(body, 'base64') : Buffer.from(body)
      if (raw.byteLength > dependencies.maxOutputChars) {
        const artifact = await dependencies.saveArtifact('network-body', `network-${paused.requestId}.bin`, raw)
        state.profile.artifacts.push(artifact)
        return { ok: true as const, action: 'network_body', viewId, data: asData({ requestId: paused.requestId, bytes: raw.byteLength, base64Encoded, artifact }) }
      }
      return { ok: true as const, action: 'network_body', viewId, data: asData({ requestId: paused.requestId, bytes: raw.byteLength, base64Encoded, body: base64Encoded ? raw.toString('base64') : raw.toString('utf8') }) }
    }
    if (input.action === 'replay') {
      const response = await dependencies.replay(paused.rawUrl, paused.method, paused.postData)
      const artifact = await dependencies.saveArtifact('network-replay', `replay-${paused.requestId}.bin`, response.body)
      state.profile.artifacts.push(artifact)
      return { ok: true as const, action: 'network_replay', viewId, data: asData({ requestId: paused.requestId, status: response.status, bytes: response.body.byteLength, artifact }) }
    }
    clearTimeout(paused.timer)
    state.pausedRequests.delete(paused.requestId)
    if (input.action === 'continue') await client.send('Fetch.continueRequest', { requestId: paused.requestId })
    else if (input.action === 'abort') await client.send('Fetch.failRequest', { requestId: paused.requestId, errorReason: input.errorReason ?? 'Aborted' })
    else if (input.action === 'fulfill') {
      if (input.responseCode === undefined) fail('INVALID_ARGS', 'fulfill requires responseCode')
      const body = input.body ?? ''
      await client.send('Fetch.fulfillRequest', {
        requestId: paused.requestId,
        responseCode: input.responseCode,
        ...(input.responsePhrase === undefined ? {} : { responsePhrase: input.responsePhrase }),
        ...(input.headers === undefined ? {} : { responseHeaders: input.headers }),
        body: input.bodyBase64 === true ? body : Buffer.from(body).toString('base64'),
      })
    } else fail('INVALID_ARGS', `unknown browser_network_control action ${JSON.stringify(input.action)}`)
  }
  return { ok: true as const, action: 'network_control', viewId, data: asData({ enabled: state.networkEnabled, pausedRequests: projectPausedCdpRequests(state) }) }
}
