/**
 * Drops every trailing "/" from a base URL. A loop instead of `/\/+$/`, which
 * backtracks quadratically on a long run of slashes not at the end.
 */
export function trimTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === '/') end--;
  return url.slice(0, end);
}
