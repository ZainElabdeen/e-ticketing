import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Internal } from '../common/http/api-key.guard';
import { ConfirmOrderDto } from './dto/confirm-order.dto';
import type { OrderView } from './order.view';
import { OrdersService } from './orders.service';

@Internal()
@Controller('v1/internal/orders')
export class InternalOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post(':orderId/confirm')
  @HttpCode(200)
  confirm(
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Body() dto: ConfirmOrderDto,
  ): Promise<OrderView> {
    return this.orders.confirmOrder(orderId, dto.transactionId);
  }
}
