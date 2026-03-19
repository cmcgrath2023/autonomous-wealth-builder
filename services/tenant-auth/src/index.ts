import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { TenantDB } from '../../tenant-db/src/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Tenant {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  tier: 'free' | 'hosted' | 'pro';
  trial_ends_at: string | null;
  subscription_status: 'none' | 'active' | 'past_due' | 'cancelled';
  created_at: string;
}

export interface JwtPayload {
  tenantId: string;
  email: string;
  tier: string;
  iat: number;
  exp: number;
}

export interface AuthResult {
  token: string;
  tenantId: string;
  email: string;
  tier: string;
}

// ---------------------------------------------------------------------------
// JWT — minimal HMAC-SHA256 implementation (no external dependency)
// ---------------------------------------------------------------------------

function base64url(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf) : buf;
  return b.toString('base64url');
}

function base64urlDecode(str: string): Buffer {
  return Buffer.from(str, 'base64url');
}

function signJwt(payload: Omit<JwtPayload, 'iat' | 'exp'>, secret: string, expiresInSec = 86400): string {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JwtPayload = { ...payload, iat: now, exp: now + expiresInSec };

  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(fullPayload));
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest();

  return `${header}.${body}.${base64url(signature)}`;
}

function verifyJwt(token: string, secret: string): JwtPayload {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token format');

  const [header, body, sig] = parts;
  const expectedSig = createHmac('sha256', secret).update(`${header}.${body}`).digest();
  const actualSig = base64urlDecode(sig);

  if (actualSig.length !== expectedSig.length || !timingSafeEqual(actualSig, expectedSig)) {
    throw new Error('Invalid token signature');
  }

  const payload: JwtPayload = JSON.parse(base64urlDecode(body).toString('utf8'));

  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Token expired');
  }

  return payload;
}

// ---------------------------------------------------------------------------
// Password hashing (scrypt — built-in, no native addon needed)
// ---------------------------------------------------------------------------

const SALT_LEN = 32;
const KEY_LEN = 64;

function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LEN);
  const derived = scryptSync(password, salt, KEY_LEN);
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, keyHex] = stored.split(':');
  if (!saltHex || !keyHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const storedKey = Buffer.from(keyHex, 'hex');
  const derived = scryptSync(password, salt, KEY_LEN);
  return derived.length === storedKey.length && timingSafeEqual(derived, storedKey);
}

// ---------------------------------------------------------------------------
// TenantAuth
// ---------------------------------------------------------------------------

let _generatedSecret: string | undefined;

function getJwtSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (!_generatedSecret) {
    _generatedSecret = randomBytes(48).toString('hex');
    console.warn('[tenant-auth] No JWT_SECRET env var — using generated secret (tokens will not survive restarts)');
  }
  return _generatedSecret;
}

export class TenantAuth {
  private db: TenantDB;
  private secret: string;

  constructor(db: TenantDB) {
    this.db = db;
    this.secret = getJwtSecret();
  }

  // -----------------------------------------------------------------------
  // signup
  // -----------------------------------------------------------------------
  async signup(email: string, password: string, name: string): Promise<AuthResult> {
    if (!email || !password || !name) {
      throw new Error('email, password, and name are required');
    }

    const existing = await this.db.getTenantByEmail(email);
    if (existing) {
      throw new Error('A tenant with this email already exists');
    }

    const passwordHash = hashPassword(password);

    const tenant = await this.db.createTenant({
      email,
      name,
      password_hash: passwordHash,
      tier: 'hosted',
      trial_ends_at: null,
      subscription_status: 'none',
    });

    const token = signJwt(
      { tenantId: tenant.id, email: tenant.email, tier: tenant.tier },
      this.secret,
    );

    return { token, tenantId: tenant.id, email: tenant.email, tier: tenant.tier };
  }

  // -----------------------------------------------------------------------
  // login
  // -----------------------------------------------------------------------
  async login(email: string, password: string): Promise<AuthResult> {
    if (!email || !password) {
      throw new Error('email and password are required');
    }

    const tenant = await this.db.getTenantByEmail(email);
    if (!tenant) {
      throw new Error('Invalid email or password');
    }

    const valid = verifyPassword(password, tenant.password_hash);
    if (!valid) {
      throw new Error('Invalid email or password');
    }

    const token = signJwt(
      { tenantId: tenant.id, email: tenant.email, tier: tenant.tier },
      this.secret,
    );

    return { token, tenantId: tenant.id, email: tenant.email, tier: tenant.tier };
  }

  // -----------------------------------------------------------------------
  // verifyToken
  // -----------------------------------------------------------------------
  verifyToken(token: string): JwtPayload {
    return verifyJwt(token, this.secret);
  }

  // -----------------------------------------------------------------------
  // startTrial — sets trial_ends_at to 3 days from now
  // -----------------------------------------------------------------------
  async startTrial(tenantId: string): Promise<Tenant> {
    const tenant = await this.db.getTenant(tenantId);
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 3);

    const updated = await this.db.updateTenant(tenantId, {
      trial_ends_at: trialEnd.toISOString(),
    });

    return updated;
  }
}

export default TenantAuth;
