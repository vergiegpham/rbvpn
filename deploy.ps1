# Deploy local RB-VPN source to the VPS (reads credentials from .\vps info)
param(
  [string]$Only = "api,website,agent,scripts",
  [switch]$SkipBuild,
  [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$argsList = @("server/scripts/deploy-to-vps.py", "--only", $Only)
if ($SkipBuild) { $argsList += "--skip-build" }
if ($SkipInstall) { $argsList += "--skip-install" }

python @argsList
