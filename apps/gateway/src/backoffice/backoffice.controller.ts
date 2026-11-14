import { Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { CorrelatedRequest } from '@eticket/nest-common';
import { correlationIdOf } from '@eticket/nest-common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DownstreamClient, relay, type RelayTarget } from '../downstream/downstream.client';

/** Forwards only `page` and `pageSize`, as the raw strings; the service validates them. */
function pageQuery(page: unknown, pageSize: unknown): Record<string, string> {
  const query: Record<string, string> = {};
  if (typeof page === 'string') {
    query['page'] = page;
  }
  if (typeof pageSize === 'string') {
    query['pageSize'] = pageSize;
  }
  return query;
}

@Controller('v1/backoffice')
@UseGuards(JwtAuthGuard)
export class BackofficeController {
  constructor(private readonly downstream: DownstreamClient) {}

  @Get('transactions')
  async transactions(
    @Req() req: CorrelatedRequest,
    @Res() res: RelayTarget,
    @Query('page') page?: unknown,
    @Query('pageSize') pageSize?: unknown,
  ): Promise<void> {
    relay(
      res,
      await this.downstream.send('payment', 'GET', '/v1/transactions', {
        correlationId: correlationIdOf(req),
        query: pageQuery(page, pageSize),
      }),
    );
  }

  @Get('ledger-entries')
  async ledgerEntries(
    @Req() req: CorrelatedRequest,
    @Res() res: RelayTarget,
    @Query('page') page?: unknown,
    @Query('pageSize') pageSize?: unknown,
  ): Promise<void> {
    relay(
      res,
      await this.downstream.send('ledger', 'GET', '/v1/journal-entries', {
        correlationId: correlationIdOf(req),
        query: pageQuery(page, pageSize),
      }),
    );
  }

  @Get('accounts')
  async accounts(@Req() req: CorrelatedRequest, @Res() res: RelayTarget): Promise<void> {
    relay(
      res,
      await this.downstream.send('ledger', 'GET', '/v1/accounts', {
        correlationId: correlationIdOf(req),
      }),
    );
  }

  @Get('ticket-availability')
  async ticketAvailability(@Req() req: CorrelatedRequest, @Res() res: RelayTarget): Promise<void> {
    relay(
      res,
      await this.downstream.send('ticket', 'GET', '/v1/ticket-types', {
        correlationId: correlationIdOf(req),
      }),
    );
  }
}
