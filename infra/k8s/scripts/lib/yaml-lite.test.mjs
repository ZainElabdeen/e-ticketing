import assert from 'node:assert/strict';
import test from 'node:test';

import { parseAllYaml, parseYaml } from './yaml-lite.mjs';

test('maps, sequences, scalars and quoting', () => {
  const doc = parseYaml(
    [
      'a: 1',
      'b: "x: y"',
      "c: 'it''s'",
      'd: true',
      'e: "false"',
      'url: postgresql://u:$(P)@h:5432/db?schema=s',
      'list:',
      '- one',
      '- -c',
      '- name: n',
      '  value: v',
      'empty: {}',
      'nested:',
      '  - k: 1',
      '    inner:',
      '    - z',
    ].join('\n'),
  );
  assert.deepEqual(doc, {
    a: 1,
    b: 'x: y',
    c: "it's",
    d: true,
    e: 'false',
    url: 'postgresql://u:$(P)@h:5432/db?schema=s',
    list: ['one', '-c', { name: 'n', value: 'v' }],
    empty: {},
    nested: [{ k: 1, inner: ['z'] }],
  });
});

test('literal blocks keep or strip the final newline', () => {
  const doc = parseYaml(
    ['data:', '  a.sh: |', '    echo hi', '', '    echo bye', '  b: |-', '    x', 'after: 1'].join(
      '\n',
    ),
  );
  assert.deepEqual(doc, { data: { 'a.sh': 'echo hi\n\necho bye\n', b: 'x' }, after: 1 });
});

test('literal block as a sequence item, and whole-line comments', () => {
  const doc = parseYaml(
    [
      '# head',
      'cmd:',
      '  - sh',
      '  # note',
      '  - |',
      '    set -eu',
      '    # kept',
      '    echo $x',
      'next: 1',
    ].join('\n'),
  );
  assert.deepEqual(doc, { cmd: ['sh', 'set -eu\n# kept\necho $x\n'], next: 1 });
});

test('throws instead of truncating on unsupported input', () => {
  assert.throws(() => parseYaml('a: 1\n  b: 2\nc: 3'), /line 2/);
  assert.throws(() => parseYaml('a: 1\n- x'), /line 2/);
});

test('a literal block with --- indented inside survives document splitting', () => {
  const docs = parseAllYaml('a: |\n  x\n  ---\n  y\n---\nb: 1\n');
  assert.deepEqual(docs, [{ a: 'x\n---\ny\n' }, { b: 1 }]);
});

test('splits documents on ---', () => {
  assert.deepEqual(parseAllYaml('a: 1\n---\nb: 2\n'), [{ a: 1 }, { b: 2 }]);
});
