import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { type FastifyRequest } from 'fastify';
import { type JwtClaims } from '../shared';
import { TokenService } from './token.service';

export interface AuthedRequest extends FastifyRequest {
  user: JwtClaims;
}

const BEARER = 'Bearer ';

/** Verifica el JWT RS256 del header Authorization y adjunta los claims al request. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly tokens: TokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith(BEARER)) {
      throw new UnauthorizedException('Falta el token Bearer');
    }
    try {
      req.user = await this.tokens.verifyAccess(header.slice(BEARER.length));
    } catch {
      throw new UnauthorizedException('Token inválido o expirado');
    }
    return true;
  }
}
