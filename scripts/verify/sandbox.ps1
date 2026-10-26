# Boots an isolated DeepSeek Harness profile that loads this plugin from the
# workspace, so the plugin can be exercised without touching the desktop profile.
#
#   powershell -NoProfile -File scripts/verify/sandbox.ps1            # http://127.0.0.1:31880
#   powershell -NoProfile -File scripts/verify/sandbox.ps1 -Port 31999
#
# Prerequisites (one time, from the repository root):
#   $env:DSH_HOME = "<repo>\.sandbox\home"
#   dsh --profile verify --from-default-profile web --dump-config   # creates the profile
#   # then point the profile at the workspace checkout:
#   #   .sandbox\home\profiles\verify\package.json   dependencies: { "dsh-browser-workbench": "link:<repo>" }
#   #   .sandbox\home\profiles\verify\package.json   dsh.profile.bundles += "dsh-browser-workbench"
#
# Keep this file ASCII-only: Windows PowerShell 5.1 reads BOM-less scripts with
# the ANSI code page, so non-ASCII text here turns into mojibake.
[CmdletBinding()]
param(
  [int]$Port = 31880,
  [string]$DshHome,
  [string]$DshCli
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$sandboxHome = if ($DshHome) { $DshHome } else { Join-Path $root '.sandbox\home' }
$profile = 'verify'

$profileFile = Join-Path $sandboxHome "profiles\$profile\package.json"
if (-not (Test-Path $profileFile)) {
  throw "profile '$profile' is missing at $profileFile - create it once with 'dsh --profile $profile --from-default-profile web --dump-config' and link dsh-browser-workbench"
}

$cli = $DshCli
if (-not $cli) {
  $command = Get-Command dsh -ErrorAction SilentlyContinue
  if ($command) { $cli = $command.Source }
}
if (-not $cli) {
  $candidate = 'D:\softwares\resources\runtime\cli\bin\dsh.cmd'
  if (Test-Path $candidate) { $cli = $candidate }
}
if (-not $cli) { throw 'dsh CLI not found; pass -DshCli <path to dsh.cmd>' }

# The launcher, not the caller's shell, owns DSH_HOME/DSH_PROFILE here: the
# sandbox keeps its own sessions, credentials, and storages.
$env:DSH_HOME = $sandboxHome
$env:DSH_PROFILE = ''
$env:DSH_PROFILE_DIR = ''

Write-Host "sandbox home: $sandboxHome"
Write-Host "booting profile '$profile' on port $Port (Ctrl+C to stop)"
& $cli --profile $profile --port $Port --no-open
