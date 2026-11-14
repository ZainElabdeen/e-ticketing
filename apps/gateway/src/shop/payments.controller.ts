import { Body, Controller, Get, Headers, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import type { CorrelatedRequest } from '@eticket/nest-common';
import { correlationIdOf } from '@eticket/nest-common';
import { DownstreamClient, relay, type RelayTarget } from '../downstream/downstream.client';

@Controller('v1/payments')
export class PaymentsController {
  constructor(private readonly downstream: DownstreamClient) {}

  @Post()
  async create(
    @Req() req: CorrelatedRequest,
    @Res() res: RelayTarget,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<void> {
    relay(
      res,
      await this.downstream.send('payment', 'POST', '/v1/payments', {
        correlationId: correlationIdOf(req),
        body,
        idempotencyKey,
      }),
    );
  }

  @Get(':paymentId')
  async get(
    @Req() req: CorrelatedRequest,
    @Res() res: RelayTarget,
    @Param('paymentId') paymentId: string,
  ): Promise<void> {
    relay(
      res,
      await this.downstream.send(
        'payment',
        'GET',
        `/v1/payments/${encodeURIComponent(paymentId)}`,
        { correlationId: correlationIdOf(req) },
      ),
    );
  }

  @Post(':paymentId/cancel')
  @HttpCode(200)
  async cancel(
    @Req() req: CorrelatedRequest,
    @Res() res: RelayTarget,
    @Param('paymentId') paymentId: string,
  ): Promise<void> {
    relay(
      res,
      await this.downstream.send(
        'payment',
        'POST',
        `/v1/payments/${encodeURIComponent(paymentId)}/cancel`,
        { correlationId: correlationIdOf(req) },
      ),
    );
  }
}
