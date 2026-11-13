import { All, Controller, Module, NotFoundException } from '@nestjs/common';

/**
 * Catches every request no real route matched. Guards only run on matched
 * routes, so without this an unknown path would answer 404 to callers with no
 * key and the scope check would never run for `/v1/internal/*` lookalikes.
 * With it the API-key guard runs first: no key gets 401, otherwise 404.
 *
 * Routes register in module order, so FallbackModule must stay LAST in the
 * AppModule imports.
 */
@Controller()
export class FallbackController {
  @All('*path')
  notFound(): never {
    throw new NotFoundException('Route not found');
  }
}

@Module({ controllers: [FallbackController] })
export class FallbackModule {}
