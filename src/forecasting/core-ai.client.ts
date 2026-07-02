import {
  BadGatewayException,
  GatewayTimeoutException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  coreAiForecastResponseSchema,
  type CoreAiForecastResponse,
} from '../shared';
import { type HistoryPoint } from './sales-aggregation.util';

// Tope de espera por la respuesta de core-ai. Sin esto, un core-ai colgado deja
// la request de NestJS colgada indefinidamente (agotando recursos).
const DEFAULT_TIMEOUT_MS = 15_000;

/** Coordenadas para el clima (Open-Meteo) del forecast contextual (HU-08-07). */
export interface CoreAiLocation {
  latitude: number;
  longitude: number;
}

/**
 * Body que espera `core-ai` en `POST /forecast/run` (snake_case, contrato Python).
 * `use_context`/`location` son opcionales y retrocompatibles (HU-08-07): omitirlos
 * reproduce el comportamiento previo (`drivers: []`, `context_status: "off"`, sin
 * llamadas de red). `location` ausente → core-ai usa su default (Lima).
 */
export interface CoreAiForecastRequest {
  series_id: string;
  frequency: 'D';
  horizon: number;
  history: HistoryPoint[];
  engine?: string;
  use_context?: boolean;
  location?: CoreAiLocation;
}

/**
 * Cliente HTTP del microservicio de inferencia `core-ai` (FastAPI). NestJS
 * orquesta; core-ai infiere (`backend.md` §3). Síncrono por ahora: el wrap en
 * BullMQ (`ForecastRun` RUNNING/COMPLETED + SSE) es el siguiente incremento.
 *
 * La URL se toma de `CORE_AI_URL` (default `http://localhost:8000`, igual patrón
 * de env directo que `auth-db.client`). La respuesta se valida con Zod antes de
 * propagarse (defensa de borde: nunca confiar en la forma del upstream).
 */
@Injectable()
export class CoreAiClient {
  private readonly baseUrl = process.env.CORE_AI_URL ?? 'http://localhost:8000';
  private readonly timeoutMs = this.resolveTimeout();

  async runForecast(
    request: CoreAiForecastRequest,
  ): Promise<CoreAiForecastResponse> {
    const response = await this.post('/forecast/run', request);

    if (!response.ok) {
      const detail = await this.safeDetail(response);
      throw new BadGatewayException(
        `core-ai respondió ${response.status}: ${detail}`,
      );
    }

    const parsed = coreAiForecastResponseSchema.safeParse(
      await this.safeJson(response),
    );
    if (!parsed.success) {
      throw new BadGatewayException(
        'core-ai devolvió una respuesta con forma inesperada',
      );
    }
    return parsed.data;
  }

  private async post(path: string, body: unknown): Promise<Response> {
    try {
      return await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      if (
        cause instanceof Error &&
        (cause.name === 'TimeoutError' || cause.name === 'AbortError')
      ) {
        throw new GatewayTimeoutException(
          `core-ai no respondió en ${this.timeoutMs}ms`,
        );
      }
      throw new ServiceUnavailableException(
        `No se pudo contactar a core-ai en ${this.baseUrl}`,
        { cause: cause instanceof Error ? cause : undefined },
      );
    }
  }

  private resolveTimeout(): number {
    const value = Number(process.env.CORE_AI_TIMEOUT_MS);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
  }

  private async safeJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  private async safeDetail(response: Response): Promise<string> {
    const body = await this.safeJson(response);
    if (
      body !== null &&
      typeof body === 'object' &&
      'detail' in body &&
      typeof (body as { detail: unknown }).detail === 'string'
    ) {
      return (body as { detail: string }).detail;
    }
    return response.statusText;
  }
}
