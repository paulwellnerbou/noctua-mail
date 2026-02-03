self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
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
