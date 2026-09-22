import crypto from "crypto";
import { db } from "@/db";
import { users, sessions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { secureAttribute } from "@/lib/auth/cookies";

// Session token
export function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

// Password hashing (scrypt, built-in)
export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { hash, salt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  try {
    const candidate = crypto.scryptSync(password, salt, 64).toString("hex");
    return crypto.timingSafeEqual(
      Buffer.from(candidate, "hex"),
      Buffer.from(hash, "hex"),
    );
  } catch {
    return false;
  }
}

// Session helpers

export async function createSession(userId: number): Promise<string> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000); // 30 days
  await db.insert(sessions).values({ token, user_id: userId, expires_at: expiresAt });
  return token;
}

export async function getSessionUser(token: string | undefined) {
  if (!token) return null;
  const result = await db
    .select({ user: users, session: sessions })
    .from(sessions)
    .innerJoin(users, eq(sessions.user_id, users.id))
    .where(eq(sessions.token, token))
    .limit(1);
  if (!result.length) return null;
  const { session, user } = result[0];
  if (new Date(session.expires_at) < new Date()) return null;
  return user;
}

export async function getSessionFromCookies() {
  const cookieStore = await cookies();
  const token = cookieStore.get("afya_session")?.value;
  return getSessionUser(token);
}

export async function deleteSession(token: string) {
  await db.delete(sessions).where(eq(sessions.token, token));
}

/** Signs the user out everywhere. */
export async function deleteUserSessions(userId: number) {
  await db.delete(sessions).where(eq(sessions.user_id, userId));
}

// Cookie helpers

export function sessionCookie(token: string, maxAge = 30 * 24 * 3600) {
  return `afya_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureAttribute()}`;
}

export function clearSessionCookie() {
  return `afya_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureAttribute()}`;
}

// CSRF token
export function generateCsrf(): string {
  return crypto.randomBytes(24).toString("hex");
}
