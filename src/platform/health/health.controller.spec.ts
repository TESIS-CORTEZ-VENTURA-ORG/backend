import { HealthController } from './health.controller';

describe('HealthController (R6)', () => {
  it('devuelve un envelope ApiResponse con status ok', () => {
    const controller = new HealthController();
    const res = controller.check();

    expect(res.success).toBe(true);
    expect(res.data.status).toBe('ok');
    expect(typeof res.data.uptime).toBe('number');
    expect(typeof res.data.timestamp).toBe('string');
  });
});
