import { BadRequestException, type PipeTransform } from '@nestjs/common';
import { ZodError, type ZodType } from 'zod';

/** Valida y transforma el payload con un schema Zod compartido (contrato §6). */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    try {
      return this.schema.parse(value);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new BadRequestException(
          error.issues.map((issue) => issue.message),
        );
      }
      throw error;
    }
  }
}
