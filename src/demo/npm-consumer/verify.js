'use strict';

const assert = require('node:assert/strict');
const demo = require('@now-micro/demo-npm');

const expectedExports = ['add', 'subtract', 'multiply', 'divide', 'clamp', 'absDiff'];

for (const name of expectedExports) {
  assert.equal(typeof demo[name], 'function', `Expected ${name} to be exported as a function`);
}

assert.deepEqual(Object.keys(demo).sort(), expectedExports.slice().sort());

assert.equal(demo.add(2, 3), 5);
assert.equal(demo.subtract(10, 4), 6);
assert.equal(demo.multiply(3, 4), 12);
assert.equal(demo.divide(12, 3), 4);
assert.equal(demo.clamp(15, 0, 10), 10);
assert.equal(demo.absDiff(7, 2), 5);

assert.throws(() => demo.divide(1, 0), /Division by zero/);

console.log('All published exports are present and working.');