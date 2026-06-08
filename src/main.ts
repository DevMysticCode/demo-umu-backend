import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody: true tells Nest's body-parser to keep the raw bytes on
  // req.rawBody as well as the parsed body. The Persona webhook handler
  // needs the raw bytes to compute its HMAC signature.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });

  // Serve uploaded files statically at /uploads/*
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads' });

  // CORS allow-list driven by env. Comma-separated origins (full
  // scheme+host, no trailing slash). Falls back to a sensible default
  // covering local dev and the Capacitor mobile shells when the env
  // var is unset — never permits the audit-flagged `origin: true,
  // credentials: true` combo, which would let any site read responses
  // from authenticated browsers.
  //
  // Set CORS_ORIGINS on Railway to your real production hosts:
  //   CORS_ORIGINS=https://app.umovingu.com,https://www.umovingu.com,capacitor://localhost
  const defaultOrigins = [
    'http://localhost:3000',
    'http://localhost:3002',
    'https://demo-umu-frontend.vercel.app',
    'capacitor://localhost', // iOS Capacitor webview
    'ionic://localhost',     // legacy Capacitor scheme on Android
    'http://localhost',
    'https://localhost',
  ];
  const corsOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const allowList = corsOrigins.length ? corsOrigins : defaultOrigins;

  app.enableCors({
    origin: allowList,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
