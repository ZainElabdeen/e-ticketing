import { Controller, Get, Query } from '@nestjs/common';
import { ListTransactionsQuery } from './list-transactions.query';
import { TransactionsRepository, type TransactionPage } from './transactions.repository';

@Controller('v1/transactions')
export class TransactionsController {
  constructor(private readonly transactions: TransactionsRepository) {}

  @Get()
  list(@Query() query: ListTransactionsQuery): Promise<TransactionPage> {
    return this.transactions.list(query.page, query.pageSize);
  }
}
