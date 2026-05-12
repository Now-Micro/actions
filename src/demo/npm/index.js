'use strict';

/**
 * Adds two numbers.
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
function add(a, b) {
    return a + b;
}

/**
 * Subtracts b from a.
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
function subtract(a, b) {
    return a - b;
}

/**
 * Multiplies two numbers.
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
function multiply(a, b) {
    return a * b;
}

/**
 * Divides a by b. Throws if b is zero.
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
function divide(a, b) {
    if (b === 0) throw new Error('Division by zero');
    return a / b;
}

/**
 * Clamps a value between min and max (inclusive).
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

/**
 * Returns the absolute difference between two numbers.
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
function absDiff(a, b) {
    return Math.abs(a - b);
}

module.exports = { add, subtract, multiply, divide, clamp, absDiff };
