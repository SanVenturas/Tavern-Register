import fs from 'node:fs/promises';
import path from 'node:path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIRECTORY = path.join(__dirname, '..', 'data');
const DATABASE_FILE = path.join(DATA_DIRECTORY, 'tavern-register.db');

/**
 * Open the SQLite database using a shared helper so connections are short lived.
 * @returns {Promise<import('sqlite').Database>}
 */
export async function openDb() {
    await ensureDataDirectory();
    return open({
        filename: DATABASE_FILE,
        driver: sqlite3.Database,
    });
}

/**
 * Ensure the schema exists before the server handles requests.
 * Should be invoked once during startup.
 * @returns {Promise<void>}
 */
export async function initDb() {
    await ensureDataDirectory();
    const db = await openDb();
    try {
        await db.exec(`
            CREATE TABLE IF NOT EXISTS oauth_bindings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                provider TEXT NOT NULL,
                provider_id TEXT NOT NULL,
                tavern_handle TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(provider, provider_id),
                UNIQUE(tavern_handle)
            );
        `);
    } finally {
        await db.close();
    }
}

/**
 * Look up an OAuth binding by provider + provider_id.
 * @param {string} provider
 * @param {string} providerId
 * @returns {Promise<{ provider: string, provider_id: string, tavern_handle: string | null } | undefined>}
 */
export async function findBinding(provider, providerId) {
    const db = await openDb();
    try {
        return await db.get(
            'SELECT provider, provider_id, tavern_handle FROM oauth_bindings WHERE provider = ? AND provider_id = ?',
            provider,
            providerId,
        );
    } finally {
        await db.close();
    }
}

/**
 * Persist or update a binding between an OAuth identity and a SillyTavern handle.
 * @param {string} provider
 * @param {string} providerId
 * @param {string} tavernHandle
 * @returns {Promise<void>}
 */
export async function upsertBinding(provider, providerId, tavernHandle) {
    const db = await openDb();
    try {
        await db.run(
            `INSERT INTO oauth_bindings (provider, provider_id, tavern_handle)
             VALUES (?, ?, ?)
             ON CONFLICT(provider, provider_id) DO UPDATE SET tavern_handle = excluded.tavern_handle`,
            provider,
            providerId,
            tavernHandle,
        );
    } finally {
        await db.close();
    }
}

async function ensureDataDirectory() {
    try {
        await fs.mkdir(DATA_DIRECTORY, { recursive: true });
    } catch {
        // Ignore errors if directory already exists
    }
}
