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

  // app.enableCors({
  //   origin: [
  //     'http://localhost:3000',
  //     'http://localhost:3002',
  //     'https://demo-umu-frontend.vercel.app',
  //     'https://demo-umu-frontend-dly7s9uz1-devmysticcodes-projects.vercel.app',
  //     'http://localhost',
  //     'https://localhost',
  //     'capacitor://localhost',
  //   ],
  //   methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  //   credentials: true,
  // });

  app.enableCors({
    origin: true,
    credentials: true,
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
