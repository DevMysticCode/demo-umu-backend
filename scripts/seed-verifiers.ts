/**
 * One-shot seed for OPDA verifier orgs (Sprint 1 demo).
 *
 * Registers three sample organisations + a default client for each one.
 * Prints the plaintext client secrets ONCE — copy them somewhere safe; they
 * cannot be retrieved afterwards.
 *
 * Run from umu-backend:
 *   npx ts-node scripts/seed-verifiers.ts
 *
 * Idempotent on name — if an org with the same name exists, it is reused
 * and a new client is appended.
 */

import { PrismaClient } from '@prisma/client';
import { randomBytes, scrypt as scryptCb } from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(scryptCb) as (
  pwd: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const buf = await scrypt(secret, salt, 64);
  return `${salt}:${buf.toString('hex')}`;
}

async function mintClient() {
  const clientId = `umu_${randomBytes(8).toString('hex')}`;
  const secret = `sk_${randomBytes(24).toString('base64url')}`;
  const hash = await hashSecret(secret);
  return { clientId, secret, hash };
}

const ALL_SCOPES = [
  'identity',
  'proof_of_deposit',
  'source_of_funds',
  'affordability',
  'credit_file',
  'purchase_profile',
  'story',
];

const DEMO_ORGS = [
  {
    name: 'Lloyds Bank',
    legalName: 'Lloyds Banking Group plc',
    logoEmoji: '🏦',
    description: 'Mortgage division · FCA authorised',
    fcaNumber: '119278',
    contactEmail: 'mortgages@lloydsbank.com',
    websiteUrl: 'https://www.lloydsbank.com',
    allowedScopes: ALL_SCOPES, // bank can ask for everything
  },
  {
    name: 'Fletcher & Hart Solicitors',
    legalName: 'Fletcher & Hart LLP',
    logoEmoji: '🏛️',
    description: 'Conveyancing · Law Society regulated',
    fcaNumber: null,
    contactEmail: 'admin@fletcherhart.example',
    websiteUrl: null,
    allowedScopes: [
      'identity',
      'proof_of_deposit',
      'source_of_funds',
      'purchase_profile',
    ],
  },
  {
    name: 'Foxtons',
    legalName: 'Foxtons Group plc',
    logoEmoji: '🏠',
    description: 'Estate agency · vetted buyer verification',
    fcaNumber: null,
    contactEmail: 'verify@foxtons.example',
    websiteUrl: 'https://www.foxtons.co.uk',
    allowedScopes: ['identity', 'proof_of_deposit', 'purchase_profile', 'story'],
  },
];

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log('Seeding verifier orgs…\n');
    for (const def of DEMO_ORGS) {
      // Find-or-create — match by name (no unique constraint, so use findFirst)
      let org = await prisma.verifierOrg.findFirst({
        where: { name: def.name },
      });
      if (!org) {
        org = await prisma.verifierOrg.create({
          data: {
            name: def.name,
            legalName: def.legalName,
            logoEmoji: def.logoEmoji,
            description: def.description,
            fcaNumber: def.fcaNumber,
            contactEmail: def.contactEmail,
            websiteUrl: def.websiteUrl,
          },
        });
        console.log(`✓ Created org: ${def.name}`);
      } else {
        console.log(`• Reusing existing org: ${def.name}`);
      }

      const { clientId, secret, hash } = await mintClient();
      await prisma.verifierClient.create({
        data: {
          orgId: org.id,
          clientId,
          clientSecretHash: hash,
          allowedScopes: def.allowedScopes,
        },
      });
      console.log(`  clientId:     ${clientId}`);
      console.log(`  clientSecret: ${secret}`);
      console.log('');
    }
    console.log('Done.\n');
    console.log('To create a test access request against your own buyer profile:');
    console.log('');
    console.log(`  curl -X POST http://localhost:3002/api/v1/access-requests \\`);
    console.log(`    -H "Content-Type: application/json" \\`);
    console.log(`    -H "X-Client-Id: <clientId from above>" \\`);
    console.log(`    -H "X-Client-Secret: <clientSecret from above>" \\`);
    console.log(`    -d '{"scopes":["identity","proof_of_deposit","source_of_funds","affordability","credit_file"],"buyerEmail":"you@example.com","reason":"Mortgage application"}'`);
    console.log('');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
