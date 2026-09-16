import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

export const USERNAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{2,19}$/;

export interface StoredUser {
  id: string;
  username: string;
  usernameKey: string;
  email: string;
  passwordSalt: string;
  passwordHash: string;
  sageAddress: string;
  sagePubkey: string;
  createdAt: string;
}

const usersByKey = new Map<string, StoredUser>();
const usersById = new Map<string, StoredUser>();
let loaded = false;

function accountsPath(): string | null {
  const raw = process.env.DAT_ACCOUNTS_PATH?.trim();
  if (raw === "memory") return null;
  if (raw) return resolve(raw);
  return resolve(process.cwd(), "data/accounts.json");
}

function scryptN(): number {
  const n = Number(process.env.DAT_SCRYPT_N ?? 16384);
  return Number.isFinite(n) && n >= 1024 ? n : 16384;
}

async function persist(): Promise<void> {
  const path = accountsPath();
  if (!path) return;
  await mkdir(dirname(path), { recursive: true });
  const body = JSON.stringify({ users: [...usersById.values()] }, null, 2);
  await writeFile(path, body, { encoding: "utf8", mode: 0o600 });
}

export async function loadUsers(): Promise<void> {
  if (loaded) return;
  loaded = true;
  const path = accountsPath();
  if (!path) return;
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as { users?: StoredUser[] };
    for (const user of parsed.users ?? []) {
      usersByKey.set(user.usernameKey, user);
      usersById.set(user.id, user);
    }
  } catch {
    /* first run — file is created on register */
  }
}

export function normalizeUsername(username: string): string {
  return username.trim();
}

export function usernameKey(username: string): string {
  return normalizeUsername(username).toLowerCase();
}

export function validateUsername(username: string): string | null {
  const trimmed = normalizeUsername(username);
  if (!USERNAME_PATTERN.test(trimmed)) {
    return "Username must be 3–20 characters, start with a letter, and use only letters, numbers, or _";
  }
  return null;
}

export function validatePassword(password: string): string | null {
  if (password.length < 8) return "Password must be at least 8 characters";
  if (password.length > 200) return "Password is too long";
  return null;
}

export function validateEmail(email: string): string | null {
  const trimmed = email.trim();
  if (!trimmed) return null;
  if (trimmed.length > 200) return "Email is too long";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return "Enter a valid email or leave it blank";
  return null;
}

async function hashPassword(password: string, salt: Buffer): Promise<string> {
  const key = await new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 32, { N: scryptN() }, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey as Buffer);
    });
  });
  return key.toString("hex");
}

export async function registerUser(params: {
  username: string;
  password: string;
  email?: string;
}): Promise<StoredUser> {
  await loadUsers();
  const usernameError = validateUsername(params.username);
  if (usernameError) throw new Error(usernameError);
  const passwordError = validatePassword(params.password);
  if (passwordError) throw new Error(passwordError);
  const email = (params.email ?? "").trim();
  const emailError = validateEmail(email);
  if (emailError) throw new Error(emailError);

  const key = usernameKey(params.username);
  if (usersByKey.has(key)) {
    throw new Error("That username is taken");
  }

  const salt = randomBytes(16);
  const user: StoredUser = {
    id: `user_${randomBytes(8).toString("hex")}`,
    username: normalizeUsername(params.username),
    usernameKey: key,
    email,
    passwordSalt: salt.toString("hex"),
    passwordHash: await hashPassword(params.password, salt),
    sageAddress: "",
    sagePubkey: "",
    createdAt: new Date().toISOString(),
  };
  usersByKey.set(key, user);
  usersById.set(user.id, user);
  await persist();
  return user;
}

export async function loginUser(username: string, password: string): Promise<StoredUser> {
  await loadUsers();
  const user = usersByKey.get(usernameKey(username));
  if (!user) {
    throw new Error("Unknown username or password");
  }
  const salt = Buffer.from(user.passwordSalt, "hex");
  const hash = Buffer.from(user.passwordHash, "hex");
  const next = Buffer.from(await hashPassword(password, salt), "hex");
  if (hash.length !== next.length || !timingSafeEqual(hash, next)) {
    throw new Error("Unknown username or password");
  }
  return user;
}

export async function getUserById(id: string): Promise<StoredUser | undefined> {
  await loadUsers();
  return usersById.get(id);
}

export async function setUserSageLink(
  userId: string,
  sageAddress: string,
  sagePubkey: string,
): Promise<StoredUser> {
  await loadUsers();
  const user = usersById.get(userId);
  if (!user) throw new Error("Account not found");
  user.sageAddress = sageAddress;
  user.sagePubkey = sagePubkey;
  usersById.set(user.id, user);
  usersByKey.set(user.usernameKey, user);
  await persist();
  return user;
}

export function publicUser(user: StoredUser): {
  playerId: string;
  username: string;
  email: string;
  sageLinked: boolean;
  sageAddress: string;
} {
  return {
    playerId: user.id,
    username: user.username,
    email: user.email,
    sageLinked: Boolean(user.sagePubkey),
    sageAddress: user.sageAddress,
  };
}

export function resetUsersForTests(): void {
  usersByKey.clear();
  usersById.clear();
  loaded = true;
}
