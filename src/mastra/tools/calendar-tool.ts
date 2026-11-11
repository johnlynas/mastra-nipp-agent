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

export const calendarTool = createTool({
  id: 'calendar',
  description:
    'Manage calendars, events and notifications (tenant-scoped). Calendar actions: list_calendars, get_calendar, create_calendar, update_calendar, delete_calendar (use `id`). ' +
    'Event actions: list_events, get_event, create_event, update_event, delete_event, upcoming_events (use `id`; create requires title, startDate, endDate, calendarId; recurrence is an RFC5545 rrule). ' +
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
    return callMcpTool(toolId, input as Record<string, unknown>, { requestContext: options?.requestContext as RequestContextLike | undefined });
  },
});
