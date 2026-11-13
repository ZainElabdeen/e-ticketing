import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { toTicketTypeView, type TicketTypeView } from './ticket-type.view';

@Injectable()
export class TicketTypesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<TicketTypeView[]> {
    const rows = await this.prisma.ticketType.findMany({ orderBy: { code: 'asc' } });
    return rows.map(toTicketTypeView);
  }
}
