// Parser for the YAML that `kubectl kustomize` prints: block mappings and
// sequences, plain / "double" / 'single' quoted scalars, {} and [], and | / |-
// literal blocks, and whole-line comments. No anchors or flow collections with content.
// It exists so the manifest tests need no YAML dependency (AGENTS.md: no new
// dependency without an ADR); it is not a general YAML parser.

const KEY = /^("(?:[^"\\]|\\.)*"|'[^']*'|[^\s"'{[#][^:]*?):(?: (.*))?$/;

function scalar(token) {
  const t = token.trim();
  if (t === '{}') return {};
  if (t === '[]') return [];
  if (t.startsWith('"')) return JSON.parse(t);
  if (t.startsWith("'")) return t.slice(1, -1).replaceAll("''", "'");
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null' || t === '~' || t === '') return null;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return t;
}

function indentOf(line) {
  return line.length - line.trimStart().length;
}

function parseKey(rawKey) {
  return rawKey.startsWith('"') || rawKey.startsWith("'") ? scalar(rawKey) : rawKey;
}

class Reader {
  constructor(text) {
    this.lines = text.split('\n');
    this.i = 0;
  }

  skipBlank() {
    while (this.i < this.lines.length && this.isBlankOrComment(this.lines[this.i])) this.i++;
  }

  isBlankOrComment(line) {
    const t = line.trim();
    return t === '' || t.startsWith('#');
  }

  peek() {
    this.skipBlank();
    return this.i < this.lines.length ? this.lines[this.i] : null;
  }

  literal(parentIndent, keep) {
    const out = [];
    let blockIndent = -1;
    while (this.i < this.lines.length) {
      const line = this.lines[this.i];
      if (line.trim() === '') {
        out.push('');
        this.i++;
        continue;
      }
      const ind = indentOf(line);
      if (ind <= parentIndent) break;
      if (blockIndent < 0) blockIndent = ind;
      out.push(line.slice(blockIndent));
      this.i++;
    }
    while (out.length && out.at(-1) === '') out.pop();
    return out.join('\n') + (keep ? '\n' : '');
  }

  node(indent) {
    const line = this.peek();
    if (line === null) return null;
    return line.trimStart().startsWith('- ') || line.trim() === '-'
      ? this.seq(indent)
      : this.map(indent);
  }

  seq(indent) {
    const items = [];
    for (let line = this.peek(); line !== null; line = this.peek()) {
      const text = line.trimStart();
      if (indentOf(line) !== indent || !(text.startsWith('- ') || text === '-')) break;
      const rest = text.slice(1).trimStart();
      if (rest === '') {
        this.i++;
        const next = this.peek();
        items.push(next !== null && indentOf(next) > indent ? this.node(indentOf(next)) : null);
        continue;
      }
      const childIndent = indent + (text.length - rest.length);
      if (KEY.test(rest)) {
        this.lines[this.i] = ' '.repeat(childIndent) + rest;
        items.push(this.map(childIndent));
      } else if (rest === '|' || rest === '|-') {
        this.i++;
        items.push(this.literal(indent, rest === '|'));
      } else {
        this.i++;
        items.push(scalar(rest));
      }
    }
    return items;
  }

  map(indent) {
    const obj = {};
    for (let line = this.peek(); line !== null; line = this.peek()) {
      const match = KEY.exec(line.trim());
      if (indentOf(line) !== indent || !match) break;
      const key = parseKey(match[1]);
      const rest = match[2]?.trim() ?? '';
      this.i++;
      if (rest === '|' || rest === '|-') {
        obj[key] = this.literal(indent, rest === '|');
      } else if (rest !== '') {
        obj[key] = scalar(rest);
      } else {
        const next = this.peek();
        const nextIndent = next === null ? -1 : indentOf(next);
        const sameIndentSeq = nextIndent === indent && next.trimStart().startsWith('- ');
        obj[key] = nextIndent > indent || sameIndentSeq ? this.node(nextIndent) : null;
      }
    }
    return obj;
  }
}

/** Parses one YAML document. */
export function parseYaml(text) {
  const reader = new Reader(text);
  const first = reader.peek();
  return first === null ? null : reader.node(indentOf(first));
}

/** Parses a multi-document stream separated by `---` lines. */
export function parseAllYaml(text) {
  return text
    .split(/^---\s*$/m)
    .filter((doc) => doc.trim() !== '')
    .map(parseYaml);
}
