import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

let localEnvLoaded = false;

function loadLocalEnv() {
  if (localEnvLoaded) return;
  localEnvLoaded = true;

  const webRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const candidates = [
    path.join(process.cwd(), '.env.local'),
    path.join(process.cwd(), 'web', '.env.local'),
    path.join(webRoot, '.env.local'),
  ];
  const envPath = candidates.find((candidate) => existsSync(candidate));
  if (!envPath) return;

  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    if (!key || process.env[key] !== undefined) continue;

    process.env[key] = rawValue.replace(/^['"]|['"]$/g, '');
  }
}

const requiredEnv = (name) => {
  loadLocalEnv();
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

let pool;

function getPool() {
  loadLocalEnv();
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT || 3306),
      database: requiredEnv('DB_NAME'),
      user: requiredEnv('DB_USER'),
      password: process.env.DB_PASSWORD || '',
      charset: 'utf8mb4',
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0,
      connectTimeout: 10000,
      timezone: 'Z',
    });
  }
  return pool;
}

export async function getConnection() {
  const connection = await getPool().getConnection();
  await connection.query("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci");
  await connection.query("SET time_zone = '+00:00'");
  return connection;
}

export function databaseErrorMessage(error) {
  if (error?.message?.startsWith('Missing required environment variable:')) {
    return error.message;
  }
  if (error?.code === 'ECONNREFUSED') {
    return 'Database connection refused. Please check that MySQL is running and DB_HOST/DB_PORT are correct.';
  }
  if (error?.code === 'ER_ACCESS_DENIED_ERROR') {
    return 'Database access denied. Please check DB_USER and DB_PASSWORD.';
  }
  if (error?.code === 'ER_BAD_DB_ERROR') {
    return 'Database does not exist. Please check DB_NAME.';
  }
  return null;
}
