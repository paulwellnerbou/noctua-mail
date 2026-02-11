const REMINDER_SYNC_TAG = "noctua-reminders";
const REMINDER_META_CACHE = "noctua-reminder-meta-v1";
const REMINDER_META_URL = "/__noctua/reminder-meta";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function defaultReminderMeta() {
  return {
    accountIds: [],
    deliveredByAccount: {}
  };
}

async function readReminderMeta() {
  try {
    const cache = await caches.open(REMINDER_META_CACHE);
    const response = await cache.match(REMINDER_META_URL);
    if (!response) return defaultReminderMeta();
    const parsed = await response.json();
    if (!parsed || typeof parsed !== "object") return defaultReminderMeta();
    const accountIds = Array.isArray(parsed.accountIds)
      ? parsed.accountIds.filter((value) => typeof value === "string" && value.trim())
      : [];
    const deliveredByAccount =
      parsed.deliveredByAccount && typeof parsed.deliveredByAccount === "object"
        ? parsed.deliveredByAccount
        : {};
    return { accountIds, deliveredByAccount };
  } catch {
    return defaultReminderMeta();
  }
}

async function writeReminderMeta(meta) {
  const cache = await caches.open(REMINDER_META_CACHE);
  await cache.put(
    REMINDER_META_URL,
    new Response(JSON.stringify(meta), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
    })
  );
}

async function postReminderDelivered(accountId, reminderId, triggerAtMs) {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of clients) {
    if ("postMessage" in client) {
      client.postMessage({
        type: "noctua:reminder-delivered",
        accountId,
        reminderId,
        triggerAtMs
      });
    }
  }
}

function normalizeReminder(item) {
  if (!item || typeof item !== "object") return null;
  const id = typeof item.id === "string" ? item.id.trim() : "";
  if (!id) return null;
  const eventTitle = typeof item.eventTitle === "string" ? item.eventTitle.trim() : "";
  const triggerAtMs = Number(item.triggerAtMs);
  const eventStartAtMs = Number(item.eventStartAtMs);
  const nextEventStartAtMs = Number(item.nextEventStartAtMs ?? item.eventStartAtMs);
  const eventEndAtMsRaw = Number(item.eventEndAtMs);
  const durationMs =
    Number.isFinite(eventStartAtMs) &&
    Number.isFinite(eventEndAtMsRaw) &&
    eventEndAtMsRaw > eventStartAtMs
      ? eventEndAtMsRaw - eventStartAtMs
      : 0;
  const endAtMs = durationMs > 0 ? nextEventStartAtMs + durationMs : nextEventStartAtMs;
  const leadLabel = typeof item.leadLabel === "string" ? item.leadLabel.trim() : "";
  const messageId =
    typeof item.messageId === "string" && item.messageId.trim() ? item.messageId.trim() : null;
  if (!Number.isFinite(triggerAtMs) || !Number.isFinite(nextEventStartAtMs)) return null;
  return {
    id,
    eventTitle: eventTitle || "Calendar event",
    eventLocation: typeof item.eventLocation === "string" ? item.eventLocation.trim() : "",
    messageId,
    triggerAtMs,
    nextEventStartAtMs,
    endAtMs,
    leadLabel: leadLabel || "Reminder"
  };
}

