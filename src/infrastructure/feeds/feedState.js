import { getDb } from '../cache/sqliteCache.js';
import logger from '../logger.js';

/**
 * Operator overrides for the registry's default on/off state.
 *
 * Only changed rows are stored. A source the operator never touched keeps
 * following the default in the registry, so revising a default in code still
 * reaches existing installations.
 */

/** @returns {Map<string, { enabled: boolean, updatedAt: string, updatedBy: string|null }>} */
export function listOverrides() {
    try {
        const rows = getDb().prepare('SELECT name, enabled, updated_at, updated_by FROM feed_state').all();
        return new Map(
            rows.map(row => [
                row.name,
                { enabled: row.enabled === 1, updatedAt: row.updated_at, updatedBy: row.updated_by },
            ])
        );
    } catch (err) {
        // An un-migrated database must degrade to the registry defaults rather
        // than take the monitoring cycle down.
        logger.warn({ err }, 'Failed to read feed overrides, falling back to registry defaults');
        return new Map();
    }
}

/**
 * @param {string} name
 * @param {boolean} enabled
 * @param {string} [changedBy]
 */
export function setEnabled(name, enabled, changedBy) {
    getDb()
        .prepare(
            `INSERT INTO feed_state (name, enabled, updated_at, updated_by)
             VALUES (@name, @enabled, datetime('now'), @changedBy)
             ON CONFLICT(name) DO UPDATE SET
                enabled = excluded.enabled,
                updated_at = excluded.updated_at,
                updated_by = excluded.updated_by`
        )
        .run({ name, enabled: enabled ? 1 : 0, changedBy: changedBy ?? null });

    logger.info({ feed: name, enabled, changedBy }, 'Feed state changed');
}

/** Drop the override so the source follows the registry default again. */
export function clearOverride(name) {
    getDb().prepare('DELETE FROM feed_state WHERE name = ?').run(name);
    logger.info({ feed: name }, 'Feed override cleared');
}
