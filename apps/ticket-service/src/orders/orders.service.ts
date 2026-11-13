import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/env';
import { OrderNotFoundError } from './domain/errors';
import type { OrderLineRequest } from './domain/order';
import type { OrderView } from './order.view';
import { OrdersRepository } from './orders.repository';

@Injectable()
export class OrdersService {
  constructor(
    private readonly repository: OrdersRepository,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  createOrder(lines: OrderLineRequest[]): Promise<OrderView> {
    return this.repository.reserveAndCreate(
      lines,
      this.config.get('ORDER_TTL_MINUTES', { infer: true }),
    );
  }

  async getOrder(id: string): Promise<OrderView> {
    const order = await this.repository.findById(id);
    if (!order) {
      throw new OrderNotFoundError(id);
    }
    return order;
  }
}
