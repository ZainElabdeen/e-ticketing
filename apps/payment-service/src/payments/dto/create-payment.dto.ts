import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
  registerDecorator,
  type ValidationArguments,
} from 'class-validator';

/**
 * No message here uses `$value`, so a submitted PAN or CVC is never echoed.
 * The shared validation pipe also flattens errors to message strings.
 */
export class CardDto {
  @Matches(/^[0-9]{12,19}$/, { message: 'card.number must be 12 to 19 digits' })
  number!: string;

  @IsInt({ message: 'card.expMonth must be an integer' })
  @Min(1, { message: 'card.expMonth must be between 1 and 12' })
  @Max(12, { message: 'card.expMonth must be between 1 and 12' })
  expMonth!: number;

  @IsInt({ message: 'card.expYear must be an integer' })
  @Min(2000, { message: 'card.expYear must be between 2000 and 2099' })
  @Max(2099, { message: 'card.expYear must be between 2000 and 2099' })
  expYear!: number;

  @Matches(/^[0-9]{3,4}$/, { message: 'card.cvc must be 3 or 4 digits' })
  cvc!: string;

  @IsString({ message: 'card.holder must be a string' })
  @Length(1, 100, { message: 'card.holder must be 1 to 100 characters' })
  holder!: string;
}

/**
 * Cross-field rule, attached to `method` (not `card`: @ValidateIf on `card`
 * would skip it when card is absent): card required for CARD, absent for QR.
 */
function CardMatchesMethod() {
  return (target: object, propertyKey: string) => {
    registerDecorator({
      name: 'cardMatchesMethod',
      target: target.constructor,
      propertyName: propertyKey,
      validator: {
        validate(_value: unknown, args: ValidationArguments) {
          const o = args.object as CreatePaymentDto;
          if (o.method === 'CARD') return o.card !== undefined;
          if (o.method === 'QR') return o.card === undefined;
          return true;
        },
        defaultMessage(args: ValidationArguments) {
          const o = args.object as CreatePaymentDto;
          return o.method === 'QR' ? 'card must be absent for QR' : 'card is required for CARD';
        },
      },
    });
  };
}

export class CreatePaymentDto {
  @IsUUID(undefined, { message: 'orderId must be a UUID' })
  orderId!: string;

  @IsIn(['CARD', 'QR'], { message: 'method must be CARD or QR' })
  @CardMatchesMethod()
  method!: 'CARD' | 'QR';

  @ValidateIf((o: CreatePaymentDto) => o.card !== undefined)
  @ValidateNested()
  @Type(() => CardDto)
  card?: CardDto;
}
