import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PlatformModule } from '../platform/platform.module';
import { AuthController } from './auth.controller';
import { AuthDbClient } from './auth-db.client';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

/** Lee una clave PEM en base64 desde el entorno (generadas con `bun run keys:gen`). */
function readKey(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} no está definido — corre: bun run keys:gen`);
  }
  return Buffer.from(value, 'base64').toString('utf8');
}

@Module({
  imports: [
    PlatformModule, // PrismaService (runInTenant)
    JwtModule.register({
      privateKey: readKey('JWT_PRIVATE_KEY'),
      publicKey: readKey('JWT_PUBLIC_KEY'),
      signOptions: { algorithm: 'RS256', issuer: 'gastronomia' },
      verifyOptions: { algorithms: ['RS256'], issuer: 'gastronomia' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthDbClient, PasswordService, TokenService],
  exports: [TokenService], // para que JwtAuthGuard resuelva en otros módulos
})
export class AuthModule {}
