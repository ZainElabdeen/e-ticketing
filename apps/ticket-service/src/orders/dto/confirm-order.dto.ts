import { IsUUID } from 'class-validator';

export class ConfirmOrderDto {
  @IsUUID('4')
  transactionId!: string;
}
