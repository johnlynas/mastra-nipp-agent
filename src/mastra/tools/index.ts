/**
 * Domain tool registry (DESIGN §6.1). Re-exports all 15 domain tools and the
 * shared dispatcher. The agent registers these in place of the Phase 2 smoke tool.
 */
export { callMcpTool, invalidateMcpToolCache, type DispatchResult, type RequestContextLike } from './dispatch';
export { orgTool } from './org-tool';
export { userTool } from './user-tool';
export { roleTool } from './role-tool';
export { permTool } from './perm-tool';
export { teamTool } from './team-tool';
export { workOrdersTool } from './work-orders-tool';
export { contractorsTool } from './contractors-tool';
export { invoicesTool } from './invoices-tool';
export { quotesTool } from './quotes-tool';
export { resourcesTool } from './resources-tool';
export { unitsTool } from './units-tool';
export { calendarTool } from './calendar-tool';
export { jobsTool } from './jobs-tool';
export { systemTool } from './system-tool';
export { securityTool } from './security-tool';

import { orgTool } from './org-tool';
import { userTool } from './user-tool';
import { roleTool } from './role-tool';
import { permTool } from './perm-tool';
import { teamTool } from './team-tool';
import { workOrdersTool } from './work-orders-tool';
import { contractorsTool } from './contractors-tool';
import { invoicesTool } from './invoices-tool';
import { quotesTool } from './quotes-tool';
import { resourcesTool } from './resources-tool';
import { unitsTool } from './units-tool';
import { calendarTool } from './calendar-tool';
import { jobsTool } from './jobs-tool';
import { systemTool } from './system-tool';
import { securityTool } from './security-tool';

/** All 15 domain tools, keyed by id — ready to spread onto the agent. */
export const domainTools = {
  org: orgTool,
  user: userTool,
  role: roleTool,
  perm: permTool,
  team: teamTool,
  work_orders: workOrdersTool,
  contractors: contractorsTool,
  invoices: invoicesTool,
  quotes: quotesTool,
  resources: resourcesTool,
  units: unitsTool,
  calendar: calendarTool,
  jobs: jobsTool,
  system: systemTool,
  security: securityTool,
};
