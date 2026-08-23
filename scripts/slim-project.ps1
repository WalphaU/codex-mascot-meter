$ErrorActionPreference = 'Stop'

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$portableRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'dist\Codex-Meter-win32-x64'))
$expectedPortableRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'dist\Codex-Meter-win32-x64'))
$duplicateExe = Join-Path $portableRoot 'electron.exe'
$localesRoot = [IO.Path]::GetFullPath((Join-Path $portableRoot 'locales'))
$electronPackageRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'node_modules\electron'))
$developmentRuntime = [IO.Path]::GetFullPath((Join-Path $electronPackageRoot 'dist'))
$expectedDevelopmentRuntime = [IO.Path]::GetFullPath((Join-Path $projectRoot 'node_modules\electron\dist'))
$electronPathFile = Join-Path $electronPackageRoot 'path.txt'

if ($portableRoot -ne $expectedPortableRoot -or -not $portableRoot.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Unexpected portable root: $portableRoot"
}
$brandedCandidates = @(Get-ChildItem -LiteralPath $portableRoot -File -Filter '*.exe' | Where-Object { $_.Name -ne 'electron.exe' })
if ($brandedCandidates.Count -ne 1) { throw "Expected exactly one branded portable executable, found $($brandedCandidates.Count)." }
$brandedExe = $brandedCandidates[0].FullName
if ($developmentRuntime -ne $expectedDevelopmentRuntime -or -not $developmentRuntime.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Unexpected development runtime: $developmentRuntime"
}

if (Test-Path -LiteralPath $electronPathFile -PathType Leaf) {
  $relativePortableExe = Join-Path '..\..\..\dist\Codex-Meter-win32-x64' $brandedCandidates[0].Name
  [IO.File]::WriteAllText($electronPathFile, $relativePortableExe, [Text.UTF8Encoding]::new($false))
}

if (Test-Path -LiteralPath $duplicateExe -PathType Leaf) {
  Remove-Item -LiteralPath $duplicateExe -Force
}

if (Test-Path -LiteralPath $localesRoot -PathType Container) {
  $localeDirectory = Get-Item -LiteralPath $localesRoot -Force
  if ($localeDirectory.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Refusing to traverse locale reparse point: $localesRoot" }
  $unusedLocales = @(Get-ChildItem -LiteralPath $localesRoot -File | Where-Object { $_.Name -notin @('en-US.pak', 'zh-CN.pak') })
  foreach ($locale in $unusedLocales) { Remove-Item -LiteralPath $locale.FullName -Force }
}

if (Test-Path -LiteralPath $developmentRuntime -PathType Container) {
  $runtimeDirectory = Get-Item -LiteralPath $developmentRuntime -Force
  if ($runtimeDirectory.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Refusing to remove runtime reparse point: $developmentRuntime" }
  $runtimeFiles = @(Get-ChildItem -LiteralPath $developmentRuntime -Recurse -Force -File)
  if (-not $runtimeFiles.Count) { throw "Development runtime unexpectedly contains no files: $developmentRuntime" }
  Remove-Item -LiteralPath $developmentRuntime -Recurse -Force
}

Write-Output 'Project slimming complete. npm start and npm run preview:capture now reuse the branded portable runtime.'
