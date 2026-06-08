import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Liveness + readiness probes for Railway / future orchestrators.
 *
 * - GET /health → composite check (process up + DB reachable). 200 if
 *   all green, 503 if any indicator fails. This is what an uptime
 *   monitor or load-balancer health probe should hit.
 *
 * - GET /health/live → cheap "is the process responding" only. Returns
 *   200 immediately. Use this when you want to distinguish "process is
 *   alive but DB is down" from "process is dead" — Kubernetes-style
 *   livenessProbe vs readinessProbe.
 *
 * SkipThrottle so the throttler default (60/min) doesn't trip when a
 * monitor polls every 10s. No auth needed — the endpoint returns no
 * sensitive information.
 */
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private prisma: PrismaService,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([() => this.pingDatabase()]);
  }

  @Get('live')
  live() {
    return { status: 'ok', uptime: process.uptime() };
  }

  // Custom indicator — PrismaService wraps PrismaClient rather than
  // extending it, so terminus's built-in PrismaHealthIndicator (which
  // expects a PrismaClient instance) can't be used directly. A
  // bounded `user.count()` is the cheapest "is the DB reachable"
  // signal we have.
  private async pingDatabase(): Promise<HealthIndicatorResult> {
    const key = 'database';
    const start = Date.now();
    try {
      await Promise.race([
        this.prisma.user.count(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 5_000),
        ),
      ]);
      return { [key]: { status: 'up', responseTimeMs: Date.now() - start } };
    } catch (err: any) {
      return {
        [key]: {
          status: 'down',
          responseTimeMs: Date.now() - start,
          message: err?.message ?? 'unknown',
        },
      };
    }
  }
}
