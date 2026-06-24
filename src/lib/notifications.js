export function isNotificationSupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

export async function requestNotificationPermission() {
  if (!isNotificationSupported()) return "denied";
  return Notification.requestPermission();
}

export async function showAppNotification(title, options = {}) {
  if (!isNotificationSupported() || Notification.permission !== "granted") {
    return;
  }
  const registration = await navigator.serviceWorker?.ready?.catch(() => null);
  if (registration) {
    registration.showNotification(title, options);
  } else {
    new Notification(title, options);
  }
}

export function getWeekSummaryKey(date) {
  const sunday = new Date(date);
  sunday.setHours(0, 0, 0, 0);
  sunday.setDate(sunday.getDate() - sunday.getDay());
  return `weekly-summary-${sunday.toISOString().slice(0, 10)}`;
}
