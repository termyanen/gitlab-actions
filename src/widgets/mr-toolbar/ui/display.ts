export function formatElapsed(createdAt: string) {
  const diff = Date.now() - new Date(createdAt).getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return days + "d " + (hours % 24) + "h";
  if (hours > 0) return hours + "h " + (minutes % 60) + "m";
  return minutes + "m";
}
