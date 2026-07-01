import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../platform/prisma/prisma.service';
import { type ChatQueryResponse, type CoreAiAnswerRequest } from '../shared';
import { CoreAiChatClient } from './core-ai-chat.client';
import { ANALYTICS_SCHEMA_CONTEXT } from './schema-context';
import { validateSql, MAX_ROWS } from './sql-validator.util';

/**
 * Raw row returned by Prisma $queryRawUnsafe. Column values can be
 * primitives, Dates, Prisma Decimal objects, or BigInts depending on the
 * PostgreSQL column type. We serialise everything to JSON-safe values before
 * returning to the HTTP layer.
 */
type RawRow = Record<string, unknown>;

/**
 * E09 · ChatService — orchestration layer for the Text-to-SQL chat feature.
 *
 * Security invariants (backend.md §8.2):
 *  1. tenant_id comes ONLY from the JWT claim (passed via `tenantId` param).
 *  2. Every DB query runs inside runInTenant() so RLS FORCE is active.
 *  3. The SQL validation hard gate (validateSql) MUST pass before any query
 *     reaches $queryRawUnsafe.
 *  4. statement_timeout prevents denial-of-service via expensive queries.
 *  5. core-ai never touches the business DB — it only generates the SQL.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly coreAiChat: CoreAiChatClient,
  ) {}

  /**
   * Execute a natural-language analytics query for the given tenant.
   *
   * Flow:
   *  1. Call core-ai to translate the question into a SQL SELECT.
   *  2. Run the SQL through the 9-rule validation hard gate.
   *  3. Execute under runInTenant (RLS + statement_timeout).
   *  4. Optionally call core-ai for a Spanish NL answer (non-fatal).
   *  5. Return the full response in ApiResponse shape.
   *
   * @param tenantId  UUID from the JWT claim — never from request body.
   * @param question  Natural-language question from the user.
   */
  async query(tenantId: string, question: string): Promise<ChatQueryResponse> {
    // --- Step 1: LLM generates SQL ---
    const nl2sqlResp = await this.coreAiChat.nl2sql({
      question,
      schema_context: ANALYTICS_SCHEMA_CONTEXT,
      dialect: 'postgresql',
      max_rows: MAX_ROWS,
    });

    // --- Step 2: Hard validation gate ---
    const validation = validateSql(nl2sqlResp.sql);
    if (!validation.ok) {
      this.logger.warn(
        `Chat SQL rejected (rule ${validation.error.rule}): ${validation.error.reason}`,
        { tenantId, question, rawSql: nl2sqlResp.sql },
      );
      throw new BadRequestException(
        `No pude generar una consulta segura para eso: ${validation.error.reason}`,
      );
    }

    const validSql = validation.value.sql;
    let columns: string[] = [];
    let rows: unknown[][] = [];

    // --- Step 3: Execute under RLS FORCE + statement_timeout ---
    await this.prisma.runInTenant(tenantId, async (tx) => {
      // defence-in-depth: 5-second hard timeout prevents infinite/expensive queries
      // even if the validator passed a technically-valid but slow query.
      await tx.$executeRaw`SET LOCAL statement_timeout = '5000'`;

      const raw = await tx.$queryRawUnsafe<RawRow[]>(validSql);

      if (raw.length > 0 && raw[0] != null) {
        columns = Object.keys(raw[0]);
        rows = raw.map((r) => Object.values(r).map(toJsonSafe));
      }
    });

    // --- Step 4: Optional NL answer from core-ai (graceful degradation) ---
    let answer: string;
    const answerReq: CoreAiAnswerRequest = {
      question,
      columns,
      rows,
      provider: nl2sqlResp.provider,
    };
    const answerResp = await this.coreAiChat.answerFromRows(answerReq);
    if (answerResp) {
      answer = answerResp.answer;
    } else {
      answer = this.defaultAnswer(rows.length);
    }

    return {
      answer,
      sql: validSql,
      columns,
      rows,
      provider: nl2sqlResp.provider,
      model: nl2sqlResp.model,
    };
  }

  private defaultAnswer(rowCount: number): string {
    return rowCount === 0
      ? 'No se encontraron datos para esa consulta.'
      : `Se encontraron ${rowCount} registro(s).`;
  }
}

/**
 * Convert a Prisma raw-query value to a JSON-serialisable primitive.
 *
 * Prisma maps PostgreSQL types as follows:
 *   - DECIMAL / NUMERIC → Prisma.Decimal (has .toNumber())
 *   - BIGINT            → BigInt (not JSON-serialisable)
 *   - TIMESTAMPTZ       → Date
 *   - UUID / TEXT       → string
 *   - INT / FLOAT       → number
 *
 * We flatten to primitives so Fastify can serialise the response without
 * a custom JSON replacer. Note: no `any` — we stay within `unknown` and
 * use type narrowing to reach known interfaces.
 */
function toJsonSafe(value: unknown): unknown {
  if (value === null || value === undefined) return null;

  if (typeof value === 'bigint') return Number(value);

  if (value instanceof Date) return value.toISOString();

  // Prisma.Decimal exposes a toNumber() method. We detect by duck-typing
  // rather than instanceof to avoid importing the Prisma namespace here.
  if (
    typeof value === 'object' &&
    typeof (value as Record<string, unknown>)['toNumber'] === 'function'
  ) {
    return (value as { toNumber(): number }).toNumber();
  }

  return value;
}
