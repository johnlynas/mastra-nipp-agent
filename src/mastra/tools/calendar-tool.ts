import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { callMcpTool, type RequestContextLike } from './dispatch';

/** `calendar` domain tool — calendars, events and notifications. Tenant-scoped (orgId required in practice). */
const ACTION_MAP: Record<string, string> = {
  list_calendars: 'calendar_organizations_calendar_list',
  get_calendar: 'calendar_organizations_calendar_get',
  create_calendar: 'calendar_organizations_calendar_calendar',
  update_calendar: 'calendar_organizations_calendar_update',
  delete_calendar: 'calendar_organizations_calendar_delete',
  list_events: 'calevent_organizations_calendar_events_list',
  get_event: 'calevent_organizations_calendar_events_get',
  create_event: 'calevent_organizations_calendar_events_calendar_events',
  update_event: 'calevent_organizations_calendar_events_update',
  delete_event: 'calevent_organizations_calendar_events_delete',
  upcoming_events: 'calevent_organizations_calendar_events_upcoming_list',
  notification_history: 'calnotif_organizations_calendar_notifications_history_list',
};

/** Single-event actions whose MCP endpoint is `/api/organizations/{orgId}/calendar-events/{id}`.
 *  The event id must travel as `id`; if the model put it in `orgId` (or omitted
 *  orgId entirely and the dispatcher defaulted orgId to the caller's active org),
 *  normalize back so the right tenant is addressed. */
const SINGLE_EVENT_ACTIONS = new Set(['get_event', 'update_event', 'delete_event']);

export const calendarTool = createTool({
  id: 'calendar',
  description:
    'Manage calendars, events and notifications (tenant-scoped). Calendar actions: list_calendars, get_calendar, create_calendar, update_calendar, delete_calendar (use `id`). ' +
    'Event actions: list_events, get_event, create_event, update_event, delete_event, upcoming_events (use `id`; create requires title, startDate, endDate, calendarId; recurrence is an RFC5545 rrule). ' +
    'IMPORTANT for single-event actions (get_event/update_event/delete_event): pass the event id ONLY in `id` and target the tenant via `orgId`. Never put the event id in `orgId` — orgId is the organization path param, and a wrong org yields 404 "Event ... not found" even though the event exists. ' +
    'If you do not know the tenant, call list_events without orgId (defaults to the caller\'s active organization) to locate the event and read its calendar/org context first. ' +
    'notification_history lists the org\'s notification send history. Omit orgId to act on the caller\'s active organization.',
  inputSchema: z.object({
    action: z.enum(['list_calendars', 'get_calendar', 'create_calendar', 'update_calendar', 'delete_calendar', 'list_events', 'get_event', 'create_event', 'update_event', 'delete_event', 'upcoming_events', 'notification_history']),
    orgId: z.string().optional(),
    id: z.string().optional(),
    name: z.string().optional(),
    description: z.string().nullable().optional(),
    color: z.string().nullable().optional(),
    calendarId: z.union([z.string(), z.number()]).optional(),
    title: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    start: z.union([z.string(), z.number()]).optional(),
    end: z.union([z.string(), z.number()]).optional(),
    eventType: z.union([z.string(), z.number()]).optional(),
    propertyId: z.string().nullable().optional(),
    recurrence: z.unknown().optional(),
    editScope: z.string().optional(),
    clickedDate: z.string().optional(),
    excludedDate: z.string().optional(),
    limit: z.union([z.string(), z.number()]).optional(),
    page: z.union([z.string(), z.number()]).optional(),
    pageSize: z.union([z.string(), z.number()]).optional(),
  }),
  execute: async (input, options) => {
    const toolId = ACTION_MAP[input.action];
    if (!toolId) return { success: false, error: `Unknown calendar action '${input.action}'.` };

    // Normalize single-event actions: the event id belongs in `id`, never in
    // `orgId`. The MCP endpoint is /api/organizations/{orgId}/calendar-events/{id},
    // so an event id sitting in orgId makes the portal look for the event under a
    // nonexistent organization → 404 "Event ... not found" (observed live: delete
    // failed with exactly that while get_event on the same id succeeded).
    let payload = input as Record<string, unknown>;
    if (SINGLE_EVENT_ACTIONS.has(input.action)) {
      const eventId = typeof input.id === 'string' && input.id ? input.id : undefined;
      if (eventId && typeof input.orgId === 'string' && input.orgId === eventId) {
        payload = { ...input, orgId: undefined }; // drop the bogus orgId → dispatcher defaults to caller's active org
      } else if (!eventId && typeof input.orgId === 'string' && input.orgId) {
        payload = { ...input, id: input.orgId, orgId: undefined }; // model put the event id in orgId — move it to `id`
      }
    }

    return callMcpTool(toolId, payload, { requestContext: options?.requestContext as RequestContextLike | undefined });
  },
});
