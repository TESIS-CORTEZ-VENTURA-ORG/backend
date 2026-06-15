import { SetMetadata } from '@nestjs/common';

export const AUDITED = 'audited_action';

/** Marca un handler para registrar un evento en el audit log (HU-01-09). */
export const Audited = (action: string) => SetMetadata(AUDITED, action);
