<#
.SYNOPSIS
  Build the backend Docker image and push to ECR, triggering an
  App Runner auto-deploy.

.DESCRIPTION
  Run from anywhere — the script cd's to the backend repo root for the
  build. Tags both `latest` (App Runner watches this) and the current
  git SHA (so rollback is one re-tag).

.EXAMPLE
  .\build-and-push.ps1

.NOTES
  Auto-deploy is on in UmuComputeStack so App Runner picks up the new
  image in ~30s and the rolling deploy completes in ~2 min.

  PowerShell + docker quirks handled:
   - $ErrorActionPreference = Continue throughout, because docker
     writes BuildKit progress + login warnings to stderr, and PS
     under 'Stop' would treat each as a terminating error.
   - We check $LASTEXITCODE after every docker call explicitly.
   - ECR login uses --password (not --password-stdin) because PS
     mangles stdin encoding and the registry returns 400.
#>

param(
  [string]$Account = '412381754866',
  [string]$Region  = 'eu-west-2',
  [string]$Repo    = 'umu-backend'
)

# IMPORTANT: don't auto-stop on stderr — docker's progress + warnings go there.
$ErrorActionPreference = 'Continue'

function Invoke-Step {
  param([string]$Name, [scriptblock]$Block)
  Write-Host "[build-and-push] $Name..." -ForegroundColor Cyan
  & $Block
  if ($LASTEXITCODE -ne 0) {
    Write-Host "[build-and-push] FAILED at: $Name (exit $LASTEXITCODE)" -ForegroundColor Red
    exit $LASTEXITCODE
  }
}

# Move to repo root (this script lives in infra/scripts/)
$repoRoot = Resolve-Path "$PSScriptRoot\..\.."
Set-Location $repoRoot

$registry = "$Account.dkr.ecr.$Region.amazonaws.com"
$imageUri = "$registry/$Repo"
$sha = (git rev-parse --short HEAD).Trim()

Write-Host "[build-and-push] Repo root: $repoRoot"
Write-Host "[build-and-push] Image URI: $imageUri"
Write-Host "[build-and-push] Git SHA:  $sha"

Invoke-Step "ECR login" {
  $pwd_ = aws ecr get-login-password --region $Region
  docker login --username AWS --password $pwd_ $registry 2>&1 |
    Where-Object { $_ -notmatch 'WARNING' } |
    Out-Host
}

Invoke-Step "Build image (linux/amd64)" {
  # --platform linux/amd64 because App Runner runs amd64. On Windows ARM
  # without this you get an arm64 image that App Runner refuses.
  docker build --platform linux/amd64 -t "${Repo}:${sha}" -t "${Repo}:latest" . 2>&1 | Out-Host
}

Invoke-Step "Tag for ECR" {
  docker tag "${Repo}:${sha}"    "${imageUri}:${sha}"    2>&1 | Out-Host
  docker tag "${Repo}:latest"    "${imageUri}:latest"    2>&1 | Out-Host
}

Invoke-Step "Push :$sha" {
  docker push "${imageUri}:${sha}" 2>&1 | Out-Host
}

Invoke-Step "Push :latest" {
  docker push "${imageUri}:latest" 2>&1 | Out-Host
}

Write-Host ""
Write-Host "[build-and-push] ✓ Pushed ${imageUri}:${sha}" -ForegroundColor Green
Write-Host "[build-and-push] ✓ Pushed ${imageUri}:latest" -ForegroundColor Green
Write-Host "[build-and-push] App Runner will auto-deploy in ~30s." -ForegroundColor Yellow
