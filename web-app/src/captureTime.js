// Timezone-free camera times retain the sorter's existing UTC convention. This
// makes ordering deterministic; it does not infer the camera's physical timezone.
export function parseCaptureTimestamp(raw) {
  if (typeof raw !== 'string') return null;
  const match = raw.trim().match(/^(\d{4})[:-](\d{2})[:-](\d{2})[T ](\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/i);
  if (!match) return null; // Reject date-only placeholders such as DJI's 1970-01-01.
  const [, year, month, day, hour, minute, second, fraction = '', zone = 'Z'] = match;
  const local = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}${fraction}Z`);
  if (Number.isNaN(local.getTime()) || local.getUTCFullYear() !== Number(year)
    || local.getUTCMonth() + 1 !== Number(month) || local.getUTCDate() !== Number(day)
    || local.getUTCHours() !== Number(hour) || local.getUTCMinutes() !== Number(minute)
    || local.getUTCSeconds() !== Number(second)) return null;
  const normalizedZone = zone.toUpperCase().replace(/^([+-]\d{2})(\d{2})$/, '$1:$2');
  const result = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}${fraction}${normalizedZone}`);
  return Number.isNaN(result.getTime()) ? null : result;
}
