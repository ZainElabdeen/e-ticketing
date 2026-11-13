import { Controller, Get } from '@nestjs/common';
import { TicketTypesRepository } from './ticket-types.repository';
import type { TicketTypeView } from './ticket-type.view';

@Controller('v1/ticket-types')
export class TicketTypesController {
  constructor(private readonly repository: TicketTypesRepository) {}

  @Get()
  async list(): Promise<{ data: TicketTypeView[] }> {
    return { data: await this.repository.list() };
  }
}
