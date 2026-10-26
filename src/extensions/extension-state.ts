import type { BrowserExtensionSummary } from '../domain/protocol.ts'
import type { BrowserExtensionRecord } from '../provider/persistent-profile.ts'

export function projectExtensionState(
  registry: readonly BrowserExtensionRecord[],
  loadedExtensions: readonly BrowserExtensionRecord[],
): BrowserExtensionSummary[] {
  const registeredIds = new Set(registry.map(extension => extension.extensionId))
  const loadedById = new Map(loadedExtensions.map(extension => [extension.extensionId, extension]))
  return [
    ...registry.map(extension => {
      const loaded = loadedById.get(extension.extensionId)
      return {
        extensionId: extension.extensionId,
        name: extension.name,
        version: extension.version,
        enabled: extension.enabled,
        loaded: loaded !== undefined,
        pendingRestart: extension.enabled
          ? loaded === undefined || loaded.path !== extension.path || loaded.version !== extension.version
          : loaded !== undefined,
        installedAt: extension.installedAt,
        sourceUrl: extension.sourceUrl,
        ...(extension.actionPopup === undefined ? {} : { actionPopup: extension.actionPopup }),
      }
    }),
    ...loadedExtensions
      .filter(extension => !registeredIds.has(extension.extensionId))
      .map(extension => ({
        extensionId: extension.extensionId,
        name: extension.name,
        version: extension.version,
        enabled: false,
        loaded: true,
        pendingRestart: true,
        installedAt: extension.installedAt,
        sourceUrl: extension.sourceUrl,
        ...(extension.actionPopup === undefined ? {} : { actionPopup: extension.actionPopup }),
      })),
  ]
}
