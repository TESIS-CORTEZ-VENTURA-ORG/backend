import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type Employee, Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma/prisma.service';
import { type CreateEmployeeInput, type UpdateEmployeeInput } from '../shared';

export interface EmployeeView {
  id: string;
  tenantId: string;
  firstName: string;
  lastName: string;
  dni: string;
  position: string;
  salary?: string; // only for owner
  phone: string | null;
  hiredAt: string | null;
  active: boolean;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
}

function toView(e: Employee, includesSalary: boolean): EmployeeView {
  const view: EmployeeView = {
    id: e.id,
    tenantId: e.tenantId,
    firstName: e.firstName,
    lastName: e.lastName,
    dni: e.dni,
    position: e.position,
    phone: e.phone ?? null,
    hiredAt: e.hiredAt ? e.hiredAt.toISOString() : null,
    active: e.active,
    userId: e.userId ?? null,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
  if (includesSalary) {
    view.salary = e.salary.toFixed(2);
  }
  return view;
}

@Injectable()
export class EmployeesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, isOwner: boolean): Promise<EmployeeView[]> {
    const rows = await this.prisma.runInTenant(tenantId, (tx) =>
      tx.employee.findMany({
        where: { deletedAt: null },
        orderBy: { lastName: 'asc' },
      }),
    );
    return rows.map((e) => toView(e, isOwner));
  }

  async findOne(
    tenantId: string,
    id: string,
    isOwner: boolean,
  ): Promise<EmployeeView> {
    const row = await this.findRow(tenantId, id);
    return toView(row, isOwner);
  }

  async create(
    tenantId: string,
    dto: CreateEmployeeInput,
    isOwner: boolean,
  ): Promise<EmployeeView> {
    const salary =
      isOwner && dto.salary != null
        ? new Prisma.Decimal(dto.salary)
        : new Prisma.Decimal('0');

    try {
      const row = await this.prisma.runInTenant(tenantId, (tx) =>
        tx.employee.create({
          data: {
            tenantId,
            firstName: dto.firstName,
            lastName: dto.lastName,
            dni: dto.dni,
            position: dto.position,
            salary,
            phone: dto.phone ?? null,
            hiredAt: dto.hiredAt ? new Date(dto.hiredAt) : null,
            active: dto.active ?? true,
            userId: dto.userId ?? null,
          },
        }),
      );
      return toView(row, isOwner);
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException(
          'Ya existe un empleado con ese DNI en este tenant',
        );
      }
      throw e;
    }
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateEmployeeInput,
    isOwner: boolean,
  ): Promise<EmployeeView> {
    await this.findRow(tenantId, id);

    const data: Prisma.EmployeeUncheckedUpdateInput = {};
    if (dto.firstName != null) data.firstName = dto.firstName;
    if (dto.lastName != null) data.lastName = dto.lastName;
    if (dto.dni != null) data.dni = dto.dni;
    if (dto.position != null) data.position = dto.position;
    if (dto.phone !== undefined) data.phone = dto.phone ?? null;
    if (dto.hiredAt !== undefined)
      data.hiredAt = dto.hiredAt ? new Date(dto.hiredAt) : null;
    if (dto.active != null) data.active = dto.active;
    if (dto.userId !== undefined) data.userId = dto.userId ?? null;
    if (isOwner && dto.salary != null) {
      data.salary = new Prisma.Decimal(dto.salary);
    }

    try {
      const row = await this.prisma.runInTenant(tenantId, (tx) =>
        tx.employee.update({ where: { id }, data }),
      );
      return toView(row, isOwner);
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException(
          'Ya existe un empleado con ese DNI en este tenant',
        );
      }
      throw e;
    }
  }

  async remove(tenantId: string, id: string): Promise<void> {
    await this.findRow(tenantId, id);
    await this.prisma.runInTenant(tenantId, (tx) =>
      tx.employee.update({
        where: { id },
        data: { deletedAt: new Date() },
      }),
    );
  }

  private async findRow(tenantId: string, id: string): Promise<Employee> {
    const row = await this.prisma.runInTenant(tenantId, (tx) =>
      tx.employee.findFirst({ where: { id, deletedAt: null } }),
    );
    if (!row) throw new NotFoundException('Empleado no encontrado');
    return row;
  }
}
