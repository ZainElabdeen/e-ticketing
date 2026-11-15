// String checks shared by the infra scripts. Loops instead of regexes such as
// /^[^\s@]+@[^\s@]+\.[^\s@]+$/ or /\/+$/, which backtrack on crafted input.

/**
 * Same set as /^[^\s@]+@[^\s@]+\.[^\s@]+$/: one "@" with text before it, and a
 * domain with a "." that has text on both sides. No whitespace anywhere.
 */
export function isEmail(value) {
  if (/\s/.test(value)) return false;
  const at = value.indexOf('@');
  if (at < 1 || at !== value.lastIndexOf('@')) return false;
  const domain = value.slice(at + 1);
  const dot = domain.indexOf('.', 1);
  return dot !== -1 && dot < domain.length - 1;
}

export function trimTrailingSlashes(url) {
  let end = url.length;
  while (end > 0 && url[end - 1] === '/') end--;
  return url.slice(0, end);
}
