import type { CheckInState } from "../check-ins/schema.js";
import type { GoogleCalendarEvent } from "../google-calendar/client.js";
import type { Item } from "../domain/types.js";
import { execution } from "./core.js";

/** Only an authenticated, explicit ID binding is trusted; never parse event prose. */
export function bindCalendarItem(state: CheckInState, item: Item, event: GoogleCalendarEvent, calendarId: string) {
  const matches = (execution(state).calendarBindings ?? []).filter(b => b.calendarId === calendarId
    && (b.eventId === event.id || (b.seriesId && b.seriesId === event.recurringEventId)));
  const link = matches[0]?.goalTreeLink;
  if (!link || matches.some(b => b.goalTreeLink.treeId !== link.treeId || b.goalTreeLink.nodeId !== link.nodeId)) return;
  if (item.goalTreeLink && (item.goalTreeLink.treeId !== link.treeId || item.goalTreeLink.nodeId !== link.nodeId)) return;
  item.goalTreeLink = { ...link };
}
