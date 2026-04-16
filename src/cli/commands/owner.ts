interface AddOpts {
  email: string;
  slack?: string;
  json?: boolean;
}

interface RemoveOpts {
  json?: boolean;
}

interface ListOpts {
  json?: boolean;
}

interface AssignOpts {
  type: string;
  value: string;
  json?: boolean;
}

interface ShowOpts {
  json?: boolean;
}

export async function runOwnerAdd(name: string, opts: AddOpts): Promise<void> {
  const { addOwner } = await import('#app/application/manageOwner.js');
  try {
    const owner = addOwner({
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
  const { removeOwner } = await import('#app/application/manageOwner.js');
  try {
    const success = removeOwner(parseInt(id, 10));
    if (success) {
      process.stdout.write(`Owner ${id} soft-deleted\n`);
    } else {
      process.stderr.write(`Owner ${id} not found\n`);
      process.exitCode = 1;
    }
  } catch (err) {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
    process.exitCode = 1;
  }
}

export async function runOwnerList(opts: ListOpts): Promise<void> {
  const { listOwners } = await import('#app/application/manageOwner.js');
  try {
    const owners = listOwners();
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
  const { assignOwner } = await import('#app/application/manageOwner.js');
  try {
    const assignment = assignOwner(parseInt(ownerId, 10), opts.type, opts.value);
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

export async function runOwnerUnassign(assignmentId: string): Promise<void> {
  const { unassignOwner } = await import('#app/application/manageOwner.js');
  try {
    unassignOwner(parseInt(assignmentId, 10));
    process.stdout.write(`Assignment ${assignmentId} removed\n`);
  } catch (err) {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
    process.exitCode = 1;
  }
}

export async function runOwnerShow(id: string, opts: ShowOpts): Promise<void> {
  const { getOwnerWithAssignments } = await import('#app/application/manageOwner.js');
  try {
    const result = getOwnerWithAssignments(parseInt(id, 10));
    if (!result) {
      process.stderr.write(`Owner ${id} not found\n`);
      process.exitCode = 1;
      return;
    }

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
