import { Injectable } from '@nestjs/common';
import { compare, hash } from 'bcryptjs';

const SALT_ROUNDS = 12;

/** Hash de contraseñas con bcrypt. Argon2id/Better-Auth = hardening en HU-E01-03. */
@Injectable()
export class PasswordService {
  hash(plain: string): Promise<string> {
    return hash(plain, SALT_ROUNDS);
  }

  verify(plain: string, hashed: string): Promise<boolean> {
    return compare(plain, hashed);
  }
}
