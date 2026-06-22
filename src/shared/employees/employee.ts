import { z } from 'zod';

export const EMPLOYEE_POSITIONS = ['mozo', 'cocina', 'caja', 'otro'] as const;
export const positionSchema = z.enum(EMPLOYEE_POSITIONS);
export type EmployeePosition = z.infer<typeof positionSchema>;

export const createEmployeeSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  dni: z.string().min(1),
  position: positionSchema,
  salary: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, 'salary must be a decimal string'),
  phone: z.string().optional(),
  hiredAt: z.string().datetime({ offset: true }).optional().nullable(),
  active: z.boolean().optional(),
  userId: z.string().uuid().optional().nullable(),
});
export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;

export const updateEmployeeSchema = createEmployeeSchema.partial();
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;
