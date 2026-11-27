import { describe, expect, it, vi } from 'vitest';

type DispatchCall = [toolId: string, payload: Record<string, unknown>, opts: object];
const calls: DispatchCall[] = [];
vi.mock('@/mastra/tools/dispatch', () => ({
  callMcpTool: async (toolId: string, payload: Record<string, unknown>, opts: object) => {
    calls.push([toolId, payload, opts]);
    return { success: true, data: {} };
  },
}));

import { calendarTool } from '@/mastra/tools/calendar-tool';

/** Run the tool's execute() and return the most recent dispatch call. */
async function run(input: Record<string, unknown>): Promise<DispatchCall> {
  await (calendarTool as { execute: (i: unknown, o?: unknown) => Promise<unknown> }).execute(
    input,
    { requestContext: undefined },
  );
  return calls[calls.length - 1];
}

describe('calendar tool — single-event orgId normalization', () => {
  it.each(['get_event', 'update_event', 'delete_event'] as const)(
    '%s: event id in `orgId` is moved to `id`; orgId falls back to the caller default',
    async (action) => {
      calls.length = 0;
      const [toolId, payload] = await run({ action, orgId: 'cmwxy2hqm0005qop9iqwi63qi' });
      expect(toolId).toBe(`calevent_organizations_calendar_events_${action === 'get_event' ? 'get' : action.replace('_event', '')}`);
      expect(payload.id).toBe('cmwxy2hqm0005qop9iqwi63qi');
      expect(payload.orgId).toBeUndefined();
    },
  );

  it.each(['get_event', 'update_event', 'delete_event'] as const)(
    '%s: `orgId` duplicated into `id` is dropped (the dispatcher defaults orgId to the caller\'s active org)',
    async (action) => {
      calls.length = 0;
      const [, payload] = await run({ action, id: 'evt-1', orgId: 'evt-1' });
      expect(payload.id).toBe('evt-1');
      expect(payload.orgId).toBeUndefined();
    },
  );

  it.each(['get_event', 'update_event', 'delete_event'] as const)(
    '%s: a real tenant orgId + event id pass through untouched',
    async (action) => {
      calls.length = 0;
      const [, payload] = await run({ action, id: 'evt-1', orgId: 'cmwxnttde0005wip9pnbpmzk2' });
      expect(payload.id).toBe('evt-1');
      expect(payload.orgId).toBe('cmwxnttde0005wip9pnbpmzk2');
    },
  );

  it.each(['get_event', 'update_event', 'delete_event'] as const)(
    '%s: omitted orgId stays omitted (dispatcher injects the caller\'s active org)',
    async (action) => {
      calls.length = 0;
      const [, payload] = await run({ action, id: 'evt-1' });
      expect(payload.id).toBe('evt-1');
      expect(payload.orgId).toBeUndefined();
    },
  );

  it('list_events: orgId is never touched (it is a genuine tenant param)', async () => {
    calls.length = 0;
    const [, payload] = await run({ action: 'list_events', orgId: 'org-1' });
    expect(payload.orgId).toBe('org-1');
    expect(payload.id).toBeUndefined();
  });

  it('create_event: id/orgId pass through untouched (no single-event normalization)', async () => {
    calls.length = 0;
    const [, payload] = await run({ action: 'create_event', orgId: 'org-1', title: 'X' });
    expect(payload.orgId).toBe('org-1');
    expect(payload.title).toBe('X');
  });

  it('unknown action never dispatches', async () => {
    calls.length = 0;
    const result = (await (calendarTool as { execute: (i: unknown, o?: unknown) => Promise<unknown> }).execute(
      { action: 'nope' },
      {},
    )) as Record<string, unknown>;
    expect(result.success).not.toBe(true);
    expect(calls.length).toBe(0);
  });
});
