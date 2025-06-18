import crypto from 'node:crypto';

export function randomBase64url(bytes: number = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256base64url(input: string): string {
  return crypto.createHash('sha256').update(input).digest('base64url');
} 