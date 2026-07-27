import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as apprunner from '@aws-cdk/aws-apprunner-alpha';
import { RemovalPolicy } from 'aws-cdk-lib';

/**
 * Foundation stack — the long-lived bits that need to exist BEFORE we
 * can push an image: VPC, RDS, S3, ECR, Secrets.
 *
 * Deploy this first (~10 min for RDS provisioning). Push your initial
 * Docker image to the ECR repo it creates. THEN deploy UmuComputeStack
 * which adds App Runner pointing at that image.
 *
 * Cost contributions at launch scale (~£60-70/mo from this stack):
 *   - RDS db.t4g.small + 20GB: ~£28
 *   - S3 storage: ~£3
 *   - VPC: free (we deliberately avoid NAT gateway, ~£30 saved)
 *   - Secrets Manager + ECR + logs: ~£8
 */
export class UmuFoundationStack extends cdk.Stack {
  public readonly vpc: ec2.IVpc;
  public readonly db: rds.DatabaseInstance;
  public readonly vpcConnectorSg: ec2.SecurityGroup;
  public readonly vpcConnectorSg2: ec2.SecurityGroup;
  public readonly uploadsBucket: s3.Bucket;
  public readonly repo: ecr.Repository;
  public readonly appSecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ─────────────────────────────────────────────────────────────
    // VPC — two AZs, public + egress + isolated subnets, ONE NAT
    // ─────────────────────────────────────────────────────────────
    //
    // Previously natGateways: 0, on the assumption that "App Runner
    // doesn't live inside the VPC" would keep general internet traffic
    // off it. That's wrong in practice: once App Runner is given a VPC
    // connector (needed here so it can reach RDS), ALL outbound traffic
    // — not just DB calls — routes through the VPC. With no NAT, every
    // third-party call (OS Places, EPC, Resend, Stripe, Groq, HMLR,
    // Persona) failed with a connect timeout. Confirmed via CloudWatch:
    // "ConnectTimeoutError ... attempted address: api.os.uk:443".
    //
    // One NAT gateway (~£30-35/mo, shared across both AZs) now gives
    // the App Runner VPC connector's subnet ('private-egress') a route
    // out. RDS stays in 'isolated' (still zero internet route — it
    // never needed one). S3 still goes via the free gateway endpoint.
    this.vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 1,
      // Order matters: CDK allocates CIDR blocks sequentially per group,
      // so 'isolated' MUST stay in the same position it was in before
      // (2nd) to keep its existing subnets' CIDRs unchanged — RDS lives
      // there and a CIDR change forces subnet replacement, which is not
      // something to risk on a single-AZ (no failover) production DB.
      // 'private-egress' goes last so it only claims new address space.
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'isolated', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
        { name: 'private-egress', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
      ],
    });

    // Explicit, stably-named exports for the private-egress subnets —
    // deliberately NOT relying on CDK's automatic cross-stack Ref/export
    // (which only exists while some other stack's CURRENT code imports
    // it). That auto-export appears/disappears based on what Compute's
    // code references *right now*, which makes a same-deploy migration
    // off the old isolated-subnet export impossible without an outage
    // window: CloudFormation won't let Foundation drop an export that
    // the still-deployed Compute stack is using. A fixed exportName
    // exists unconditionally, so Foundation and Compute can be deployed
    // as two independent, safe steps.
    const privateEgressSubnetIds = this.vpc.selectSubnets({
      subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
    }).subnetIds;
    privateEgressSubnetIds.forEach((id, i) => {
      new cdk.CfnOutput(this, `PrivateEgressSubnet${i + 1}Id`, {
        value: id,
        exportName: `UmuFoundation-PrivateEgressSubnet${i + 1}Id`,
      });
    });
    this.vpc.addGatewayEndpoint('S3Endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
    });

    // ─────────────────────────────────────────────────────────────
    // S3 — private bucket for user uploads
    // ─────────────────────────────────────────────────────────────
    //
    // Two delivery models share one bucket:
    //   - Private prefixes (documents/, passport-docs/, kyc/...) —
    //     blocked from public-read; access only via HMAC-signed
    //     /files/* URLs that we mint in FilesService.
    //   - Public prefixes (avatars/, job-photos/, property-images/) —
    //     uploaded with `public-read` ACL by multer-s3 so <img src>
    //     can fetch them directly from S3 without our API in the path.
    //
    // BlockPublicAcls must be FALSE to let multer-s3 set per-object
    // public-read. We keep blockPublicPolicy=true so nobody can
    // accidentally make the WHOLE bucket public via a bucket policy.
    this.uploadsBucket = new s3.Bucket(this, 'UploadsBucket', {
      bucketName: `umu-prod-uploads-${this.account}`,
      removalPolicy: RemovalPolicy.RETAIN,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
      blockPublicAccess: new s3.BlockPublicAccess({
        blockPublicAcls: false,
        ignorePublicAcls: false,
        blockPublicPolicy: true,
        restrictPublicBuckets: false,
      }),
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      lifecycleRules: [
        { id: 'expire-noncurrent', noncurrentVersionExpiration: cdk.Duration.days(30) },
      ],
      cors: [
        {
          allowedOrigins: ['*'],
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedHeaders: ['*'],
          maxAge: 3000,
        },
      ],
    });

    // ─────────────────────────────────────────────────────────────
    // RDS PostgreSQL 16 — db.t4g.small, single AZ to start
    // ─────────────────────────────────────────────────────────────
    //
    // Both security groups live HERE (not in the compute stack) so the
    // ingress rule can be authored in a single place — putting it
    // across stacks creates a CFN cyclic reference (compute's SG id
    // would need foundation; foundation's SG id would need compute).
    const dbSecurityGroup = new ec2.SecurityGroup(this, 'DbSecurityGroup', {
      vpc: this.vpc,
      description: 'Allow Postgres only from the App Runner VPC connector',
      allowAllOutbound: false,
    });
    this.vpcConnectorSg = new ec2.SecurityGroup(this, 'VpcConnectorSg', {
      vpc: this.vpc,
      description: 'App Runner egress SG (allowed into RDS)',
      allowAllOutbound: true,
    });
    dbSecurityGroup.addIngressRule(
      this.vpcConnectorSg,
      ec2.Port.tcp(5432),
      'Allow Postgres from App Runner VPC connector',
    );

    // Second, functionally-identical connector SG for the NAT-gateway
    // migration. AWS App Runner refuses to create a new VpcConnector
    // that reuses the exact security-group combination of one that
    // still exists ("security groups combination... already exists on
    // existing vpc connector") — even with different subnets — so the
    // old vpcConnectorSg can't be reused for the replacement connector
    // while the old one is still being deleted. Exported the same way
    // as the private-egress subnets, for the same reason (see there).
    this.vpcConnectorSg2 = new ec2.SecurityGroup(this, 'VpcConnectorSg2', {
      vpc: this.vpc,
      description: 'App Runner egress SG v2 (allowed into RDS) - see comment above',
      allowAllOutbound: true,
    });
    dbSecurityGroup.addIngressRule(
      this.vpcConnectorSg2,
      ec2.Port.tcp(5432),
      'Allow Postgres from App Runner VPC connector v2',
    );
    new cdk.CfnOutput(this, 'VpcConnectorSg2Id', {
      value: this.vpcConnectorSg2.securityGroupId,
      exportName: 'UmuFoundation-VpcConnectorSg2Id',
    });
    this.db = new rds.DatabaseInstance(this, 'Db', {
      engine: rds.DatabaseInstanceEngine.postgres({
        // 16.14 is the latest patch in eu-west-2 (CDK's VER_16_4 enum
        // is stale — 16.4 was retired by AWS). `of(...)` lets us pin
        // a specific version without depending on the enum.
        version: rds.PostgresEngineVersion.of('16.14', '16'),
      }),
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.BURSTABLE4_GRAVITON, // t4g — cheapest ARM
        ec2.InstanceSize.SMALL,
      ),
      securityGroups: [dbSecurityGroup],
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageEncrypted: true,
      multiAz: false,
      publiclyAccessible: false,
      databaseName: 'umu',
      credentials: rds.Credentials.fromGeneratedSecret('umuadmin', {
        secretName: 'umu/prod/db-credentials',
      }),
      backupRetention: cdk.Duration.days(30),
      deletionProtection: true,
      removalPolicy: RemovalPolicy.SNAPSHOT,
      cloudwatchLogsExports: ['postgresql'],
      cloudwatchLogsRetention: logs.RetentionDays.ONE_MONTH,
      monitoringInterval: cdk.Duration.seconds(60),
      enablePerformanceInsights: false,
    });

    // ─────────────────────────────────────────────────────────────
    // ECR — private repository for the backend Docker image
    // ─────────────────────────────────────────────────────────────
    this.repo = new ecr.Repository(this, 'BackendRepo', {
      repositoryName: 'umu-backend',
      imageScanOnPush: true,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [
        { description: 'Keep last 10 images, expire older', maxImageCount: 10 },
      ],
    });

    // ─────────────────────────────────────────────────────────────
    // Secrets Manager — backend env vars
    // ─────────────────────────────────────────────────────────────
    //
    // We start with a placeholder; populate via `put-secret-value`
    // after deploy. This keeps real secrets out of the CDK source
    // and out of CloudFormation events.
    this.appSecret = new secretsmanager.Secret(this, 'AppSecret', {
      secretName: 'umu/prod/app',
      description:
        'Backend env vars — JWT_SECRET, STRIPE_*, RESEND_API_KEY, PERSONA_*, ' +
        'HMLR_PFX_PASSPHRASE, GOOGLE_API_KEY, OS_API_KEY, GROQ_API_KEY, ' +
        'ADMIN_SECRET, SENTRY_DSN, CORS_ORIGINS, S3_UPLOADS_BUCKET.',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          PLACEHOLDER: 'Populate this secret via put-secret-value after deploy',
        }),
        generateStringKey: 'placeholder_filler',
      },
    });

    // ─────────────────────────────────────────────────────────────
    // Outputs
    // ─────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'EcrRepoUri', {
      value: this.repo.repositoryUri,
      description: 'docker push <this>:latest',
    });
    new cdk.CfnOutput(this, 'AppSecretArn', {
      value: this.appSecret.secretArn,
      description: 'Populate via `aws secretsmanager put-secret-value`',
    });
    new cdk.CfnOutput(this, 'DbSecretArn', {
      value: this.db.secret!.secretArn,
      description: 'RDS credential secret (auto-generated, do not edit)',
    });
    new cdk.CfnOutput(this, 'UploadsBucketName', {
      value: this.uploadsBucket.bucketName,
    });
    new cdk.CfnOutput(this, 'DbEndpoint', {
      value: this.db.dbInstanceEndpointAddress,
      description: 'RDS hostname (for pg_dump migration etc.)',
    });
  }
}

