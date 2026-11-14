import { NotFoundException } from '@nestjs/common';

/**
 * Makes one path parameter safe to put in a downstream URL. encodeURIComponent
 * leaves `.` alone and axios resolves `.`/`..` segments, so those (and anything
 * that decodes to a separator) are refused as a 404 instead of escaping the route.
 */
export function pathSegment(value: string): string {
  if (value === '' || value === '.' || value === '..' || /[/\\]/.test(value)) {
    throw new NotFoundException();
  }
  return encodeURIComponent(value);
}
