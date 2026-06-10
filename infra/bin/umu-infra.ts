#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { UmuFoundationStack, UmuComputeStack } from '../lib/umu-stack';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'eu-west-2',
};

// Foundation: VPC, RDS, S3, ECR, Secrets. Deploy this FIRST.
const foundation = new UmuFoundationStack(app, 'UmuFoundation', {
  env,
  description: 'UMU foundation — VPC + RDS + S3 + ECR + Secrets',
});

// Compute: App Runner. Deploy AFTER you've pushed your first image to
// the ECR repo created by the foundation stack.
new UmuComputeStack(app, 'UmuCompute', {
  env,
  description: 'UMU compute — App Runner backend service',
  vpc: foundation.vpc,
  db: foundation.db,
  vpcConnectorSg: foundation.vpcConnectorSg,
  uploadsBucket: foundation.uploadsBucket,
  repo: foundation.repo,
  appSecret: foundation.appSecret,
});
