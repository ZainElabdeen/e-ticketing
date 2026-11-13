import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  Max,
  Min,
  ValidateBy,
  ValidateNested,
} from 'class-validator';

export class OrderLineDto {
  @IsIn(['GOLD', 'PREMIUM', 'VIP'])
  ticketTypeCode!: 'GOLD' | 'PREMIUM' | 'VIP';

  @IsInt()
  @Min(1)
  @Max(10)
  quantity!: number;
}

function UniqueTicketTypeCodes() {
  return ValidateBy({
    name: 'uniqueTicketTypeCodes',
    validator: {
      validate: (value: unknown) =>
        !Array.isArray(value) ||
        new Set(value.map((i: { ticketTypeCode?: unknown }) => i?.ticketTypeCode)).size ===
          value.length,
      defaultMessage: () => 'each ticketTypeCode may appear at most once',
    },
  });
}

export class CreateOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @UniqueTicketTypeCodes()
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  items!: OrderLineDto[];
}
