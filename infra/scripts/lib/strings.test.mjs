import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isEmail, trimTrailingSlashes } from './strings.mjs';

test('isEmail accepts what the old /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/ accepted', () => {
  for (const ok of ['a@b.co', 'admin@eticket.local', 'x.y+z@sub.example.com', 'x@a.b.']) {
    assert.equal(isEmail(ok), true, ok);
  }
});

test('isEmail rejects what the old regex rejected', () => {
  for (const bad of [
    '',
    'a',
    'a@b',
    '@b.co',
    'a@.co',
    'a@b.',
    'a@@b.co',
    'a@b@c.co',
    'a b@c.co',
    'a@b.c\n',
    'a@b.co\r',
  ]) {
    assert.equal(isEmail(bad), false, JSON.stringify(bad));
  }
});

test('isEmail is linear on long input', () => {
  assert.equal(isEmail(`a@${'b'.repeat(100_000)}`), false);
});

test('trimTrailingSlashes drops every trailing slash only', () => {
  assert.equal(trimTrailingSlashes('http://h:3000///'), 'http://h:3000');
  assert.equal(trimTrailingSlashes('http://h:3000/api'), 'http://h:3000/api');
  assert.equal(trimTrailingSlashes('/'), '');
});
