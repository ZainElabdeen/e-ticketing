import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import type { OrderView } from './order.view';
import { OrdersService } from './orders.service';

@Controller('v1/orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @HttpCode(201)
  create(@Body() dto: CreateOrderDto): Promise<OrderView> {
    return this.orders.createOrder(dto.items);
  }

  @Get(':orderId')
  get(@Param('orderId', new ParseUUIDPipe()) orderId: string): Promise<OrderView> {
    return this.orders.getOrder(orderId);
  }
}
