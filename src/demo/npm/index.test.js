'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { add, subtract, multiply, divide, clamp, absDiff } = require('./index');

// ── add ───────────────────────────────────────────────────────────────────────

test('add: positive numbers', () => {
    assert.strictEqual(add(2, 3), 5);
});

test('add: negative numbers', () => {
    assert.strictEqual(add(-4, -6), -10);
});

test('add: mixed sign', () => {
    assert.strictEqual(add(10, -3), 7);
});

test('add: floats', () => {
    assert.ok(Math.abs(add(0.1, 0.2) - 0.3) < Number.EPSILON * 10);
});

test('add: identity (n + 0 = n)', () => {
    assert.strictEqual(add(42, 0), 42);
});

// ── subtract ──────────────────────────────────────────────────────────────────

test('subtract: basic', () => {
    assert.strictEqual(subtract(10, 4), 6);
});

test('subtract: result is negative', () => {
    assert.strictEqual(subtract(3, 8), -5);
});

test('subtract: same value yields zero', () => {
    assert.strictEqual(subtract(7, 7), 0);
});

test('subtract: negative operand', () => {
    assert.strictEqual(subtract(-2, -5), 3);
});

// ── multiply ──────────────────────────────────────────────────────────────────

test('multiply: positive numbers', () => {
    assert.strictEqual(multiply(3, 4), 12);
});

test('multiply: by zero', () => {
    assert.strictEqual(multiply(99, 0), 0);
});

test('multiply: negative × positive', () => {
    assert.strictEqual(multiply(-3, 5), -15);
});

test('multiply: negative × negative', () => {
    assert.strictEqual(multiply(-4, -6), 24);
});

test('multiply: identity (n × 1 = n)', () => {
    assert.strictEqual(multiply(7, 1), 7);
});

// ── divide ────────────────────────────────────────────────────────────────────

test('divide: basic', () => {
    assert.strictEqual(divide(10, 2), 5);
});

test('divide: result is a fraction', () => {
    assert.strictEqual(divide(7, 2), 3.5);
});

test('divide: negative dividend', () => {
    assert.strictEqual(divide(-9, 3), -3);
});

test('divide: both negative', () => {
    assert.strictEqual(divide(-12, -4), 3);
});

test('divide: by zero throws', () => {
    assert.throws(() => divide(5, 0), /Division by zero/);
});

// ── clamp ─────────────────────────────────────────────────────────────────────

test('clamp: value within range is unchanged', () => {
    assert.strictEqual(clamp(5, 1, 10), 5);
});

test('clamp: value below min returns min', () => {
    assert.strictEqual(clamp(-5, 0, 100), 0);
});

test('clamp: value above max returns max', () => {
    assert.strictEqual(clamp(200, 0, 100), 100);
});

test('clamp: value equal to min', () => {
    assert.strictEqual(clamp(0, 0, 10), 0);
});

test('clamp: value equal to max', () => {
    assert.strictEqual(clamp(10, 0, 10), 10);
});

// ── absDiff ───────────────────────────────────────────────────────────────────

test('absDiff: a > b', () => {
    assert.strictEqual(absDiff(10, 3), 7);
});

test('absDiff: b > a', () => {
    assert.strictEqual(absDiff(3, 10), 7);
});

test('absDiff: equal values', () => {
    assert.strictEqual(absDiff(5, 5), 0);
});

test('absDiff: negative values', () => {
    assert.strictEqual(absDiff(-3, -8), 5);
});

test('absDiff: mixed sign', () => {
    assert.strictEqual(absDiff(-4, 6), 10);
});
