import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmployeesService } from './employees.service';
import { NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

// Mock PrismaService
const mockTx = {
  employee: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
};
const mockPrisma = {
  runInTenant: vi.fn((tenantId: string, fn: (tx: typeof mockTx) => unknown) =>
    fn(mockTx),
  ),
};

// Build mock employee
const baseEmployee = {
  id: 'emp-1',
  tenantId: 'tenant-1',
  firstName: 'Juan',
  lastName: 'Perez',
  dni: '12345678',
  position: 'mozo',
  salary: {
    toString: () => '1500.00',
    toFixed: () => '1500.00',
  } as unknown as Prisma.Decimal,
  phone: null,
  hiredAt: null,
  active: true,
  userId: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  deletedAt: null,
};

describe('EmployeesService — salary field-level gating', () => {
  let service: EmployeesService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new EmployeesService(mockPrisma as never);
  });

  describe('list()', () => {
    it('owner sees salary', async () => {
      mockTx.employee.findMany.mockResolvedValue([baseEmployee]);
      const result = await service.list('tenant-1', true);
      expect(result[0].salary).toBe('1500.00');
    });

    it('manager does NOT see salary', async () => {
      mockTx.employee.findMany.mockResolvedValue([baseEmployee]);
      const result = await service.list('tenant-1', false);
      expect(result[0].salary).toBeUndefined();
    });
  });

  describe('findOne()', () => {
    it('owner sees salary on get', async () => {
      mockTx.employee.findFirst.mockResolvedValue(baseEmployee);
      const result = await service.findOne('tenant-1', 'emp-1', true);
      expect(result.salary).toBe('1500.00');
    });

    it('manager does NOT see salary on get', async () => {
      mockTx.employee.findFirst.mockResolvedValue(baseEmployee);
      const result = await service.findOne('tenant-1', 'emp-1', false);
      expect(result.salary).toBeUndefined();
    });

    it('throws NotFoundException for missing employee', async () => {
      mockTx.employee.findFirst.mockResolvedValue(null);
      await expect(
        service.findOne('tenant-1', 'missing', true),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('create()', () => {
    it('owner can set salary', async () => {
      const created = { ...baseEmployee };
      mockTx.employee.create.mockResolvedValue(created);
      const result = await service.create(
        'tenant-1',
        {
          firstName: 'Juan',
          lastName: 'Perez',
          dni: '12345678',
          position: 'mozo',
          salary: '2000.00',
        },
        true,
      );
      const callData = mockTx.employee.create.mock.calls[0][0] as {
        data: { salary: { toString: () => string } };
      };
      // Prisma.Decimal normalizes '2000.00' → '2000' on toString()
      expect(callData.data.salary.toString()).toBe('2000');
      expect(result.salary).toBe('1500.00'); // from mock response
    });

    it('manager salary input is ignored (defaults to 0)', async () => {
      const created = {
        ...baseEmployee,
        salary: {
          toString: () => '0.00',
          toFixed: () => '0.00',
        } as unknown as Prisma.Decimal,
      };
      mockTx.employee.create.mockResolvedValue(created);
      await service.create(
        'tenant-1',
        {
          firstName: 'Juan',
          lastName: 'Perez',
          dni: '12345678',
          position: 'mozo',
          salary: '9999.00',
        },
        false,
      );
      const callData = mockTx.employee.create.mock.calls[0][0] as {
        data: { salary: { toString: () => string } };
      };
      expect(callData.data.salary.toString()).toBe('0');
    });
  });

  describe('update()', () => {
    it('owner can update salary', async () => {
      mockTx.employee.findFirst.mockResolvedValue(baseEmployee);
      mockTx.employee.update.mockResolvedValue({
        ...baseEmployee,
        salary: {
          toString: () => '3000.00',
          toFixed: () => '3000.00',
        } as unknown as Prisma.Decimal,
      });
      const result = await service.update(
        'tenant-1',
        'emp-1',
        { salary: '3000.00' },
        true,
      );
      const updateCallData = mockTx.employee.update.mock.calls[0][0] as {
        data: { salary?: unknown };
      };
      expect(updateCallData.data.salary).toBeDefined();
      expect(result.salary).toBe('3000.00');
    });

    it('manager cannot update salary (salary field ignored)', async () => {
      mockTx.employee.findFirst.mockResolvedValue(baseEmployee);
      mockTx.employee.update.mockResolvedValue(baseEmployee);
      await service.update('tenant-1', 'emp-1', { salary: '9999.00' }, false);
      const updateCallData = mockTx.employee.update.mock.calls[0][0] as {
        data: { salary?: unknown };
      };
      expect(updateCallData.data.salary).toBeUndefined();
    });
  });
});