interface ComputeStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  db: rds.DatabaseInstance;
  vpcConnectorSg: ec2.SecurityGroup;
  uploadsBucket: s3.Bucket;
  repo: ecr.Repository;
  appSecret: secretsmanager.Secret;
}

/**
 * Compute stack — App Runner + VPC connector.
 *
 * Deploy this AFTER the foundation stack is up AND you've pushed an
 * initial Docker image to the ECR repo. App Runner needs the image
 * tagged `latest` to exist at provision time.
 *
 * Cost: ~£30-40/mo at launch (1 vCPU / 2 GB, scales 1–10 instances).
 */
export class UmuComputeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    // vpcConnectorSg (props) is unused now — the VpcConnector uses the
    // imported vpcConnectorSg2 below instead (see that section's comment).
    const { vpc, db, uploadsBucket, repo, appSecret } = props;

    // Instance role: what the running container can do.
    const instanceRole = new iam.Role(this, 'AppRunnerInstanceRole', {
      assumedBy: new iam.ServicePrincipal('tasks.apprunner.amazonaws.com'),
    });
    appSecret.grantRead(instanceRole);
    db.secret!.grantRead(instanceRole);
    uploadsBucket.grantReadWrite(instanceRole);

    // Push notifications via SNS Mobile Push. Scoped to only the two
    // actions PushService actually uses, and to platform-applications
    // + endpoints under this account+region only. Not a wildcard on
    // sns:* because SNS is region-global and a wildcard would let a
    // future runtime bug publish to unrelated topics.
    instanceRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: [
          'sns:CreatePlatformEndpoint',
          'sns:SetEndpointAttributes',
          'sns:DeleteEndpoint',
          'sns:Publish',
        ],
        resources: [
          `arn:aws:sns:${this.region}:${this.account}:app/APNS/*`,
          `arn:aws:sns:${this.region}:${this.account}:app/APNS_SANDBOX/*`,
          `arn:aws:sns:${this.region}:${this.account}:app/GCM/*`,
          `arn:aws:sns:${this.region}:${this.account}:endpoint/*`,
        ],
      }),
    );

    // VPC connector lets App Runner reach RDS inside the VPC — and,
    // since VPC egress carries ALL outbound traffic once enabled (not
    // just DB calls), it needs to sit in the NAT-routed subnet so
    // third-party API calls (OS Places, Resend, Stripe, etc.) actually
    // reach the internet instead of timing out. See the VPC comment in
    // the foundation stack for the full story.
    // The security group + ingress rule on RDS live in the foundation
    // stack (see comment there) to avoid a cross-stack cyclic reference.
    //
    // Imports the private-egress subnets via Foundation's explicit,
    // stably-named exports (not vpc.selectSubnets(), whose auto-export
    // only exists while some stack currently references it — unusable
    // for migrating off a different subnet without a deploy deadlock).
    const privateEgressSubnets = [1, 2].map((i) =>
      ec2.Subnet.fromSubnetId(
        this,
        `PrivateEgressSubnet${i}`,
        cdk.Fn.importValue(`UmuFoundation-PrivateEgressSubnet${i}Id`),
      ),
    );
    // vpcConnectorSg2, not vpcConnectorSg — AWS App Runner won't let a
    // new connector reuse the exact SG combination of one that still
    // exists (see the SG's definition comment in the foundation stack).
    const vpcConnectorSg2 = ec2.SecurityGroup.fromSecurityGroupId(
      this,
      'ImportedVpcConnectorSg2',
      cdk.Fn.importValue('UmuFoundation-VpcConnectorSg2Id'),
    );
    const vpcConnector = new apprunner.VpcConnector(this, 'VpcConnector', {
      vpc,
      vpcSubnets: { subnets: privateEgressSubnets },
      securityGroups: [vpcConnectorSg2],
    });

    const service = new apprunner.Service(this, 'BackendService', {
      serviceName: 'umu-backend',
      source: apprunner.Source.fromEcr({
        repository: repo,
        tagOrDigest: 'latest',
        imageConfiguration: {
          port: 3000,
          environmentVariables: {
            NODE_ENV: 'production',
            PORT: '3000',
          },
          environmentSecrets: {
            JWT_SECRET: apprunner.Secret.fromSecretsManager(appSecret, 'JWT_SECRET'),
            STRIPE_SECRET_KEY: apprunner.Secret.fromSecretsManager(appSecret, 'STRIPE_SECRET_KEY'),
            STRIPE_WEBHOOK_SECRET: apprunner.Secret.fromSecretsManager(appSecret, 'STRIPE_WEBHOOK_SECRET'),
            RESEND_API_KEY: apprunner.Secret.fromSecretsManager(appSecret, 'RESEND_API_KEY'),
            ADMIN_SECRET: apprunner.Secret.fromSecretsManager(appSecret, 'ADMIN_SECRET'),
            CORS_ORIGINS: apprunner.Secret.fromSecretsManager(appSecret, 'CORS_ORIGINS'),
            PERSONA_API_KEY: apprunner.Secret.fromSecretsManager(appSecret, 'PERSONA_API_KEY'),
            PERSONA_WEBHOOK_SECRET: apprunner.Secret.fromSecretsManager(appSecret, 'PERSONA_WEBHOOK_SECRET'),
            PERSONA_TEMPLATE_ID: apprunner.Secret.fromSecretsManager(appSecret, 'PERSONA_TEMPLATE_ID'),
            HMLR_PFX_PASSPHRASE: apprunner.Secret.fromSecretsManager(appSecret, 'HMLR_PFX_PASSPHRASE'),
            HMLR_OV_ENDPOINT: apprunner.Secret.fromSecretsManager(appSecret, 'HMLR_OV_ENDPOINT'),
            // Live mTLS cert, confirmed working against the production
            // Business Gateway (see DEPLOYMENT.md). Inline base64 PEM,
            // not HMLR_CERT_PATH — the /secrets folder is deliberately
            // excluded from the Docker image (.dockerignore), so a file
            // path would 404 inside the container. getAgent() checks
            // these _PEM_B64 vars before falling back to a PFX path.
            HMLR_CERT_PEM_B64: apprunner.Secret.fromSecretsManager(appSecret, 'HMLR_CERT_PEM_B64'),
            HMLR_KEY_PEM_B64: apprunner.Secret.fromSecretsManager(appSecret, 'HMLR_KEY_PEM_B64'),
            HMLR_CA_PEM_B64: apprunner.Secret.fromSecretsManager(appSecret, 'HMLR_CA_PEM_B64'),
            HMLR_USERNAME: apprunner.Secret.fromSecretsManager(appSecret, 'HMLR_USERNAME'),
            HMLR_PASSWORD: apprunner.Secret.fromSecretsManager(appSecret, 'HMLR_PASSWORD'),
            GOOGLE_API_KEY: apprunner.Secret.fromSecretsManager(appSecret, 'GOOGLE_API_KEY'),
            OS_API_KEY: apprunner.Secret.fromSecretsManager(appSecret, 'OS_API_KEY'),
            GROQ_API_KEY: apprunner.Secret.fromSecretsManager(appSecret, 'GROQ_API_KEY'),
            SENTRY_DSN: apprunner.Secret.fromSecretsManager(appSecret, 'SENTRY_DSN'),
            S3_UPLOADS_BUCKET: apprunner.Secret.fromSecretsManager(appSecret, 'S3_UPLOADS_BUCKET'),
            // SNS Platform Application ARNs — one per store. Empty
            // string is a valid "not configured yet" state that the
            // PushService treats as a no-op.
            AWS_SNS_APNS_PLATFORM_ARN: apprunner.Secret.fromSecretsManager(appSecret, 'AWS_SNS_APNS_PLATFORM_ARN'),
            AWS_SNS_FCM_PLATFORM_ARN: apprunner.Secret.fromSecretsManager(appSecret, 'AWS_SNS_FCM_PLATFORM_ARN'),
            // RDS credential pieces — entrypoint assembles DATABASE_URL.
            DB_HOST: apprunner.Secret.fromSecretsManager(db.secret!, 'host'),
            DB_PORT: apprunner.Secret.fromSecretsManager(db.secret!, 'port'),
            DB_NAME: apprunner.Secret.fromSecretsManager(db.secret!, 'dbname'),
            DB_USER: apprunner.Secret.fromSecretsManager(db.secret!, 'username'),
            DB_PASSWORD: apprunner.Secret.fromSecretsManager(db.secret!, 'password'),
          },
        },
      }),
      cpu: apprunner.Cpu.ONE_VCPU,
      memory: apprunner.Memory.TWO_GB,
      instanceRole,
      vpcConnector,
      autoDeploymentsEnabled: true,
      healthCheck: apprunner.HealthCheck.http({
        path: '/health/live',
        interval: cdk.Duration.seconds(10),
        timeout: cdk.Duration.seconds(5),
        healthyThreshold: 1,
        unhealthyThreshold: 3,
      }),
    });

    new cdk.CfnOutput(this, 'AppRunnerUrl', {
      value: `https://${service.serviceUrl}`,
      description: 'Public HTTPS URL — CNAME your domain at this host',
    });
    new cdk.CfnOutput(this, 'AppRunnerServiceArn', {
      value: service.serviceArn,
    });
  }
}
