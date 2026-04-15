import type { Database } from 'better-sqlite3';

/**
 * Thin `{ get, update }` facade over a writable better-sqlite3 handle,
 * matching the cache interface expected by acknowledgeVuln / resolveVuln.
 */
export function createCacheFacade(db: Database) {
  const getStmt = db.prepare('SELECT * FROM vulnerabilities WHERE cve_id = ?');

  function get(cveId: string) {
    const row = getStmt.get(cveId) as Record<string, unknown> | undefined;
    if (!row) return null;
    const affected = row.affected_technologies;
    row.affectedTechnologies =
      typeof affected === 'string' && affected.length > 0 ? JSON.parse(affected) : [];
    return row;
  }

  function update(cveId: string, updates: Record<string, unknown>) {
    const fields: string[] = [];
    const values: Record<string, unknown> = { cveId };

    if (updates.status !== undefined) {
      fields.push('status = @status');
      values.status = updates.status;
    }
    if (updates.statusChangedBy !== undefined) {
      fields.push('status_changed_by = @statusChangedBy');
      values.statusChangedBy = updates.statusChangedBy;
    }
    if (updates.statusChangedAt !== undefined) {
      fields.push('status_changed_at = @statusChangedAt');
      values.statusChangedAt = updates.statusChangedAt;
    }
    if (updates.resolvedAt !== undefined) {
      fields.push('resolved_at = @resolvedAt');
      values.resolvedAt = updates.resolvedAt;
    }
    if (updates.clientExplanation !== undefined) {
      fields.push('client_explanation = @clientExplanation');
      values.clientExplanation = updates.clientExplanation;
    }

    if (fields.length === 0) return;

    const sql = `UPDATE vulnerabilities SET ${fields.join(', ')} WHERE cve_id = @cveId`;
    db.prepare(sql).run(values);
  }

  return { get, update };
}
