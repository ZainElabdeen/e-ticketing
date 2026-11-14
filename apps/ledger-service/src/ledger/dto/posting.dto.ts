import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import type { PostingType } from '../domain/posting';

const lower = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.toLowerCase() : value;

export class PostingDto {
  @Transform(lower)
  @IsUUID(undefined, { message: 'transactionId must be a UUID' })
  transactionId!: string;

  @IsIn(['TICKET_SALE', 'UNFULFILLED_PAYMENT'], {
    message: 'postingType must be TICKET_SALE or UNFULFILLED_PAYMENT',
  })
  postingType!: PostingType;

  @Transform(lower)
  @IsUUID(undefined, { message: 'orderId must be a UUID' })
  orderId!: string;

  @IsString({ message: 'paymentReference must be a string' })
  @Length(1, 64, { message: 'paymentReference must be 1 to 64 characters' })
  paymentReference!: string;

  @IsInt({ message: 'amountMinor must be an integer' })
  @Min(1, { message: 'amountMinor must be at least 1' })
  @Max(Number.MAX_SAFE_INTEGER, { message: 'amountMinor must be a safe integer' })
  amountMinor!: number;

  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter uppercase code' })
  currency!: string;
}
