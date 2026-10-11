$ErrorActionPreference = 'Stop'

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$developmentRuntime = Join-Path $projectRoot 'node_modules\electron\dist'
$bundledRuntime = Join-Path $projectRoot 'dist\Codex-Meter-win32-x64'
$requestedRuntime = $env:CODEX_METER_ELECTRON_RUNTIME
$electronRoot = if ($requestedRuntime) {
  [IO.Path]::GetFullPath($requestedRuntime)
} elseif (Test-Path -LiteralPath (Join-Path $developmentRuntime 'electron.exe') -PathType Leaf) {
  $developmentRuntime
} else {
  $bundledRuntime
}
$defaultTargetRoot = Join-Path $projectRoot 'dist\Codex-Meter-Plus-win32-x64'
$targetRoot = [IO.Path]::GetFullPath($(if ($env:CODEX_METER_PORTABLE_TARGET) { $env:CODEX_METER_PORTABLE_TARGET } else { $defaultTargetRoot }))
$boundary = $projectRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar

if (-not $targetRoot.StartsWith($boundary, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to build outside the project root: $targetRoot"
}
$sourceRuntimeExeName = 'Codex' + [char]0x4F59 + [char]0x989D + [char]0x52A9 + [char]0x624B + '.exe'
$plusRuntimeExeName = 'Codex' + [char]0x4F59 + [char]0x989D + 'Plus.exe'
$sourceExecutable = @('electron.exe', $sourceRuntimeExeName, $plusRuntimeExeName) |
  ForEach-Object { Join-Path $electronRoot $_ } |
  Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
  Select-Object -First 1
if (-not $sourceExecutable) { throw 'Electron runtime is missing. Restore the original portable runtime or run npm install.' }
if (Test-Path -LiteralPath $targetRoot) {
  throw "Portable output already exists. Move it aside before rebuilding: $targetRoot"
}

$appRoot = Join-Path $targetRoot 'resources\app'
$brandedExeName = 'Codex' + [char]0x4F59 + [char]0x989D + 'Plus.exe'
New-Item -ItemType Directory -Path $targetRoot | Out-Null
Get-ChildItem -LiteralPath $electronRoot -Force | Where-Object { $_.Name -ne 'resources' } | Copy-Item -Destination $targetRoot -Recurse
New-Item -ItemType Directory -Path (Join-Path $targetRoot 'resources') | Out-Null
Get-ChildItem -LiteralPath (Join-Path $electronRoot 'resources') -Force | Where-Object { $_.Name -ne 'app' } | Copy-Item -Destination (Join-Path $targetRoot 'resources') -Recurse
New-Item -ItemType Directory -Path $appRoot | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'electron') -Destination $appRoot -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot 'src') -Destination $appRoot -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot 'package.json') -Destination $appRoot
Copy-Item -LiteralPath (Join-Path $projectRoot 'README.md') -Destination $targetRoot
$copiedExecutable = Join-Path $targetRoot ([IO.Path]::GetFileName($sourceExecutable))
Move-Item -LiteralPath $copiedExecutable -Destination (Join-Path $targetRoot $brandedExeName)

$localesRoot = Join-Path $targetRoot 'locales'
if (Test-Path -LiteralPath $localesRoot -PathType Container) {
  $unusedLocales = @(Get-ChildItem -LiteralPath $localesRoot -File | Where-Object { $_.Name -notin @('en-US.pak', 'zh-CN.pak') })
  foreach ($locale in $unusedLocales) { Remove-Item -LiteralPath $locale.FullName -Force }
}

Write-Output "Portable app created: $targetRoot"
