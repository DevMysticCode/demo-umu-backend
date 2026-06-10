# UMU Infrastructure — Runbook

## TL;DR — full deploy from a fresh AWS account

```powershell
# 0. PATH (Windows — add aws CLI for this session if not on PATH)
$env:Path += ';C:\Program Files\Amazon\AWSCLIV2'

# 1. Bootstrap CDK (one-time per account/region)
cd umu-backend/infra
npm install
cdk bootstrap aws://<ACCOUNT>/eu-west-2

# 2. Deploy foundation (VPC + RDS + S3 + ECR + Secrets). ~10 min.
cdk deploy UmuFoundation

# 3. Build + push the first image to the ECR repo created above
cd ..
$ACCOUNT = "<ACCOUNT>"
$REGION  = "eu-west-2"
aws ecr get-login-password --region $REGION |
  docker login --username AWS --password-stdin "$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"
docker build -t umu-backend:latest .
docker tag umu-backend:latest "$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/umu-backend:latest"
docker push "$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/umu-backend:latest"

# 4. Populate Secrets Manager with the real app secret JSON
#    (build umu/prod/app from a JSON file — see "Populating secrets" below)
aws secretsmanager put-secret-value `
  --secret-id umu/prod/app `
  --secret-string file://prod-secrets.json

# 5. Deploy compute (App Runner). ~5 min.
cd infra
cdk deploy UmuCompute

# 6. Smoke-test the public URL printed in the outputs
curl https://<service-id>.eu-west-2.awsapprunner.com/health
```

## Cost expectations

| Component | Monthly cost (launch scale) |
|---|---|
| App Runner (1 vCPU / 2 GB, 1 instance idle, scales to ~3 peak) | ~£30–40 |
| RDS Postgres `db.t4g.small` + 20 GB | ~£28 |
| RDS backups (30 days) | included in storage cost above |
| S3 storage + transfer | ~£3–5 |
| ECR storage | <£1 |
| Secrets Manager (2 secrets × £0.40) | £0.80 |
| CloudWatch logs (30 day retention) | ~£2 |
| Data transfer egress | ~£5 at low traffic |
| **Total** | **~£70–80/mo** |

Scales linearly with App Runner instance count + DB storage. No NAT
gateway is the key cost-saving choice — saves ~£30/mo.

## Populating secrets

The CDK creates `umu/prod/app` with a placeholder. Before App Runner
will boot cleanly, populate it with the real values.

Create `prod-secrets.json` locally (gitignored, NEVER commit):

```json
{
  "JWT_SECRET": "<run: openssl rand -hex 32>",
  "STRIPE_SECRET_KEY": "sk_live_...",
  "STRIPE_WEBHOOK_SECRET": "whsec_...",
  "RESEND_API_KEY": "...",
  "ADMIN_SECRET": "<run: openssl rand -hex 32>",
  "CORS_ORIGINS": "https://app.umovingu.com,capacitor://localhost",
  "PERSONA_API_KEY": "...",
  "PERSONA_WEBHOOK_SECRET": "...",
  "PERSONA_TEMPLATE_ID": "itmpl_...",
  "HMLR_PFX_PASSPHRASE": "...",
  "HMLR_OV_ENDPOINT": "https://...",
  "GOOGLE_API_KEY": "...",
  "OS_API_KEY": "...",
  "GROQ_API_KEY": "gsk_...",
  "SENTRY_DSN": "https://...@sentry.io/...",
  "S3_UPLOADS_BUCKET": "umu-prod-uploads-<ACCOUNT>"
}
```

Then push to Secrets Manager:

```powershell
aws secretsmanager put-secret-value `
  --secret-id umu/prod/app `
  --secret-string file://prod-secrets.json
```

DELETE the local JSON immediately after — Secrets Manager is now the
source of truth.

## Migrating data from Railway → RDS

The RDS instance comes up empty. The TestFlight users on Railway need
their data brought across.

```powershell
# 1. Find the Railway connection string
$RAILWAY_URL = "<paste from Railway dashboard>"

# 2. Find the RDS endpoint from the CDK outputs
$RDS_HOST = aws cloudformation describe-stacks --stack-name UmuFoundation `
  --query "Stacks[0].Outputs[?OutputKey=='DbEndpoint'].OutputValue" --output text

# 3. Get the RDS admin password from Secrets Manager
$RDS_PASS = aws secretsmanager get-secret-value `
  --secret-id umu/prod/db-credentials `
  --query SecretString --output text | ConvertFrom-Json | Select-Object -ExpandProperty password

