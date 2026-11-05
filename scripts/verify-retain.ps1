param(
  [Parameter(Mandatory = $true)][string]$FileName,
  [Parameter(Mandatory = $true)][string]$ExpectedSha256
)
$ErrorActionPreference = "Stop"

if ($FileName -notmatch '^travel-\d{8}T\d{6}Z-[0-9a-f]{16}\.sqlite\.age$') {
  throw "Unexpected backup filename."
}
if ($ExpectedSha256 -notmatch '^[0-9a-f]{64}$') {
  throw "Invalid expected SHA-256 hash."
}

$backupPath = Join-Path $PSScriptRoot $FileName
if (-not (Test-Path -LiteralPath $backupPath -PathType Leaf)) {
  throw "Transferred backup was not found."
}
$actual = (Get-FileHash -LiteralPath $backupPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $ExpectedSha256) {
  throw "Transferred backup hash mismatch."
}

$cutoff = (Get-Date).ToUniversalTime().AddDays(-30)
Get-ChildItem -LiteralPath $PSScriptRoot -File -Filter "travel-*.sqlite.age" |
  Where-Object { $_.LastWriteTimeUtc -lt $cutoff } |
  Remove-Item -Force -ErrorAction Stop
Write-Output "Verified $FileName (SHA-256 $actual); removed backups older than 30 days."
