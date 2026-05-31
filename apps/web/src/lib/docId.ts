/**
 * Distinguishes a Layer 1 (real, pipeline-produced) document id from a wiki/knowledge slug.
 *
 * Real documents are persisted in Mongo and keyed by a 24-char hex ObjectId; wiki knowledge items
 * use human-readable slugs (e.g. `k01`). The client picks its data source off this shape because the
 * id is the only signal available without an extra round-trip. Kept in one place so the coupling to
 * Mongo's id format is explicit and testable rather than an inline regex at each call site.
 */
export function isObjectId(id: string | null | undefined): boolean {
  return /^[a-f0-9]{24}$/i.test(id ?? '');
}
