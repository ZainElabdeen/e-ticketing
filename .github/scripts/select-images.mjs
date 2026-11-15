import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Images to build: all of them, or those whose filter matched, in images.json order. */
export function selectImages(changed, all, images) {
  if (all) return images;
  const wanted = new Set(changed);
  return images.filter((image) => wanted.has(image.name));
}

/** Names of images not rebuilt in this run; the retag job gives them the new sha tag. */
export function unchangedImages(changed, all, images) {
  const built = new Set(selectImages(changed, all, images).map((image) => image.name));
  return images.filter((image) => !built.has(image.name)).map((image) => image.name);
}

/** docker/build-push-action `build-args` input: one KEY=VALUE per line. */
export function buildArgsText(image) {
  return Object.entries(image.buildArgs ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

function main() {
  const images = JSON.parse(readFileSync(new URL('../images.json', import.meta.url), 'utf8'));
  const changed = JSON.parse(process.env.CHANGES || '[]');
  const all = process.env.ALL === 'true';
  const selected = selectImages(changed, all, images).map((image) => ({
    ...image,
    buildArgsText: buildArgsText(image),
  }));
  const lines = [
    `images=${JSON.stringify(selected)}`,
    `unchanged=${JSON.stringify(unchangedImages(changed, all, images))}`,
  ].join('\n');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines}\n`);
  else console.log(lines);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