async function processReminderNotifications(source) {
  const meta = await readReminderMeta();
  if (!Array.isArray(meta.accountIds) || meta.accountIds.length === 0) return;

  // If app is open, the foreground client scheduler handles reminders.
  const openClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  if (openClients.length > 0 && source !== "force") {
    return;
  }

  let changed = false;
  const now = Date.now();
  for (const accountId of meta.accountIds) {
    if (!accountId || typeof accountId !== "string") continue;
    let items = [];
    try {
      const params = new URLSearchParams({ accountId });
      const res = await fetch(`/api/reminders?${params.toString()}`, {
        cache: "no-store",
        credentials: "include"
      });
      if (!res.ok) continue;
      const payload = await res.json();
      items = Array.isArray(payload.items) ? payload.items : [];
    } catch {
      continue;
    }

    const reminders = items.map((item) => normalizeReminder(item)).filter(Boolean);
    const triggerMap = new Map(reminders.map((item) => [item.id, item.triggerAtMs]));
    if (!meta.deliveredByAccount[accountId] || typeof meta.deliveredByAccount[accountId] !== "object") {
      meta.deliveredByAccount[accountId] = {};
      changed = true;
    }
    const delivered = meta.deliveredByAccount[accountId];

    for (const reminder of reminders) {
      if (reminder.triggerAtMs > now) continue;
      if (reminder.endAtMs <= now) continue;
      if (Number(delivered[reminder.id]) === reminder.triggerAtMs) continue;
      const eventDateLabel = new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short"
      }).format(new Date(reminder.nextEventStartAtMs));
      const bodyParts = [`${reminder.leadLabel} reminder`, `Starts ${eventDateLabel}`];
      if (reminder.eventLocation) {
        bodyParts.push(reminder.eventLocation);
      }
      const targetUrl = reminder.messageId
        ? `/?${new URLSearchParams({ messageId: reminder.messageId }).toString()}`
        : "/";
      await self.registration.showNotification(`Reminder: ${reminder.eventTitle}`, {
        body: bodyParts.join(" · "),
        tag: `calendar-reminder-${reminder.id}`,
        icon: "/icon.png",
        badge: "/favicon.png",
        data: { url: targetUrl, messageId: reminder.messageId }
      });
      delivered[reminder.id] = reminder.triggerAtMs;
      changed = true;
      await postReminderDelivered(accountId, reminder.id, reminder.triggerAtMs);
    }

    Object.entries(delivered).forEach(([id, triggerAt]) => {
      const currentTrigger = triggerMap.get(id);
      if (currentTrigger === undefined || Number(triggerAt) !== currentTrigger) {
        delete delivered[id];
        changed = true;
      }
    });
  }

  if (changed) {
    await writeReminderMeta(meta);
  }
}

self.addEventListener("message", (event) => {
  const payload = event.data;
  if (!payload || typeof payload !== "object") return;
  if (payload.type === "noctua:reminder-state") {
    event.waitUntil(
      (async () => {
        const meta = await readReminderMeta();
        const incomingAccountIds = Array.isArray(payload.accountIds)
          ? payload.accountIds.filter((value) => typeof value === "string" && value.trim())
          : [];
        const accountIds = Array.from(new Set([...(meta.accountIds ?? []), ...incomingAccountIds]));
        const deliveredByAccount = {
          ...(meta.deliveredByAccount && typeof meta.deliveredByAccount === "object"
            ? meta.deliveredByAccount
            : {})
        };
        const incomingDelivered =
          payload.deliveredByAccount && typeof payload.deliveredByAccount === "object"
            ? payload.deliveredByAccount
            : {};
        for (const accountId of accountIds) {
          const value = incomingDelivered[accountId];
          if (!value || typeof value !== "object") continue;
          deliveredByAccount[accountId] = {
            ...(deliveredByAccount[accountId] && typeof deliveredByAccount[accountId] === "object"
              ? deliveredByAccount[accountId]
              : {}),
            ...value
          };
        }
        await writeReminderMeta({ accountIds, deliveredByAccount });
      })()
    );
    return;
  }
  if (payload.type === "noctua:reminder-run-now") {
    event.waitUntil(processReminderNotifications("force"));
  }
});

self.addEventListener("sync", (event) => {
  if (event.tag !== REMINDER_SYNC_TAG) return;
  event.waitUntil(processReminderNotifications("sync"));
});

self.addEventListener("periodicsync", (event) => {
  if (event.tag !== REMINDER_SYNC_TAG) return;
  event.waitUntil(processReminderNotifications("periodic"));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || "/";
  const targetMessageId = event.notification?.data?.messageId || null;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
      const target = new URL(targetUrl, self.location.origin);
      for (const client of clients) {
        const clientUrl = new URL(client.url);
        if (clientUrl.origin !== target.origin) continue;
        if ("focus" in client) {
          await client.focus();
        }
        if ("postMessage" in client) {
          client.postMessage({
            type: "noctua:notification-open",
            messageId: targetMessageId,
            url: targetUrl
          });
        }
        return;
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    })
  );
});
