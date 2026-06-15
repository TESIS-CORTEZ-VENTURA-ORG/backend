import { Controller, Get } from '@nestjs/common';
import { ok, type ApiResponse } from '../../shared';

/** Estado de liveness del servicio (no toca DB; readiness llega con E01). */
export interface HealthStatus {
  status: 'ok';
  uptime: number;
  timestamp: string;
}

@Controller('health')
export class HealthController {
  @Get()
  check(): ApiResponse<HealthStatus> {
    return ok({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  }
}
