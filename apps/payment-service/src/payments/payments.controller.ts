import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { correlationIdOf, type CorrelatedRequest, type HeaderSetter } from '@eticket/nest-common';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { IdempotencyKeyHeader, IdempotencyKeyPipe } from './idempotency-key.pipe';
import type { PaymentView } from './payment.view';
import { PaymentsService } from './payments.service';

@Controller('v1/payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  @HttpCode(201)
  async create(
    @Body() dto: CreatePaymentDto,
    @IdempotencyKeyHeader(IdempotencyKeyPipe) key: string,
    @Req() req: CorrelatedRequest,
    @Res({ passthrough: true }) res: HeaderSetter,
  ): Promise<PaymentView> {
    const { view, replayed } = await this.payments.create(dto, key, correlationIdOf(req));
    if (replayed) res.setHeader('Idempotent-Replayed', 'true');
    return view;
  }

  @Get(':paymentId')
  get(@Param('paymentId', ParseUUIDPipe) paymentId: string): Promise<PaymentView> {
    return this.payments.get(paymentId);
  }
}
