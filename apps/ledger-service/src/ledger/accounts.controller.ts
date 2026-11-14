import { Controller, Get } from '@nestjs/common';
import { LedgerRepository, type AccountList } from './ledger.repository';

@Controller('v1/accounts')
export class AccountsController {
  constructor(private readonly repo: LedgerRepository) {}

  @Get()
  list(): Promise<AccountList> {
    return this.repo.accountBalances();
  }
}
