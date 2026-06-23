export function formatDate(dateStr) {
  if (!dateStr) return "";
  const datePart = dateStr.slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!match) return dateStr;
  const [, year, month, day] = match;
  return `${day}-${month}-${year}`;
}
