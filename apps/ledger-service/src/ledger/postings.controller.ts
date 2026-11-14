import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import { correlationIdOf, Internal, type CorrelatedRequest } from '@eticket/nest-common';
import { PostingDto } from './dto/posting.dto';
import type { JournalEntryView } from './journal-entry.view';
import { PostingsService } from './postings.service';

interface StatusSetter {
  status(code: number): unknown;
}

@Internal()
@Controller('v1/internal/postings')
export class PostingsController {
  constructor(private readonly postings: PostingsService) {}

  @Post()
  async create(
    @Body() dto: PostingDto,
    @Req() req: CorrelatedRequest,
    @Res({ passthrough: true }) res: StatusSetter,
  ): Promise<JournalEntryView> {
    const { status, view } = await this.postings.post(dto, correlationIdOf(req));
    res.status(status);
    return view;
  }
}
