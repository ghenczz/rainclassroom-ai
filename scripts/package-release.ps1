$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$package = Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json
$version = $package.version
$releaseDir = Join-Path $root "release"
$stage = Join-Path $releaseDir "rainclassroom-ai-$version"

if (-not (Test-Path (Join-Path $root "dist/manifest.json"))) {
  throw "未找到 dist/manifest.json，请先运行 npm run build。"
}

New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $stage | Out-Null

Copy-Item (Join-Path $root "dist") (Join-Path $stage "dist") -Recurse
Copy-Item (Join-Path $root "使用说明.md") $stage
Copy-Item (Join-Path $root "使用说明.txt") $stage
Copy-Item (Join-Path $root "LICENSE") $stage
Copy-Item (Join-Path $root "THIRD_PARTY_NOTICES.md") $stage

$distZip = Join-Path $releaseDir "rainclassroom-ai-v$version-dist.zip"
Remove-Item $distZip -Force -ErrorAction SilentlyContinue
Compress-Archive -Path $stage -DestinationPath $distZip -Force

$sourceZip = Join-Path $releaseDir "rainclassroom-ai-v$version-source.zip"
Remove-Item $sourceZip -Force -ErrorAction SilentlyContinue

try {
  git -C $root archive --format=zip --output=$sourceZip HEAD
} catch {
  Write-Warning "未能生成源码包（可能不在 Git 仓库中）：$sourceZip"
}

Write-Output "已生成："
Write-Output "  $distZip"
if (Test-Path $sourceZip) {
  Write-Output "  $sourceZip"
}
