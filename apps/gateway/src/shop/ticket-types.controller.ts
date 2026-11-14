import { Controller, Get, Req, Res } from '@nestjs/common';
import type { CorrelatedRequest } from '@eticket/nest-common';
import { correlationIdOf } from '@eticket/nest-common';
import { DownstreamClient, relay, type RelayTarget } from '../downstream/downstream.client';

@Controller('v1/ticket-types')
export class TicketTypesController {
  constructor(private readonly downstream: DownstreamClient) {}

  @Get()
  async list(@Req() req: CorrelatedRequest, @Res() res: RelayTarget): Promise<void> {
    relay(
      res,
      await this.downstream.send('ticket', 'GET', '/v1/ticket-types', {
        correlationId: correlationIdOf(req),
      }),
    );
  }
}
