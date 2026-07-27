// ---------------------------------------------------------------------------
// credential comparison primitives
//
// Shared by everything that checks a secret (agent tokens, the join token,
// the admin password), so "compare in constant time via hashes" is written
// once. Knows nothing about the domain.
// ---------------------------------------------------------------------------

import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Secrets are stored and compared as sha-256 hashes — a leaked database dump
 * yields no usable credentials, exactly like password hashing. (No salt: the
 * hashed inputs are either high-entropy random tokens, where salting adds
 * nothing, or compared-only values that are never persisted.)
 */
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/**
 * Hex-hash comparison without an early exit (`timingSafeEqual`), so response
 * timing leaks nothing about how many leading bytes matched. Comparing the
 * *hashes* also equalises the length first — the two inputs to a naive
 * comparison would differ in length, which `timingSafeEqual` refuses.
 */
export const sameHash = (a: string, b: string): boolean => {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
};

/**
 * The one way to check a low-entropy secret (a password) against its
 * reference: hash both sides, compare in constant time. For high-entropy
 * tokens prefer a hash *lookup* (`findByTokenHash`) — this helper is for the
 * cases where there is exactly one right answer.
 */
export const sameSecret = (presented: string, expected: string): boolean => (
  sameHash(hashToken(presented), hashToken(expected))
);
