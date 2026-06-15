import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { type JwtClaims } from '../shared';
import { type AuthedRequest } from './jwt-auth.guard';

/** Expone los claims del JWT (validados por JwtAuthGuard) en el handler. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): JwtClaims => {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    return req.user;
  },
);
