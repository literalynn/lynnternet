export function sanitizeId(s) {
  return String(s).trim().replace(/[^\w-]+/g, '-');
}
