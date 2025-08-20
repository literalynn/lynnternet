import test from 'node:test';
import assert from 'node:assert';
import { sanitizeId } from '../utils.js';

test('converts spaces to hyphens', () => {
  assert.strictEqual(sanitizeId('hello world'), 'hello-world');
});

test('replaces special characters', () => {
  assert.strictEqual(sanitizeId('hello@#$world'), 'hello-world');
});

test('preserves uppercase letters', () => {
  assert.strictEqual(sanitizeId('Hello World'), 'Hello-World');
});
