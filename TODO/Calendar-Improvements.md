# Calendar UI Improvements

## Resizeable Calendar Layer

The Calendar layer that opens when clicking on the date in the statusbar should be resizable. It is already movable

## Store the original mail together with the calendar event

When creating a calendar event from an email, the original email should be stored together with the calendar event. I need this information even when the original mail is deleted.

This mail should be displayed below the event data.

The display should be almost the same as the display of the mail and the event in the right pane (thread view), but in reverse order (event data first, then mail data), except the very first row: folder badges, categories, tags, topics should not be displayed (and not saved, we need just the standard mail fields: subject, To/Cc/Bcc/From, date, body). No attachments. Mail action menu should not be available.

## Legacy feature "Automatically create reminders" ✅ confirmed removed ([PR #19](https://github.com/paulwellnerbou/noctua-mail/pull/19))

Verified 2026-04-16: zero code references to `autoCreateCalendarReminders`, `calendarReminderMutations`, or "automatically create reminders" anywhere outside this TODO file. Feature is fully gone — no further action needed.

## Reminders in the lower right status bar

This is a feature we had before we had calendar and events. We still want to separate this as it will be possible in futures to create reminders without events. Right now this is not possible, reminders are always bound to events.

Migrate it from "Reminders" to "UPCOMING" (Reminders&Events):
- The list showing up when clicking on it should show both reminders and events, chronologically sorted. Deduplicate events and reminders should be merged into one entry, of course.
- The title of the very first entry of this list should be visible in the status bar (just like now)
