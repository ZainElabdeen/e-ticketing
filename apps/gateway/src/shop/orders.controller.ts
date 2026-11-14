import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import type { CorrelatedRequest } from '@eticket/nest-common';
import { correlationIdOf } from '@eticket/nest-common';
import { pathSegment } from './path-segment';
import { DownstreamClient, relay, type RelayTarget } from '../downstream/downstream.client';

@Controller('v1/orders')
export class OrdersController {
  constructor(private readonly downstream: DownstreamClient) {}

  @Post()
  async create(
    @Req() req: CorrelatedRequest,
    @Res() res: RelayTarget,
    @Body() body: unknown,
  ): Promise<void> {
    relay(
      res,
      await this.downstream.send('ticket', 'POST', '/v1/orders', {
        correlationId: correlationIdOf(req),
        body,
      }),
    );
  }

  @Get(':orderId')
  async get(
    @Req() req: CorrelatedRequest,
    @Res() res: RelayTarget,
    @Param('orderId') orderId: string,
  ): Promise<void> {
    relay(
      res,
      await this.downstream.send('ticket', 'GET', `/v1/orders/${pathSegment(orderId)}`, {
        correlationId: correlationIdOf(req),
      }),
    );
  }
}
