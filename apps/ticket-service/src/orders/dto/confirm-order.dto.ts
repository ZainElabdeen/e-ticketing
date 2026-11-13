import { IsUUID } from 'class-validator';

export class ConfirmOrderDto {
  @IsUUID()
  transactionId!: string;
}
