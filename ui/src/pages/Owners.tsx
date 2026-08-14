import { Fragment, useState, type FormEvent } from 'react';
import { api } from '../api/client';
import { useApi } from '../hooks/useApi';
import { Window, Body, Loading, Notice, Empty } from '../components/ui';
import type { Assignment, Owner } from '../types';

const TARGET_TYPES = ['ecosystem', 'dependency', 'repository'];

/**
 * Owners: the routing table on top of the Slack integration.
 *
 * A person, the ecosystems and repositories they answer for, and the Slack
 * member ID a direct message goes to — which is why this lives inside the Slack
 * settings rather than as a page of its own.
 */
export function Owners({ onAuthLost }: { onAuthLost: () => void }) {
  const list = useApi<{ count: number; owners: Owner[] }>('/owners', onAuthLost);
  const [form, setForm] = useState({ name: '', email: '', slackUserId: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [assignments, setAssignments] = useState<Record<number, Assignment[]>>({});
  const [newAssignment, setNewAssignment] = useState({ targetType: 'ecosystem', targetValue: '' });

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ kind: 'ok', text: await action() });
      list.reload();
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function loadAssignments(ownerId: number) {
    const res = await api.get<{ assignments: Assignment[] }>(`/owners/${ownerId}`);
    setAssignments(prev => ({ ...prev, [ownerId]: res.assignments }));
  }

  async function toggle(owner: Owner) {
    if (expanded === owner.id) {
      setExpanded(null);
      return;
    }
    setExpanded(owner.id);
    if (!assignments[owner.id]) {
      try {
        await loadAssignments(owner.id);
      } catch (err) {
        setMessage({ kind: 'error', text: (err as Error).message });
      }
    }
  }

  async function addOwner(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const owner = await api.post<Owner>('/owners', form);
      setForm({ name: '', email: '', slackUserId: '' });
      return `Added ${owner.name}`;
    });
  }

  return (
    <Window
      title="OWNERS.CFG"
      note={list.data ? `${list.data.count} owners` : undefined}
      accent="var(--accent-secondary)"
    >
      <Body>
        <p className="muted" style={{ marginBottom: '0.5rem' }}>
          Owners are matched to vulnerabilities through their assignments — an ecosystem, a specific
          dependency, or a repository URL.
        </p>

        <form className="toolbar" onSubmit={addOwner}>
          <label>
            Name
            <input
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              required
            />
          </label>
          <label>
            Email
            <input
              type="email"
              value={form.email}
              onChange={e => setForm({ ...form, email: e.target.value })}
              required
            />
          </label>
          <label>
            Slack user id
            <input
              value={form.slackUserId}
              onChange={e => setForm({ ...form, slackUserId: e.target.value })}
              placeholder="U12345"
              size={10}
            />
          </label>
          <button className="primary" type="submit" disabled={busy}>
            Add owner
          </button>
        </form>

        {message ? <Notice kind={message.kind}>{message.text}</Notice> : null}
        {list.error ? <Notice kind="error">{list.error}</Notice> : null}
        {list.loading ? <Loading what="owners" /> : null}

        {list.data && list.data.owners.length === 0 ? (
          <Empty>No owners configured. Without one, nobody is notified for a matching CVE.</Empty>
        ) : null}

        {list.data && list.data.owners.length > 0 ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Slack</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.data.owners.map(owner => (
                  <Fragment key={owner.id}>
                    <tr>
                      <td>{owner.name}</td>
                      <td className="mono">{owner.email}</td>
                      <td className="tight mono">{owner.slack_user_id ?? '—'}</td>
                      <td className="tight">
                        <span className="cell-actions">
                          <button onClick={() => toggle(owner)}>
                            {expanded === owner.id ? 'Hide' : 'Assignments'}
                          </button>
                          <button
                            className="danger"
                            disabled={busy}
                            onClick={() =>
                              run(async () => {
                                await api.del(`/owners/${owner.id}`);
                                return `Removed ${owner.name}`;
                              })
                            }
                          >
                            Remove
                          </button>
                        </span>
                      </td>
                    </tr>

                    {expanded === owner.id ? (
                      <tr>
                        <td colSpan={4}>
                          {!assignments[owner.id] ? (
                            <Loading what="assignments" />
                          ) : (
                            <>
                              {assignments[owner.id].length === 0 ? (
                                <p className="muted">No assignments yet.</p>
                              ) : (
                                <ul>
                                  {assignments[owner.id].map(assignment => (
                                    <li key={assignment.id} className="row">
                                      <span className="mono">
                                        {assignment.target_type}: {assignment.target_value}
                                      </span>
                                      <button
                                        onClick={async () => {
                                          await api.del(
                                            `/owners/${owner.id}/assignments/${assignment.id}`
                                          );
                                          await loadAssignments(owner.id);
                                        }}
                                      >
                                        Remove
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              )}

                              <div className="toolbar" style={{ marginTop: '0.5rem' }}>
                                <label>
                                  Type
                                  <select
                                    value={newAssignment.targetType}
                                    onChange={e =>
                                      setNewAssignment({
                                        ...newAssignment,
                                        targetType: e.target.value,
                                      })
                                    }
                                  >
                                    {TARGET_TYPES.map(type => (
                                      <option key={type} value={type}>
                                        {type}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <label>
                                  Value
                                  <input
                                    value={newAssignment.targetValue}
                                    onChange={e =>
                                      setNewAssignment({
                                        ...newAssignment,
                                        targetValue: e.target.value,
                                      })
                                    }
                                    placeholder="npm, express, https://github.com/org/repo"
                                    size={30}
                                  />
                                </label>
                                <button
                                  disabled={!newAssignment.targetValue}
                                  onClick={async () => {
                                    try {
                                      await api.post(
                                        `/owners/${owner.id}/assignments`,
                                        newAssignment
                                      );
                                      setNewAssignment({ targetType: 'ecosystem', targetValue: '' });
                                      await loadAssignments(owner.id);
                                    } catch (err) {
                                      setMessage({ kind: 'error', text: (err as Error).message });
                                    }
                                  }}
                                >
                                  Assign
                                </button>
                              </div>
                            </>
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Body>
    </Window>
  );
}
