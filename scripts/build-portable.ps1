$ErrorActionPreference = 'Stop'

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$electronRoot = Join-Path $projectRoot 'node_modules\electron\dist'
$targetRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'dist\Codex-Meter-win32-x64'))
$boundary = $projectRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar

if (-not $targetRoot.StartsWith($boundary, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to build outside the project root: $targetRoot"
}
if (-not (Test-Path -LiteralPath (Join-Path $electronRoot 'electron.exe') -PathType Leaf)) {
  throw 'Electron runtime is missing. Run npm install first.'
}
if (Test-Path -LiteralPath $targetRoot) {
  throw "Portable output already exists. Move it aside before rebuilding: $targetRoot"
}

$appRoot = Join-Path $targetRoot 'resources\app'
$brandedExeName = 'Codex' + [char]0x4F59 + [char]0x989D + [char]0x5EA6 + [char]0x52A9 + [char]0x624B + '.exe'
New-Item -ItemType Directory -Path $targetRoot | Out-Null
Copy-Item -Path (Join-Path $electronRoot '*') -Destination $targetRoot -Recurse
New-Item -ItemType Directory -Path $appRoot | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'electron') -Destination $appRoot -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot 'src') -Destination $appRoot -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot 'package.json') -Destination $appRoot
Copy-Item -LiteralPath (Join-Path $projectRoot 'README.md') -Destination $targetRoot
Move-Item -LiteralPath (Join-Path $targetRoot 'electron.exe') -Destination (Join-Path $targetRoot $brandedExeName)

$localesRoot = Join-Path $targetRoot 'locales'
if (Test-Path -LiteralPath $localesRoot -PathType Container) {
  $unusedLocales = @(Get-ChildItem -LiteralPath $localesRoot -File | Where-Object { $_.Name -notin @('en-US.pak', 'zh-CN.pak') })
  foreach ($locale in $unusedLocales) { Remove-Item -LiteralPath $locale.FullName -Force }
}

Write-Output "Portable app created: $targetRoot"
