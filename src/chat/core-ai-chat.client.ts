import {
  BadGatewayException,
  GatewayTimeoutException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  coreAiAnswerResponseSchema,
  coreAiNl2SqlResponseSchema,
  type CoreAiAnswerRequest,
  type CoreAiAnswerResponse,
  type CoreAiNl2SqlRequest,
  type CoreAiNl2SqlResponse,
} from '../shared';

// LLM round-trips can be slow; allow 20s before giving up.
// Individual providers may be slower during cold-start — callers can override
// via CORE_AI_TIMEOUT_MS, same as the forecasting client.
const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * HTTP client for core-ai's chat endpoints (E09).
 *
 * Mirrors the CoreAiClient used by the forecasting module (backend.md §3).
 * core-ai NEVER touches the business DB — it only runs LLM inference.
 * The NestJS ChatService owns DB execution, SQL validation, RLS, and the
 * ApiResponse envelope.
 *
 * Base URL from CORE_AI_URL (default http://localhost:8000).
 * All responses are validated with Zod before propagating (defence at edge).
 */
@Injectable()
export class CoreAiChatClient {
  private readonly logger = new Logger(CoreAiChatClient.name);
  private readonly baseUrl = process.env.CORE_AI_URL ?? 'http://localhost:8000';
  private readonly timeoutMs = this.resolveTimeout();

  /** Translate a natural-language question into a read-only SELECT. */
  async nl2sql(request: CoreAiNl2SqlRequest): Promise<CoreAiNl2SqlResponse> {
    const response = await this.post('/chat/nl2sql', request);

    if (!response.ok) {
      const detail = await this.safeDetail(response);
      throw new BadGatewayException(
        `core-ai /chat/nl2sql respondió ${response.status}: ${detail}`,
      );
    }

    const parsed = coreAiNl2SqlResponseSchema.safeParse(
      await this.safeJson(response),
    );
    if (!parsed.success) {
      throw new BadGatewayException(
        'core-ai devolvió una respuesta nl2sql con forma inesperada',
      );
    }
    return parsed.data;
  }

  /**
   * Request a Spanish natural-language answer from a query result.
   *
   * This call is optional and non-fatal: if core-ai is slow, down, or
   * returns an error, the ChatService falls back to a generic message.
   * Returns null on any failure so the caller can degrade gracefully.
   */
  async answerFromRows(
    request: CoreAiAnswerRequest,
  ): Promise<CoreAiAnswerResponse | null> {
    try {
      const response = await this.post('/chat/answer', request);
      if (!response.ok) {
        this.logger.warn(
          `core-ai /chat/answer retornó ${response.status} — usando fallback`,
        );
        return null;
      }
      const parsed = coreAiAnswerResponseSchema.safeParse(
        await this.safeJson(response),
      );
      return parsed.success ? parsed.data : null;
    } catch (err) {
      // answer is non-fatal — log at warn level and continue without NL summary
      this.logger.warn(
        `core-ai /chat/answer falló: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
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
    const v = Number(process.env.CORE_AI_TIMEOUT_MS);
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_TIMEOUT_MS;
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
      typeof (body as Record<string, unknown>)['detail'] === 'string'
    ) {
      return (body as Record<string, string>)['detail'] ?? response.statusText;
    }
    return response.statusText;
  }
}
