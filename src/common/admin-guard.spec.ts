import { ForbiddenException } from '@nestjs/common';
import { isIpAllowed, assertAdminAccess } from './admin-guard';

describe('isIpAllowed', () => {
  it('matches an exact IP', () => {
    expect(isIpAllowed('203.0.113.5', '203.0.113.5')).toBe(true);
    expect(isIpAllowed('203.0.113.6', '203.0.113.5')).toBe(false);
  });

  it('matches a CIDR range', () => {
    expect(isIpAllowed('10.0.0.42', '10.0.0.0/24')).toBe(true);
    expect(isIpAllowed('10.0.1.42', '10.0.0.0/24')).toBe(false);
  });

  it('matches against a comma-separated list of mixed entries', () => {
    const allowlist = '203.0.113.5, 10.0.0.0/24,  198.51.100.9';
    expect(isIpAllowed('10.0.0.1', allowlist)).toBe(true);
    expect(isIpAllowed('198.51.100.9', allowlist)).toBe(true);
    expect(isIpAllowed('192.0.2.1', allowlist)).toBe(false);
  });

  it('strips the IPv4-mapped IPv6 prefix some proxies add', () => {
    expect(isIpAllowed('::ffff:203.0.113.5', '203.0.113.5')).toBe(true);
  });

  it('rejects malformed CIDR/IP entries instead of throwing', () => {
    expect(isIpAllowed('10.0.0.1', 'not-an-ip, 10.0.0.0/999, /24')).toBe(false);
  });

  it('rejects when ip is missing', () => {
    expect(isIpAllowed(undefined, '10.0.0.0/8')).toBe(false);
  });
});

describe('assertAdminAccess', () => {
  const logger = { warn: jest.fn() };

  beforeEach(() => {
    logger.warn.mockClear();
    delete process.env.ADMIN_IP_ALLOWLIST;
    process.env.ADMIN_SECRET = 'a-real-admin-secret-value';
  });

  it('allows a correct secret when no IP allowlist is configured', () => {
    expect(() =>
      assertAdminAccess({ secret: 'a-real-admin-secret-value', ip: '1.2.3.4', route: 'r', logger }),
    ).not.toThrow();
  });

  it('rejects a wrong secret', () => {
    expect(() =>
      assertAdminAccess({ secret: 'wrong', ip: '1.2.3.4', route: 'r', logger }),
    ).toThrow(ForbiddenException);
  });

  it('REJECTS a request from outside the allowlist even with the correct secret - finding #8 regression guard', () => {
    process.env.ADMIN_IP_ALLOWLIST = '10.0.0.0/24';
    expect(() =>
      assertAdminAccess({ secret: 'a-real-admin-secret-value', ip: '203.0.113.5', route: 'r', logger }),
    ).toThrow(ForbiddenException);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('DENIED (ip not allowlisted)'));
  });

  it('allows a request from inside the allowlist with the correct secret', () => {
    process.env.ADMIN_IP_ALLOWLIST = '10.0.0.0/24';
    expect(() =>
      assertAdminAccess({ secret: 'a-real-admin-secret-value', ip: '10.0.0.42', route: 'r', logger }),
    ).not.toThrow();
  });

  it('still rejects an allowlisted IP with the wrong secret', () => {
    process.env.ADMIN_IP_ALLOWLIST = '10.0.0.0/24';
    expect(() =>
      assertAdminAccess({ secret: 'wrong', ip: '10.0.0.42', route: 'r', logger }),
    ).toThrow(ForbiddenException);
  });
});
