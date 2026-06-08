import { ArgumentsHost, BadRequestException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AllExceptionsFilter } from './all-exceptions.filter';

function makeHost(): { host: ArgumentsHost; status: jest.Mock; json: jest.Mock } {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ method: 'GET', url: '/x' }),
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    // Silence the logger so test output stays clean — we still rely on
    // the .json mock to assert response shape.
    jest.spyOn((filter as any).logger, 'warn').mockImplementation(() => {});
    jest.spyOn((filter as any).logger, 'error').mockImplementation(() => {});
  });

  it('forwards HttpException verbatim', () => {
    const { host, status, json } = makeHost();
    const exc = new BadRequestException('bad input');

    filter.catch(exc, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    // BadRequestException's getResponse returns an object body, not a string.
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'bad input',
      }),
    );
  });

  it('translates Prisma P2002 (unique constraint) to 409', () => {
    const { host, status, json } = makeHost();
    const exc = new Prisma.PrismaClientKnownRequestError('duplicate key', {
      code: 'P2002',
      clientVersion: 'test',
    });

    filter.catch(exc, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: HttpStatus.CONFLICT }),
    );
    // CRITICAL: the friendly message must NOT contain the raw Prisma
    // message (which can include table/column names — that's what we're
    // scrubbing).
    expect(json.mock.calls[0][0].message).not.toContain('duplicate key');
  });

  it('translates Prisma P2025 (not found) to 404', () => {
    const { host, status } = makeHost();
    const exc = new Prisma.PrismaClientKnownRequestError('row not found', {
      code: 'P2025',
      clientVersion: 'test',
    });

    filter.catch(exc, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
  });

  it('returns generic 500 + opaque message for unhandled errors', () => {
    const { host, status, json } = makeHost();
    const exc = new Error('something internal blew up at /etc/passwd line 42');

    filter.catch(exc, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    // The whole point of this filter — internal error detail must not
    // be returned to the client.
    expect(json.mock.calls[0][0].message).toBe('Internal server error.');
    expect(JSON.stringify(json.mock.calls[0][0])).not.toContain('/etc/passwd');
  });
});
