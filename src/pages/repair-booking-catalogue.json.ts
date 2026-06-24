import type { APIRoute } from 'astro';
import { buildBookingCatalogue } from '@/lib/booking';

/**
 * Emits /repair-booking-catalogue.json at build time.
 *
 * This is the machine-readable projection of src/data/repairs.yaml consumed by
 * the dynamic booking flow (DSEWebstore / shop.dannstarr.co.uk) to resolve
 * booking slugs server-side. Regenerated on every build from the YAML.
 */
export const GET: APIRoute = () => {
  const catalogue = buildBookingCatalogue();
  return new Response(JSON.stringify(catalogue, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
