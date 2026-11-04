# Creates a local self-signed code-signing certificate for RB-VPN builds.
# Free, but NOT trusted by Windows/SmartScreen for public users.
# For real installs, buy an OV/EV Authenticode cert (DigiCert, Sectigo, SSL.com)
# or use SignPath Foundation if the project is open source.

param(
  [string]$OutDir = (Join-Path $PSScriptRoot "..\certs"),
  [string]$PfxName = "rbvpn-codesign.pfx",
  [string]$Password = "rbvpn-dev-sign",
  [string]$Subject = "CN=RB-VPN Dev"
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$pfxPath = Join-Path $OutDir $PfxName
$cerPath = Join-Path $OutDir "rbvpn-codesign.cer"

if (Test-Path $pfxPath) {
  Write-Host "Certificate already exists: $pfxPath"
  Write-Host "Delete it first if you want to recreate."
  exit 0
}

$secure = ConvertTo-SecureString -String $Password -Force -AsPlainText
$cert = New-SelfSignedCertificate `
  -Type CodeSigningCert `
  -Subject $Subject `
  -KeyAlgorithm RSA `
  -KeyLength 2048 `
  -HashAlgorithm SHA256 `
  -CertStoreLocation "Cert:\CurrentUser\My" `
  -NotAfter (Get-Date).AddYears(3)

Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $secure | Out-Null
Export-Certificate -Cert $cert -FilePath $cerPath | Out-Null

# Remove from store so the private key lives only in the PFX file.
Remove-Item -Path "Cert:\CurrentUser\My\$($cert.Thumbprint)" -Force

$passwordFile = Join-Path $OutDir "pfx-password.txt"
Set-Content -Path $passwordFile -Value $Password -Encoding ascii

Write-Host "Created:"
Write-Host "  PFX: $pfxPath"
Write-Host "  CER: $cerPath"
Write-Host "  Password file: $passwordFile"
Write-Host ""
Write-Host "Build with:"
Write-Host '  $env:CSC_LINK = (Resolve-Path .\certs\rbvpn-codesign.pfx).Path'
Write-Host '  $env:CSC_KEY_PASSWORD = Get-Content .\certs\pfx-password.txt'
Write-Host "  npm run dist:msi"
Write-Host ""
Write-Host "NOTE: Self-signed = free, but Windows will still warn users (Unknown publisher)."
