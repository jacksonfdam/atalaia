import { query, queryAll } from '../db/pool.js';
import logger from '../logger.js';

/**
 * Operator overrides for the registry's default on/off state.
 *
 * Only changed rows are stored. A source the operator never touched keeps
 * following the default in the registry, so revising a default in code still
 * reaches existing installations.
 */

/** @returns {Promise<Map<string, { enabled: boolean, updatedAt: string, updatedBy: string|null }>>} */
export async function listOverrides() {
    try {
        const rows = await queryAll('SELECT name, enabled, updated_at, updated_by FROM feed_state');
        return new Map(
            rows.map(row => [
                row.name,
                { enabled: row.enabled, updatedAt: row.updated_at, updatedBy: row.updated_by },
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
export async function setEnabled(name, enabled, changedBy) {
    await query(
        `INSERT INTO feed_state (name, enabled, updated_at, updated_by)
         VALUES (@name, @enabled, now(), @changedBy)
         ON CONFLICT (name) DO UPDATE SET
            enabled = excluded.enabled,
            updated_at = excluded.updated_at,
            updated_by = excluded.updated_by`,
        { name, enabled: Boolean(enabled), changedBy: changedBy ?? null }
    );

    logger.info({ feed: name, enabled, changedBy }, 'Feed state changed');
}

/** Drop the override so the source follows the registry default again. */
export async function clearOverride(name) {
    await query('DELETE FROM feed_state WHERE name = @name', { name });
    logger.info({ feed: name }, 'Feed override cleared');
}
