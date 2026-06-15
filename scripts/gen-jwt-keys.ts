// Genera un par RSA (RS256) para JWT y lo añade a .env como base64 (PEM).
// Uso: bun run keys:gen   (idempotente: no sobreescribe si ya existen).
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const envPath = '.env';
const env = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';

if (env.includes('JWT_PRIVATE_KEY=')) {
  console.log('JWT keys ya presentes en .env — nada que hacer.');
  process.exit(0);
}

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const b64 = (s: string) => Buffer.from(s).toString('base64');
const block = [
  '',
  '# JWT RS256 (dev). Generadas por `bun run keys:gen`. PEM en base64.',
  `JWT_PRIVATE_KEY=${b64(privateKey)}`,
  `JWT_PUBLIC_KEY=${b64(publicKey)}`,
  '',
].join('\n');

writeFileSync(envPath, env + block);
console.log('JWT keys añadidas a .env');
