import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Audited } from '../audit/audited.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../platform/prisma/prisma.service';
import {
  changePasswordSchema,
  loginSchema,
  ok,
  refreshSchema,
  registerSchema,
  type ApiResponse,
  type AuthTokens,
  type ChangePasswordInput,
  type JwtClaims,
  type LoginInput,
  type RefreshInput,
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

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body(new ZodValidationPipe(refreshSchema)) body: RefreshInput,
  ): Promise<ApiResponse<AuthTokens>> {
    return ok(await this.auth.refresh(body.refreshToken));
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Body(new ZodValidationPipe(refreshSchema)) body: RefreshInput,
  ): Promise<ApiResponse<{ revoked: true }>> {
    await this.auth.logout(body.refreshToken);
    return ok({ revoked: true });
  }

  @Patch('password')
  @UseGuards(JwtAuthGuard)
  @Audited('password.change')
  async changePassword(
    @CurrentUser() claims: JwtClaims,
    @Body(new ZodValidationPipe(changePasswordSchema))
    body: ChangePasswordInput,
  ): Promise<ApiResponse<{ changed: true }>> {
    await this.auth.changePassword(claims.sub, claims.tenant_id, body);
    return ok({ changed: true });
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() claims: JwtClaims): Promise<ApiResponse<MeView>> {
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
