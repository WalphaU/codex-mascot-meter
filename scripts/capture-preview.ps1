$ErrorActionPreference = 'Stop'

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimeRoot = [IO.Path]::GetFullPath($(if ($env:CODEX_METER_ELECTRON_RUNTIME) {
  $env:CODEX_METER_ELECTRON_RUNTIME
} elseif (Test-Path -LiteralPath (Join-Path $projectRoot 'dist\Codex-Meter-Plus-win32-x64-v0.4.0') -PathType Container) {
  Join-Path $projectRoot 'dist\Codex-Meter-Plus-win32-x64-v0.4.0'
} elseif (Test-Path -LiteralPath (Join-Path $projectRoot '..\..\dist\Codex-Meter-Plus-win32-x64-v0.4.0') -PathType Container) {
  Join-Path $projectRoot '..\..\dist\Codex-Meter-Plus-win32-x64-v0.4.0'
} else {
  Join-Path $projectRoot 'dist\Codex-Meter-Plus-win32-x64'
}))
$plusExeName = 'Codex' + [char]0x4F59 + [char]0x989D + 'Plus.exe'
$runtimeExe = Join-Path $runtimeRoot $plusExeName
$captureScript = Join-Path $projectRoot 'scripts\capture-preview.cjs'
$tempParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$captureRuntime = [IO.Path]::GetFullPath((Join-Path $tempParent ("codex-plus-capture-{0}" -f $PID)))
$tempBoundary = $tempParent + '\'

if (-not (Test-Path -LiteralPath $runtimeExe -PathType Leaf)) {
  throw "Portable Plus runtime is missing: $runtimeExe"
}
if (-not $captureRuntime.StartsWith($tempBoundary, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Capture runtime escaped the temporary directory: $captureRuntime"
}
if (Test-Path -LiteralPath $captureRuntime) {
  throw "Capture runtime already exists: $captureRuntime"
}

try {
  New-Item -ItemType Directory -Path $captureRuntime | Out-Null
  Get-ChildItem -LiteralPath $runtimeRoot -Force |
    Where-Object { $_.Name -ne 'resources' } |
    Copy-Item -Destination $captureRuntime -Recurse
  New-Item -ItemType Directory -Path (Join-Path $captureRuntime 'resources') | Out-Null
  Get-ChildItem -LiteralPath (Join-Path $runtimeRoot 'resources') -Force |
    Where-Object { $_.Name -ne 'app' } |
    Copy-Item -Destination (Join-Path $captureRuntime 'resources') -Recurse

  $electronExe = Join-Path $captureRuntime 'electron.exe'
  Move-Item -LiteralPath (Join-Path $captureRuntime $plusExeName) -Destination $electronExe
  $captureSourceRoot = Join-Path $captureRuntime 'capture-source'
  New-Item -ItemType Directory -Path $captureSourceRoot | Out-Null
  Copy-Item -LiteralPath (Join-Path $projectRoot 'electron') -Destination $captureSourceRoot -Recurse
  Copy-Item -LiteralPath (Join-Path $projectRoot 'src') -Destination $captureSourceRoot -Recurse
  New-Item -ItemType Directory -Path (Join-Path $captureSourceRoot 'scripts') | Out-Null
  $runtimeCaptureScript = Join-Path $captureSourceRoot 'scripts\capture-preview.cjs'
  Copy-Item -LiteralPath $captureScript -Destination $runtimeCaptureScript
  $env:CODEX_CAPTURE_TEMP = $captureRuntime
  $captureStdout = Join-Path $captureRuntime 'preview-stdout.log'
  $captureStderr = Join-Path $captureRuntime 'preview-stderr.log'
  $captureProcess = Start-Process -FilePath $electronExe -ArgumentList ('"{0}"' -f $runtimeCaptureScript) -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput $captureStdout -RedirectStandardError $captureStderr
  if ($captureProcess.ExitCode -ne 0) {
    if (Test-Path -LiteralPath $captureStdout) { Get-Content -LiteralPath $captureStdout | Write-Output }
    if (Test-Path -LiteralPath $captureStderr) { Get-Content -LiteralPath $captureStderr | Write-Warning }
    throw "Preview capture failed with exit code $($captureProcess.ExitCode)"
  }
  $generatedArtifacts = Join-Path $captureSourceRoot 'artifacts'
  $projectArtifacts = Join-Path $projectRoot 'artifacts'
  New-Item -ItemType Directory -Path $projectArtifacts -Force | Out-Null
  Get-ChildItem -LiteralPath $generatedArtifacts -File | Copy-Item -Destination $projectArtifacts -Force
} finally {
  Remove-Item Env:CODEX_CAPTURE_TEMP -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $captureRuntime) {
    $item = Get-Item -LiteralPath $captureRuntime -Force
    if (-not $item.PSIsContainer) { throw 'Capture cleanup target is not a directory.' }
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Capture cleanup target is a reparse point.' }
    $links = @(Get-ChildItem -LiteralPath $captureRuntime -Force -Recurse | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint })
    if ($links.Count) { throw 'Capture cleanup target contains reparse points.' }
    Remove-Item -LiteralPath $captureRuntime -Recurse -Force
  }
}
