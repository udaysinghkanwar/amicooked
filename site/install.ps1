# Am I Cooked installer for Windows.
#   irm https://amicooked-mcp.vercel.app/install.ps1 | iex
# Set $env:AMICOOKED_NO_SETUP=1 to skip `amicooked setup`,
# Set $env:AMICOOKED_CLIENTS="gemini"
# and optionally $env:AMICOOKED_SCHOOL="mcmaster" to select setup without editing MCP files.
# Set $env:AMICOOKED_NO_PATH=1 to leave PATH unchanged (portable/testing installs).
# or $env:AMICOOKED_VERSION="v0.1.0" to pin a release.
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Repo = "udaysinghkanwar/amicooked"
$Home_ = if ($env:AMICOOKED_HOME) { $env:AMICOOKED_HOME } else { Join-Path $env:USERPROFILE ".amicooked" }
$InstallDir = Join-Path $Home_ "bin"
$Asset = "amicooked-windows-x64.exe"

if (-not [Environment]::Is64BitOperatingSystem) {
  throw "Am I Cooked needs 64-bit Windows. If you have Node.js, run: npx -y amicooked@0 setup"
}

$Base = if ($env:AMICOOKED_DOWNLOAD_BASE) {
  $env:AMICOOKED_DOWNLOAD_BASE
} elseif ($env:AMICOOKED_VERSION) {
  "https://github.com/$Repo/releases/download/$($env:AMICOOKED_VERSION)"
} else {
  "https://github.com/$Repo/releases/latest/download"
}

$Tmp = Join-Path ([IO.Path]::GetTempPath()) ("amicooked-" + [Guid]::NewGuid())
New-Item -ItemType Directory -Path $Tmp | Out-Null
try {
  Write-Host "Downloading Am I Cooked (windows-x64)..."
  Invoke-WebRequest -UseBasicParsing -Uri "$Base/$Asset" -OutFile (Join-Path $Tmp $Asset)
  Invoke-WebRequest -UseBasicParsing -Uri "$Base/SHA256SUMS" -OutFile (Join-Path $Tmp "SHA256SUMS")

  $Expected = (Get-Content (Join-Path $Tmp "SHA256SUMS") | Where-Object { $_ -match " $([regex]::Escape($Asset))$" }) -replace "\s.*$", ""
  $Actual = (Get-FileHash (Join-Path $Tmp $Asset) -Algorithm SHA256).Hash.ToLower()
  if (-not $Expected -or $Expected -ne $Actual) { throw "Checksum mismatch; the download may be corrupted. Try again." }

  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  $Exe = Join-Path $InstallDir "amicooked.exe"
  $Staged = Join-Path $InstallDir (".amicooked-install-" + [Guid]::NewGuid() + ".exe")
  $Previous = "$Exe.previous"
  Move-Item (Join-Path $Tmp $Asset) $Staged
  try {
    $HadPrevious = Test-Path $Exe
    if ($HadPrevious) {
      if (Test-Path $Previous) { Remove-Item $Previous -Force }
      Move-Item $Exe $Previous
    }
    try { Move-Item $Staged $Exe }
    catch {
      if ($HadPrevious -and (Test-Path $Previous)) { Move-Item $Previous $Exe }
      throw
    }
  } finally {
    if (Test-Path $Staged) { Remove-Item $Staged -Force }
  }
  Write-Host "Installed to $Exe"
} finally {
  Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
}

# Put it on the user's PATH for future terminals, and this one
if ($env:AMICOOKED_NO_PATH -ne "1") {
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (-not ($UserPath -split ";" | Where-Object { $_ -eq $InstallDir })) {
  $NewPath = if ($UserPath) { "$UserPath;$InstallDir" } else { $InstallDir }
  [Environment]::SetEnvironmentVariable("Path", $NewPath, "User")
}
if (-not ($env:Path -split ";" | Where-Object { $_ -eq $InstallDir })) { $env:Path = "$env:Path;$InstallDir" }
}

if ($env:AMICOOKED_NO_SETUP -eq "1") {
  Write-Host "Next: run amicooked setup"
} else {
  $SetupArgs = @("setup")
  if ($env:AMICOOKED_CLIENTS) { $SetupArgs += @("--clients", $env:AMICOOKED_CLIENTS) }
  if ($env:AMICOOKED_SCHOOL) { $SetupArgs += @("--school", $env:AMICOOKED_SCHOOL) }
  & $Exe @SetupArgs
  if ($LASTEXITCODE -ne 0) { throw "Am I Cooked setup failed (exit $LASTEXITCODE). Run amicooked setup to retry." }
}
