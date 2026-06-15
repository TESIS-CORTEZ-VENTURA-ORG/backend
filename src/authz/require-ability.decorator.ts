import { SetMetadata } from '@nestjs/common';
import { type AppAction, type AppSubject } from './casl-ability.factory';

export const REQUIRED_ABILITY = 'required_ability';

export interface RequiredAbility {
  action: AppAction;
  subject: AppSubject;
}

/** Declara la habilidad (acción + sujeto) que exige un handler; la valida PoliciesGuard. */
export const RequireAbility = (action: AppAction, subject: AppSubject) =>
  SetMetadata(REQUIRED_ABILITY, { action, subject } satisfies RequiredAbility);
