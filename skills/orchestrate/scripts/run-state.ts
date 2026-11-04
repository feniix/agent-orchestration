// Pure run lifecycle. External observations are assertions by the caller, not security proofs.
export type Ticket = {
  id: string; blockers: string[]; modules: string[];
  phase: 'pending' | 'running' | 'blocked' | 'review' | 'merge-authorized' | 'merged';
  attempt: number; head?: string; pr?: number;
};
export type Definition = {
  id: string; concurrency: number; mergeAuthority: boolean; maxRecoveries: number;
  tickets: { id: string; blockers: string[]; modules: string[] }[];
};
export type Event = { type: string; [key: string]: unknown };
export type Run = {
  definition: Definition; revision: number;
  mode: 'paused' | 'active' | 'waiting-owner' | 'waiting-workers' | 'attention' | 'finished';
  reason: string; tickets: Ticket[]; recoveries: number;
  recovery?: { token: string; at: number; outcome: 'pending' | 'delivered' | 'not-delivered' };
};
export function requireThat(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function word(value: unknown, name: string): string {
  requireThat(typeof value === 'string' && value.trim().length > 0, `${name} must be nonempty`);
  return value;
}
function integer(value: unknown, name: string, min = 0): number {
  requireThat(Number.isSafeInteger(value) && Number(value) >= min, `${name} must be an integer >= ${min}`);
  return Number(value);
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(x => typeof x === 'string' && x.trim().length > 0)
    && new Set(value).size === value.length;
}
export function initialize(input: unknown): Run {
  requireThat(input && typeof input === 'object', 'definition must be an object');
  const d = input as Definition;
  word(d.id, 'run id'); integer(d.concurrency, 'concurrency', 1); integer(d.maxRecoveries, 'maxRecoveries', 1);
  requireThat(typeof d.mergeAuthority === 'boolean', 'mergeAuthority must be explicit');
  requireThat(Array.isArray(d.tickets) && d.tickets.length > 0, 'tickets required');
  const ids = new Set<string>();
  for (const t of d.tickets) {
    requireThat(t && typeof t === 'object', 'invalid ticket');
    word(t.id, 'ticket id'); requireThat(!ids.has(t.id), 'duplicate ticket'); ids.add(t.id);
    requireThat(strings(t.blockers) && strings(t.modules), 'blockers/modules must be unique strings');
  }
  const visited = new Set<string>(), visiting = new Set<string>();
  function visit(id: string) {
    requireThat(ids.has(id), `unknown blocker ${id}`);
    requireThat(!visiting.has(id), 'dependency cycle');
    if (visited.has(id)) return;
    visiting.add(id);
    d.tickets.find(t => t.id === id)!.blockers.forEach(visit);
    visiting.delete(id); visited.add(id);
  }
  ids.forEach(visit);
  return { definition: structuredClone(d), revision: 0, mode: 'paused', reason: 'Awaiting owner start',
    tickets: d.tickets.map(t => ({ id: t.id, blockers: [...t.blockers], modules: [...t.modules], phase: 'pending', attempt: 0 })), recoveries: 0 };
}
function occupies(t: Ticket) { return !['pending', 'merged'].includes(t.phase); }
export function eligibility(run: Run): { id: string; reasons: string[] }[] {
  const active = run.tickets.filter(occupies);
  return run.tickets.filter(t => t.phase === 'pending').map(t => {
    const reasons: string[] = [];
    if (run.mode !== 'active') reasons.push(`run ${run.mode}`);
    if (active.length >= run.definition.concurrency) reasons.push('concurrency limit');
    for (const id of t.blockers) if (run.tickets.find(b => b.id === id)?.phase !== 'merged') reasons.push(`blocked by ${id}`);
    for (const a of active) if (a.modules.some(m => t.modules.includes(m))) reasons.push(`module conflict with ${a.id}`);
    return { id: t.id, reasons };
  });
}
export function transition(current: Run, event: Event, at: number): Run {
  requireThat(event && typeof event === 'object', 'event required');
  word(event.type, 'event type'); integer(at, 'timestamp');
  const run = structuredClone(current);
  requireThat(run.mode !== 'finished', 'run finished');
  const active = () => requireThat(run.mode === 'active', 'run must be active');
  const reason = () => word(event.reason, 'reason');
  switch (event.type) {
    case 'start':
      requireThat(['paused', 'waiting-owner', 'attention'].includes(run.mode), 'not awaiting owner');
      requireThat(!run.recovery || run.recovery.outcome !== 'pending', 'reconcile pending recovery first');
      run.mode = 'active'; run.reason = reason(); break;
    case 'pause': run.mode = 'paused'; run.reason = reason(); break;
    case 'wait-owner': run.mode = 'waiting-owner'; run.reason = reason(); break;
    case 'wait-workers':
      active(); requireThat(run.tickets.some(occupies), 'no active workers');
      run.mode = 'waiting-workers'; run.reason = reason(); break;
    case 'wake':
      requireThat(run.mode === 'waiting-workers', 'not waiting for workers');
      run.mode = 'active'; run.reason = reason(); break;
    case 'attention': run.mode = 'attention'; run.reason = reason(); break;
    case 'recover':
      requireThat(['active', 'waiting-workers'].includes(run.mode), 'recovery forbidden in this mode');
      requireThat(!run.recovery || run.recovery.outcome !== 'pending', 'pending recovery');
      requireThat(run.recoveries < run.definition.maxRecoveries, 'recovery budget exhausted');
      run.recoveries++;
      run.recovery = { token: word(event.token, 'token'), at, outcome: 'pending' }; break;
    case 'recovery-result':
      requireThat(run.recovery?.token === event.token, 'stale recovery token');
      requireThat(run.recovery?.outcome === 'pending', 'recovery already resolved');
      requireThat(['delivered', 'not-delivered', 'uncertain'].includes(String(event.outcome)), 'invalid recovery result');
      if (event.outcome === 'uncertain') { run.mode = 'attention'; run.reason = reason(); }
      else run.recovery.outcome = event.outcome as 'delivered' | 'not-delivered';
      break;
    case 'reconcile-recovery':
      requireThat(run.recovery?.token === event.token && run.recovery.outcome === 'pending', 'no matching pending recovery');
      requireThat(['delivered', 'not-delivered'].includes(String(event.outcome)), 'invalid reconciliation');
      run.recovery.outcome = event.outcome as 'delivered' | 'not-delivered';
      run.mode = 'paused'; run.reason = reason(); break;
    case 'finish':
      requireThat(run.tickets.every(t => t.phase === 'merged'), 'unfinished tickets');
      run.mode = 'finished'; run.reason = 'All tickets merged'; break;
    default: {
      const ticket = run.tickets.find(t => t.id === event.ticket);
      requireThat(ticket, 'unknown ticket');
      if (event.type === 'dispatch') {
        const entry = eligibility(run).find(t => t.id === ticket.id);
        requireThat(entry && entry.reasons.length === 0, entry?.reasons.join('; ') || 'not pending');
        ticket.phase = 'running'; ticket.attempt++;
      } else {
        requireThat(integer(event.attempt, 'attempt', 1) === ticket.attempt, 'stale attempt');
        switch (event.type) {
          case 'block':
            requireThat(['running', 'review'].includes(ticket.phase), 'cannot block this phase');
            ticket.phase = 'blocked'; delete ticket.head; delete ticket.pr; reason(); break;
          case 'rework':
            active(); requireThat(['blocked', 'review'].includes(ticket.phase), 'cannot rework this phase');
            ticket.phase = 'running'; ticket.attempt++; delete ticket.head; delete ticket.pr; reason(); break;
          case 'ready':
            requireThat(ticket.phase === 'running', 'ticket not running');
            requireThat(typeof event.head === 'string' && /^[0-9a-f]{40}$/.test(event.head), 'full head SHA required');
            ticket.pr = integer(event.pr, 'pr', 1); ticket.head = event.head; ticket.phase = 'review'; break;
          case 'authorize-merge':
            active(); requireThat(run.definition.mergeAuthority, 'no merge authority');
            requireThat(ticket.phase === 'review' && ticket.head === event.head, 'stale merge head or phase');
            requireThat(!run.tickets.some(t => t.phase === 'merge-authorized'), 'another merge awaits readback');
            word(event.evidence, 'evidence reference'); ticket.phase = 'merge-authorized'; break;
          case 'merge-not-applied':
            requireThat(ticket.phase === 'merge-authorized', 'no outstanding merge');
            word(event.evidence, 'GitHub readback confirming PR remains open');
            ticket.phase = 'review'; break;
          case 'merged':
            requireThat(ticket.phase === 'merge-authorized' && ticket.head === event.head && ticket.pr === event.pr,
              'merge readback does not match authorization');
            word(event.evidence, 'merge readback reference'); ticket.phase = 'merged'; break;
          default: throw new Error(`unknown event ${event.type}`);
        }
      }
    }
  }
  run.revision++;
  return run;
}
