import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type JwtClaims } from '../shared';
import { CaslAbilityFactory } from './casl-ability.factory';
import {
  REQUIRED_ABILITY,
  type RequiredAbility,
} from './require-ability.decorator';

/**
 * Verifica la matriz de permisos CASL del rol contra la habilidad requerida por
 * el handler (@RequireAbility). Debe ir DESPUÉS de JwtAuthGuard (que pobla req.user).
 */
@Injectable()
export class PoliciesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly abilityFactory: CaslAbilityFactory,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<
      RequiredAbility | undefined
    >(REQUIRED_ABILITY, [context.getHandler(), context.getClass()]);
    if (!required) {
      return true;
    }
    const { user } = context.switchToHttp().getRequest<{ user: JwtClaims }>();
    const ability = this.abilityFactory.createForRoles(user.roles);
    if (!ability.can(required.action, required.subject)) {
      throw new ForbiddenException('No tienes permiso para esta acción');
    }
    return true;
  }
}
