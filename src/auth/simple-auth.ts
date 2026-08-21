export const SIMPLE_AUTH_COOKIE = "tdl_session";
export const SIMPLE_AUTH_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

interface SessionPayload {
  exp: number;
  iat: number;
  v: 1;
}

export function isSimpleAuthEnabled(): boolean {
  return Boolean(process.env.TODOTODOLIST_PASSWORD);
}

export function getSimpleAuthSecret(): string {
  const password = process.env.TODOTODOLIST_PASSWORD || "";
  const secret = process.env.TODOTODOLIST_AUTH_SECRET || "";
  return secret ? `${secret}\0${password}` : password;
}

export async function createSimpleSessionToken(now = Date.now()): Promise<string> {
  const payload: SessionPayload = {
    exp: now + SIMPLE_AUTH_MAX_AGE_SECONDS * 1000,
    iat: now,
    v: 1
  };
  const encodedPayload = base64UrlEncodeText(JSON.stringify(payload));
  const signature = await signValue(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export async function verifySimpleSessionToken(token?: string | null, now = Date.now()): Promise<boolean> {
  if (!isSimpleAuthEnabled()) return true;
  if (!token) return false;

  const [encodedPayload, signature, extra] = token.split(".");
  if (!encodedPayload || !signature || extra !== undefined) return false;

  const expectedSignature = await signValue(encodedPayload);
  if (!constantTimeEqual(signature, expectedSignature)) return false;

  try {
    const payload = JSON.parse(base64UrlDecodeText(encodedPayload)) as Partial<SessionPayload>;
    return payload.v === 1 && typeof payload.exp === "number" && payload.exp > now;
  } catch {
    return false;
  }
}

export function verifySimplePassword(password: string): boolean {
  const expectedPassword = process.env.TODOTODOLIST_PASSWORD;
  return expectedPassword ? constantTimeEqual(password, expectedPassword) : false;
}

async function signValue(value: string): Promise<string> {
  const secret = getSimpleAuthSecret();
  if (!secret) return "";

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64UrlEncodeBytes(new Uint8Array(signature));
}

function base64UrlEncodeText(value: string): string {
  return base64UrlEncodeBytes(new TextEncoder().encode(value));
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlDecodeText(value: string): string {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let diff = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < length; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return diff === 0;
}
