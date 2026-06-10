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
#>

param(
  [string]$Account = '412381754866',
  [string]$Region  = 'eu-west-2',
  [string]$Repo    = 'umu-backend'
)

$ErrorActionPreference = 'Stop'

# Move to repo root (this script lives in infra/scripts/)
$repoRoot = Resolve-Path "$PSScriptRoot\..\.."
Set-Location $repoRoot

$registry = "$Account.dkr.ecr.$Region.amazonaws.com"
$imageUri = "$registry/$Repo"
$sha = (git rev-parse --short HEAD).Trim()

Write-Host "[build-and-push] Repo root: $repoRoot"
Write-Host "[build-and-push] Image URI: $imageUri"
Write-Host "[build-and-push] Git SHA:  $sha"

Write-Host "[build-and-push] ECR login..."
$pwd_ = aws ecr get-login-password --region $Region
$pwd_ | docker login --username AWS --password-stdin $registry | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'ECR login failed' }

Write-Host "[build-and-push] Building image..."
# --platform linux/amd64 because App Runner runs amd64. Building on
# Windows ARM (e.g. Surface) without this produces an arm64 image that
# App Runner refuses to start. amd64 is the safe default everywhere.
docker build --platform linux/amd64 -t "${Repo}:${sha}" -t "${Repo}:latest" .
if ($LASTEXITCODE -ne 0) { throw 'docker build failed' }

Write-Host "[build-and-push] Tagging + pushing..."
docker tag "${Repo}:${sha}"    "${imageUri}:${sha}"
docker tag "${Repo}:latest"    "${imageUri}:latest"
docker push "${imageUri}:${sha}"
docker push "${imageUri}:latest"
if ($LASTEXITCODE -ne 0) { throw 'docker push failed' }

Write-Host ""
Write-Host "[build-and-push] ✓ Pushed ${imageUri}:${sha}" -ForegroundColor Green
Write-Host "[build-and-push] ✓ Pushed ${imageUri}:latest" -ForegroundColor Green
Write-Host "[build-and-push] App Runner will auto-deploy in ~30s. Watch with:" -ForegroundColor Yellow
Write-Host "    aws apprunner describe-service --service-arn `$SERVICE_ARN --region $Region --query 'Service.Status'"
