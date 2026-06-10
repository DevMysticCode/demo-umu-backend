<#
.SYNOPSIS
  Push the app secret to AWS Secrets Manager from a local JSON file.

.DESCRIPTION
  Validates that every required key is present + non-empty BEFORE the
  AWS call, so a typo doesn't get committed to prod. The CDK created
  the secret with a placeholder; this overwrites it with the real
  values from $JsonPath.

  Required keys (mirrors what App Runner expects + what env.validation
  enforces at boot):
    JWT_SECRET, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, RESEND_API_KEY,
    ADMIN_SECRET, CORS_ORIGINS, PERSONA_API_KEY, PERSONA_WEBHOOK_SECRET,
    PERSONA_TEMPLATE_ID, HMLR_PFX_PASSPHRASE, HMLR_OV_ENDPOINT,
    GOOGLE_API_KEY, OS_API_KEY, GROQ_API_KEY, SENTRY_DSN,
    S3_UPLOADS_BUCKET

.EXAMPLE
  .\populate-secrets.ps1 -JsonPath ..\prod-secrets.json

.NOTES
  $JsonPath should be gitignored (the infra .gitignore catches
  *-secrets.json). DELETE the file once this script succeeds —
  Secrets Manager is now the source of truth.
#>

param(
  [Parameter(Mandatory = $true)]
  [string]$JsonPath,

  [string]$SecretId = 'umu/prod/app',
  [string]$Region   = 'eu-west-2'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $JsonPath)) {
  Write-Error "JSON file not found: $JsonPath"
  exit 1
}

$json = Get-Content $JsonPath -Raw | ConvertFrom-Json

$required = @(
  'JWT_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'RESEND_API_KEY',
  'ADMIN_SECRET', 'CORS_ORIGINS', 'PERSONA_API_KEY', 'PERSONA_WEBHOOK_SECRET',
  'PERSONA_TEMPLATE_ID', 'HMLR_PFX_PASSPHRASE', 'HMLR_OV_ENDPOINT',
  'GOOGLE_API_KEY', 'OS_API_KEY', 'GROQ_API_KEY', 'SENTRY_DSN',
  'S3_UPLOADS_BUCKET'
)

$missing = @()
foreach ($k in $required) {
  if (-not ($json.PSObject.Properties.Name -contains $k) -or
      [string]::IsNullOrWhiteSpace($json.$k)) {
    $missing += $k
  }
}
if ($missing.Count -gt 0) {
  Write-Host "[populate-secrets] Missing or empty keys:" -ForegroundColor Red
  $missing | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
  exit 1
}

# Spot checks that catch the most common copy-paste mistakes.
if ($json.STRIPE_SECRET_KEY -notmatch '^sk_(test|live)_') {
  Write-Error 'STRIPE_SECRET_KEY must start with sk_test_ or sk_live_'
  exit 1
}
if ($json.STRIPE_WEBHOOK_SECRET -notmatch '^whsec_') {
  Write-Error 'STRIPE_WEBHOOK_SECRET must start with whsec_'
  exit 1
}
if ($json.JWT_SECRET.Length -lt 32) {
  Write-Error "JWT_SECRET must be at least 32 chars (got $($json.JWT_SECRET.Length))"
  exit 1
}
if ($json.ADMIN_SECRET.Length -lt 16 -or $json.ADMIN_SECRET -eq '123') {
  Write-Error 'ADMIN_SECRET must be at least 16 chars and not the placeholder "123"'
  exit 1
}

Write-Host "[populate-secrets] All $($required.Count) required keys present + shape-valid."
Write-Host "[populate-secrets] Pushing to AWS Secrets Manager → $SecretId ($Region)..."

# Re-serialise to compact JSON (Secrets Manager has a 64KB string limit)
$payload = $json | ConvertTo-Json -Compress

aws secretsmanager put-secret-value `
  --secret-id $SecretId `
  --region $Region `
  --secret-string $payload | Out-Null

if ($LASTEXITCODE -ne 0) {
  Write-Error "AWS Secrets Manager update failed (exit $LASTEXITCODE)"
  exit $LASTEXITCODE
}

Write-Host "[populate-secrets] ✓ Updated $SecretId" -ForegroundColor Green
Write-Host "[populate-secrets] DELETE $JsonPath now — secret is in AWS." -ForegroundColor Yellow
