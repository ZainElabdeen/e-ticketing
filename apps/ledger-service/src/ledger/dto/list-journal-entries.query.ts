import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Query strings arrive as strings and the global pipe has no implicit
 * conversion, so this DTO converts explicitly. `abc` becomes NaN and `1.5`
 * stays 1.5; both fail `@IsInt`.
 */
export class ListJournalEntriesQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 20;
}
