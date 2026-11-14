import { Controller, Get, Query } from '@nestjs/common';
import { ListJournalEntriesQuery } from './dto/list-journal-entries.query';
import type { JournalEntryView } from './journal-entry.view';
import { LedgerRepository } from './ledger.repository';

export interface JournalEntryPage {
  data: JournalEntryView[];
  page: number;
  pageSize: number;
  total: number;
}

@Controller('v1/journal-entries')
export class JournalEntriesController {
  constructor(private readonly repo: LedgerRepository) {}

  @Get()
  async list(@Query() query: ListJournalEntriesQuery): Promise<JournalEntryPage> {
    const { data, total } = await this.repo.listEntries(query.page, query.pageSize);
    return { data, page: query.page, pageSize: query.pageSize, total };
  }
}
