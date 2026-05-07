import mysql from 'mysql2/promise';

const requiredEnv = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  database: requiredEnv('DB_NAME'),
  user: requiredEnv('DB_USER'),
  password: requiredEnv('DB_PASSWORD'),
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
  connectTimeout: 10000,
  timezone: 'Z',
});

export async function getConnection() {
  const connection = await pool.getConnection();
  await connection.query("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci");
  await connection.query("SET time_zone = '+00:00'");
  return connection;
}
