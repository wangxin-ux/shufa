import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns the raw service status for the global response interceptor', () => {
    const controller = new HealthController();

    expect(controller.getHealth()).toEqual({ status: 'ok' });
  });
});
