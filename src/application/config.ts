import z from '@deepseek-ai/schemastery'
import type { Config as BrowserConfig } from '../domain/types.ts'

export const Config: z<BrowserConfig> = z.object({
  executablePath: z.string(),
  headless: z.boolean().default(true),
  proxy: z.object({
    mode: z.union(['system', 'direct', 'custom']).default('system'),
    server: z.string(), bypass: z.string(), username: z.string(), password: z.string(),
  }).default({ mode: 'system', server: '', bypass: '', username: '', password: '' }),
  allowedOrigins: z.array(z.string()).default([]),
  allowLoopback: z.boolean().default(true),
  allowPrivateNetwork: z.boolean().default(true),
  uploadRoots: z.array(z.string()).default([]),
  artifactRoot: z.string(),
  maxUploadBytes: z.number().step(1).min(1).default(25 * 1024 * 1024),
  maxDownloadBytes: z.number().step(1).min(1).default(100 * 1024 * 1024),
  maxArtifactBytes: z.number().step(1).min(1).default(256 * 1024 * 1024),
  maxOutputChars: z.number().step(1).min(1000).default(12000),
  interceptionTimeoutMs: z.number().step(1).min(1000).default(15000),
  externalCdpTimeoutMs: z.number().step(1).min(1000).default(15000),
  chromiumDownloadSource: z.union(['auto', 'npmmirror', 'official']).default('auto'),
  chromiumDownloadTimeoutMs: z.number().step(1).min(1000).default(300000),
  subagentInteractive: z.boolean().default(false),
  sharedProfileSeedSessionId: z.string(),
  toolRegistrationMode: z.union(['global', 'session-select']).default('session-select'),
  sessionController: z.object({
    conflictingToolPatterns: z.array(z.string()).default(['^browser_', '^chrome_', '^pilot_', '^mcp__playwright__', '^mcp__chrome_devtools__']),
    excludeTools: z.array(z.string()).default([]), includeTools: z.array(z.string()).default([]),
  }).default({
    conflictingToolPatterns: ['^browser_', '^chrome_', '^pilot_', '^mcp__playwright__', '^mcp__chrome_devtools__'],
    excludeTools: [], includeTools: [],
  }),
})
