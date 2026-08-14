import { createClient } from '../lib/api.js';

/** Owner commands, over the API. */

interface BaseOpts {
  json?: boolean;
  api?: string;
}

interface Owner {
  id: number;
  name: string;
  email: string;
  slack_user_id: string | null;
  created_at: string;
}

interface Assignment {
  id: number;
  target_type: string;
  target_value: string;
}

interface AddOpts extends BaseOpts {
  email: string;
  slack?: string;
}

type RemoveOpts = BaseOpts;
type ListOpts = BaseOpts;
type ShowOpts = BaseOpts;

interface AssignOpts extends BaseOpts {
  type: string;
  value: string;
}

export async function runOwnerAdd(name: string, opts: AddOpts): Promise<void> {
  try {
    const api = createClient({ baseUrl: opts.api });
    const owner = await api.post<Owner>('/owners', {
      name,
      email: opts.email,
      slackUserId: opts.slack || null,
    });
    if (opts.json) {
      process.stdout.write(JSON.stringify(owner, null, 2) + '\n');
    } else {
      process.stdout.write(`Added owner: ${owner.name} (${owner.email})\n`);
      process.stdout.write(`  ID: ${owner.id}\n`);
      if (owner.slack_user_id) {
        process.stdout.write(`  Slack: ${owner.slack_user_id}\n`);
      }
    }
  } catch (err) {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
    process.exitCode = 1;
  }
}

export async function runOwnerRemove(id: string, opts: RemoveOpts): Promise<void> {
  try {
    const api = createClient({ baseUrl: opts.api });
    await api.del(`/owners/${encodeURIComponent(id)}`);
    process.stdout.write(`Owner ${id} soft-deleted\n`);
  } catch (err) {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
    process.exitCode = 1;
  }
}

export async function runOwnerList(opts: ListOpts): Promise<void> {
  try {
    const api = createClient({ baseUrl: opts.api });
    const { owners } = await api.get<{ owners: Owner[] }>('/owners');
    if (opts.json) {
      process.stdout.write(JSON.stringify(owners, null, 2) + '\n');
      return;
    }
    if (owners.length === 0) {
      process.stdout.write('No system owners configured.\n');
      return;
    }
    process.stdout.write(`${'ID'.padEnd(5)} ${'Name'.padEnd(25)} ${'Email'.padEnd(35)} ${'Slack'.padEnd(15)}\n`);
    process.stdout.write('-'.repeat(82) + '\n');
    for (const o of owners) {
      process.stdout.write(
        `${String(o.id).padEnd(5)} ${(o.name || '').slice(0, 23).padEnd(25)} ${(o.email || '').slice(0, 33).padEnd(35)} ${(o.slack_user_id || '—').padEnd(15)}\n`
      );
    }
    process.stdout.write(`\nTotal: ${owners.length} owners\n`);
  } catch (err) {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
    process.exitCode = 1;
  }
}

export async function runOwnerAssign(ownerId: string, opts: AssignOpts): Promise<void> {
  try {
    const api = createClient({ baseUrl: opts.api });
    const assignment = await api.post<Assignment>(
      `/owners/${encodeURIComponent(ownerId)}/assignments`,
      { targetType: opts.type, targetValue: opts.value }
    );
    if (opts.json) {
      process.stdout.write(JSON.stringify(assignment, null, 2) + '\n');
    } else {
      process.stdout.write(`Assigned owner ${ownerId} → ${opts.type}:${opts.value}\n`);
    }
  } catch (err) {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
    process.exitCode = 1;
  }
}

export async function runOwnerUnassign(assignmentId: string, opts: BaseOpts = {}): Promise<void> {
  try {
    const api = createClient({ baseUrl: opts.api });
    // The API scopes an assignment to its owner; the id alone is enough to find
    // it, so `0` stands in for "whichever owner holds it".
    await api.del(`/owners/0/assignments/${encodeURIComponent(assignmentId)}`);
    process.stdout.write(`Assignment ${assignmentId} removed\n`);
  } catch (err) {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
    process.exitCode = 1;
  }
}

export async function runOwnerShow(id: string, opts: ShowOpts): Promise<void> {
  try {
    const api = createClient({ baseUrl: opts.api });
    const result = await api.get<{ owner: Owner; assignments: Assignment[] }>(
      `/owners/${encodeURIComponent(id)}`
    );

    if (opts.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      return;
    }

    const { owner, assignments } = result;
    process.stdout.write(`Owner: ${owner.name}\n`);
    process.stdout.write(`  Email: ${owner.email}\n`);
    if (owner.slack_user_id) process.stdout.write(`  Slack: ${owner.slack_user_id}\n`);
    process.stdout.write(`  Created: ${owner.created_at}\n`);
    process.stdout.write(`\nAssignments (${assignments.length}):\n`);

    if (assignments.length === 0) {
      process.stdout.write('  (none)\n');
    } else {
      for (const a of assignments) {
        process.stdout.write(`  [${a.id}] ${a.target_type} → ${a.target_value}\n`);
      }
    }
  } catch (err) {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
    process.exitCode = 1;
  }
}