# 4. Dump from Railway. --no-owner because the role names differ.
pg_dump --no-owner --no-privileges --clean --if-exists `
  --dbname=$RAILWAY_URL --file=railway-dump.sql

# 5. RDS is in a private subnet — restore must go through a temporary
#    bastion or be run from inside the VPC. Two approaches:

# Approach A: temporary EC2 bastion (15 min, ~£0 cost for the hour)
#   - Spin up t4g.micro in the public subnet with psql installed
#   - Copy railway-dump.sql via scp
#   - psql -h <rds-host> -U umuadmin -d umu < railway-dump.sql
#   - Terminate the bastion

# Approach B: temporary VPC connector lambda (~free, more setup)
#   - Lambda in the same VPC subnets as RDS
#   - Trigger from local with the SQL dump payload

# Approach C: temporarily flip RDS to publicly accessible + IP-allow
#   YOUR home IP for the duration of the restore. Easiest but
#   highest risk; REMEMBER to flip back to private after.
```

I'd recommend Approach A for this one-time migration.

## Updating the running service

After the initial deploy, every code change just needs a new image
pushed — App Runner auto-deploys it (we set `autoDeploymentsEnabled: true`):

```powershell
docker build -t umu-backend:latest .
docker tag umu-backend:latest "$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/umu-backend:latest"
docker push "$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/umu-backend:latest"
# App Runner sees the new image in ~30s, deploys it, ~2 min total
```

Tag with the git SHA in addition to `latest` if you want rollback:
```powershell
$SHA = git rev-parse --short HEAD
docker tag umu-backend:latest "$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/umu-backend:$SHA"
```

## Custom domain

```powershell
# 1. Associate a custom domain via App Runner (creates a CNAME challenge)
$SERVICE_ARN = aws cloudformation describe-stacks --stack-name UmuCompute `
  --query "Stacks[0].Outputs[?OutputKey=='AppRunnerServiceArn'].OutputValue" --output text

aws apprunner associate-custom-domain `
  --service-arn $SERVICE_ARN `
  --domain-name api.umovingu.com

# 2. App Runner returns DNS challenge records. Add them at your domain
#    registrar exactly as printed:
#    - 1× CNAME for ownership validation
#    - 1× CNAME for the cert validation
#    - Then a CNAME from api.umovingu.com → <service-host>.eu-west-2.awsapprunner.com

# 3. Wait ~10–30 min for validation to complete
aws apprunner describe-custom-domains --service-arn $SERVICE_ARN
# Status should go PENDING_CERTIFICATE_DNS_VALIDATION → ACTIVE
```

## Stripe webhook

Once the App Runner URL is live (with or without custom domain):

1. Stripe Dashboard → Developers → Webhooks → Add endpoint
2. URL: `https://api.umovingu.com/payment/webhook` (or the App Runner URL)
3. Events: `payment_intent.succeeded`, `payment_intent.payment_failed`,
   `payment_intent.canceled`, `charge.refunded`
4. Copy the signing secret (`whsec_...`)
5. Update the secret in AWS:

```powershell
# Pull current secret, update one field, push back
$current = aws secretsmanager get-secret-value --secret-id umu/prod/app `
  --query SecretString --output text | ConvertFrom-Json
$current.STRIPE_WEBHOOK_SECRET = "whsec_..."
$current | ConvertTo-Json | Out-File -Encoding utf8 temp-secrets.json
aws secretsmanager put-secret-value --secret-id umu/prod/app `
  --secret-string file://temp-secrets.json
Remove-Item temp-secrets.json
```

## Rolling back

App Runner keeps the previous deployment image. Rollback options:

```powershell
# Option 1: re-tag a previous SHA as `latest` and push
docker pull "$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/umu-backend:<old-sha>"
docker tag <old-sha> latest
docker push latest

# Option 2: trigger a deployment of a specific revision via API
aws apprunner start-deployment --service-arn $SERVICE_ARN
```

For RDS, point-in-time recovery is on with 30-day retention.

## Tearing down (be careful)

```powershell
# RDS has deletionProtection: true — must be flipped manually first
# S3 has removalPolicy: RETAIN — bucket survives a cdk destroy
# ECR has removalPolicy: RETAIN — repo survives a cdk destroy

# Compute first (App Runner stops billing immediately)
cdk destroy UmuCompute

# Then foundation (RDS will snapshot first per `removalPolicy: SNAPSHOT`)
cdk destroy UmuFoundation
```

## Health monitoring

App Runner publishes metrics to CloudWatch automatically. Set alarms:

```powershell
# 5xx rate alarm — alert if >5 errors/min for 5 min
aws cloudwatch put-metric-alarm `
  --alarm-name "umu-backend-5xx" `
  --metric-name 5xxStatusResponses `
  --namespace AWS/AppRunner `
  --statistic Sum `
  --period 60 `
  --threshold 5 `
  --comparison-operator GreaterThanThreshold `
  --evaluation-periods 5 `
  --alarm-actions "arn:aws:sns:eu-west-2:$ACCOUNT:umu-prod-alerts"
```

Sentry catches application-level errors; CloudWatch + these alarms
catch infrastructure / deployment / quota issues.
