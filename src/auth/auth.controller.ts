import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../platform/prisma/prisma.service';
import {
  loginSchema,
  ok,
  registerSchema,
  type ApiResponse,
  type AuthTokens,
  type JwtClaims,
  type LoginInput,
  type RegisterInput,
} from '../shared';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';

interface MeView {
  id: string;
  email: string;
  name: string;
  roles: string[];
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('register')
  async register(
    @Body(new ZodValidationPipe(registerSchema)) input: RegisterInput,
  ): Promise<ApiResponse<AuthTokens>> {
    return ok(await this.auth.register(input));
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) input: LoginInput,
  ): Promise<ApiResponse<AuthTokens>> {
    return ok(await this.auth.login(input));
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() claims: JwtClaims): Promise<ApiResponse<MeView>> {
    // Cierra el lazo JWT → runInTenant → RLS: lee al usuario en su contexto de tenant.
    const user = await this.prisma.runInTenant(claims.tenant_id, (tx) =>
      tx.user.findUniqueOrThrow({ where: { id: claims.sub } }),
    );
    return ok({
      id: user.id,
      email: user.email,
      name: user.name,
      roles: user.roles,
    });
  }
}
