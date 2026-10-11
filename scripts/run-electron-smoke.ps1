param(
  [Parameter(Mandatory = $true)]
  [string]$Script
)

$ErrorActionPreference = 'Stop'

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$projectBoundary = $projectRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$scriptPath = [IO.Path]::GetFullPath((Join-Path $projectRoot $Script))
$runtimeRoot = [IO.Path]::GetFullPath($(if ($env:CODEX_METER_ELECTRON_RUNTIME) {
  $env:CODEX_METER_ELECTRON_RUNTIME
} elseif (Test-Path -LiteralPath (Join-Path $projectRoot 'dist\Codex-Meter-Plus-win32-x64-v0.4.0') -PathType Container) {
  Join-Path $projectRoot 'dist\Codex-Meter-Plus-win32-x64-v0.4.0'
} elseif (Test-Path -LiteralPath (Join-Path $projectRoot '..\..\dist\Codex-Meter-Plus-win32-x64-v0.4.0') -PathType Container) {
  Join-Path $projectRoot '..\..\dist\Codex-Meter-Plus-win32-x64-v0.4.0'
} else {
  Join-Path $projectRoot 'dist\Codex-Meter-Plus-win32-x64'
}))
$tempParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar)
$tempBoundary = $tempParent + [IO.Path]::DirectorySeparatorChar
$smokeName = [IO.Path]::GetFileNameWithoutExtension($scriptPath)
$smokeRuntime = [IO.Path]::GetFullPath((Join-Path $tempParent ("codex-plus-{0}-{1}" -f $smokeName, $PID)))
$smokeAppRoot = Join-Path $smokeRuntime 'app-under-test'

if (-not $scriptPath.StartsWith($projectBoundary, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Smoke script escaped the project root: $scriptPath"
}
if (-not (Test-Path -LiteralPath $scriptPath -PathType Leaf)) {
  throw "Smoke script is missing: $scriptPath"
}
if (-not (Test-Path -LiteralPath $runtimeRoot -PathType Container)) {
  throw "Portable Electron runtime is missing: $runtimeRoot"
}
if (-not $smokeRuntime.StartsWith($tempBoundary, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Smoke runtime escaped the temporary directory: $smokeRuntime"
}
if (Test-Path -LiteralPath $smokeRuntime) {
  throw "Smoke runtime already exists: $smokeRuntime"
}

$plusExeName = 'Codex' + [char]0x4F59 + [char]0x989D + 'Plus.exe'
$assistantExeName = 'Codex' + [char]0x4F59 + [char]0x989D + [char]0x52A9 + [char]0x624B + '.exe'
$sourceExe = @('electron.exe', $plusExeName, $assistantExeName) |
  ForEach-Object { Join-Path $runtimeRoot $_ } |
  Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
  Select-Object -First 1
if (-not $sourceExe) {
  throw "Electron executable is missing from: $runtimeRoot"
}

try {
  New-Item -ItemType Directory -Path $smokeRuntime | Out-Null
  Get-ChildItem -LiteralPath $runtimeRoot -Force |
    Where-Object { $_.Name -ne 'resources' } |
    Copy-Item -Destination $smokeRuntime -Recurse
  New-Item -ItemType Directory -Path (Join-Path $smokeRuntime 'resources') | Out-Null
  Get-ChildItem -LiteralPath (Join-Path $runtimeRoot 'resources') -Force |
    Where-Object { $_.Name -ne 'app' } |
    Copy-Item -Destination (Join-Path $smokeRuntime 'resources') -Recurse

  # Older portable Electron builds can misdecode a non-ASCII script path on
  # Windows. Keep the real source as the authority, but execute an exact smoke
  # copy from the ASCII-only temporary runtime so the test itself is reliable.
  New-Item -ItemType Directory -Path (Join-Path $smokeAppRoot 'scripts') -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $projectRoot 'electron') -Destination $smokeAppRoot -Recurse
  Copy-Item -LiteralPath (Join-Path $projectRoot 'src') -Destination $smokeAppRoot -Recurse
  $smokeScriptPath = Join-Path (Join-Path $smokeAppRoot 'scripts') ([IO.Path]::GetFileName($scriptPath))
  Copy-Item -LiteralPath $scriptPath -Destination $smokeScriptPath

  $copiedExe = Join-Path $smokeRuntime ([IO.Path]::GetFileName($sourceExe))
  $electronExe = Join-Path $smokeRuntime 'electron.exe'
  if (-not $copiedExe.Equals($electronExe, [StringComparison]::OrdinalIgnoreCase)) {
    Move-Item -LiteralPath $copiedExe -Destination $electronExe
  }

  $stdoutPath = Join-Path $smokeRuntime 'stdout.log'
  $stderrPath = Join-Path $smokeRuntime 'stderr.log'
  $process = Start-Process -FilePath $electronExe -ArgumentList ('"{0}"' -f $smokeScriptPath) -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
  if (Test-Path -LiteralPath $stdoutPath) { Get-Content -LiteralPath $stdoutPath | Write-Output }
  if ($process.ExitCode -ne 0) {
    if (Test-Path -LiteralPath $stderrPath) { Get-Content -LiteralPath $stderrPath | Write-Warning }
    throw "Electron smoke test failed with exit code $($process.ExitCode)"
  }
  Write-Output "Electron smoke test passed: $Script"
} finally {
  if (Test-Path -LiteralPath $smokeRuntime) {
    $item = Get-Item -LiteralPath $smokeRuntime -Force
    if (-not $item.PSIsContainer) { throw 'Smoke cleanup target is not a directory.' }
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Smoke cleanup target is a reparse point.' }
    $links = @(Get-ChildItem -LiteralPath $smokeRuntime -Force -Recurse | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint })
    if ($links.Count) { throw 'Smoke cleanup target contains reparse points.' }
    $activeRuntimeProcesses = @()
    for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
      $activeRuntimeProcesses = @(Get-Process -Name electron -ErrorAction SilentlyContinue | Where-Object {
        $_.Path -and $_.Path.StartsWith($smokeRuntime + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
      })
      if (-not $activeRuntimeProcesses.Count) { break }
      Start-Sleep -Milliseconds 100
    }
    if ($activeRuntimeProcesses.Count) {
      throw "Smoke runtime is still in use and was preserved: $smokeRuntime"
    }
    try {
      Remove-Item -LiteralPath $smokeRuntime -Recurse -Force -ErrorAction Stop
    } catch [System.UnauthorizedAccessException] {
      Write-Warning "Electron smoke assertions passed, but Windows kept the temporary runtime locked; it was preserved for safe cleanup: $smokeRuntime"
    }
  }
}
