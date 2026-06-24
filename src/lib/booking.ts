import { getAllCategories } from '@/lib/repairs';
import type { Category, Device, Repair, Tier } from '@/lib/repairs';

/**
 * Booking catalogue + deep-link helpers.
 *
 * The YAML in `src/data/repairs.yaml` owns the price. This module projects it
 * into a stable, machine-readable catalogue of bookable options and builds the
 * path-based deep links that the static repair pages use to hand off into the
 * dynamic booking flow at shop.dannstarr.co.uk.
 *
 * See: "Dannstarr Repair Booking Mapping Spec" / "Booking Context Passing Spec".
 *
 * Trust boundary: links only ever carry slugs. Price/context is re-resolved
 * server-side from this catalogue by the dynamic shop — never trusted from the
 * browser.
 */

export const SCHEMA_VERSION = 1;
export const BOOKING_BASE_URL = 'https://shop.dannstarr.co.uk/book';
export const CATALOGUE_SOURCE_PATH = 'src/data/repairs.yaml';

export type BookingKind =
  | 'fixed_price_repair'
  | 'tiered_repair'
  | 'quote_required_repair';

export interface BookingOption {
  kind: BookingKind;
  bookingSlug: string;
  bookingUrl: string;

  categorySlug: string;
  categoryName: string;

  deviceSlug: string;
  deviceName: string;

  repairSlug: string;
  repairName: string;
  repairDescription?: string | null;

  tierSlug: string | null;
  tierLabel: string | null;

  priceRaw: string | number | null;
  pricePence: number | null;
  priceLabel: string;

  quoteRequired: boolean;
  bookable: boolean;

  sourcePath: string;
}

export interface DeviceContext {
  categorySlug: string;
  categoryName: string;
  deviceSlug: string;
  deviceName: string;
}

export interface BookingCatalogue {
  schemaVersion: number;
  source: { repo: string; path: string };
  generatedAt: string;
  options: BookingOption[];
}

/**
 * Deterministically slugify a repair name or tier label into a lower-case
 * kebab-case token. Same input always yields the same slug.
 */
export function slugify(value: string): string {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

interface PriceInfo {
  priceRaw: string | number | null;
  pricePence: number | null;
  priceLabel: string;
  quoteRequired: boolean;
  bookable: boolean;
}

/**
 * Normalise a YAML price value into catalogue price fields.
 *
 * Accepts numeric values plus the labels `TBA`, `FREE` and `Varies`
 * (case-insensitive). Anything else throws so catalogue generation fails loudly.
 */
export function normalizePrice(raw: number | string): PriceInfo {
  if (typeof raw === 'number') {
    return {
      priceRaw: raw,
      pricePence: Math.round(raw * 100),
      priceLabel: `£${raw.toFixed(2)}`,
      quoteRequired: false,
      bookable: true,
    };
  }

  const str = String(raw).trim();
  const upper = str.toUpperCase();

  if (upper === 'TBA') {
    return {
      priceRaw: 'TBA',
      pricePence: null,
      priceLabel: 'Price to be confirmed',
      quoteRequired: true,
      bookable: false,
    };
  }
  if (upper === 'FREE') {
    return {
      priceRaw: 'FREE',
      pricePence: 0,
      priceLabel: 'FREE',
      quoteRequired: false,
      bookable: true,
    };
  }
  if (upper === 'VARIES') {
    return {
      priceRaw: str,
      pricePence: null,
      priceLabel: 'Price varies',
      quoteRequired: true,
      bookable: true,
    };
  }

  const num = parseFloat(str.replace(/[£,\s]/g, ''));
  if (!Number.isNaN(num)) {
    return {
      priceRaw: raw,
      pricePence: Math.round(num * 100),
      priceLabel: `£${num.toFixed(2)}`,
      quoteRequired: false,
      bookable: true,
    };
  }

  throw new Error(
    `Unparseable price ${JSON.stringify(raw)} — expected a number or one of: TBA, FREE, Varies.`,
  );
}

/** Build a path-based booking slug from its parts. */
export function buildBookingSlug(
  categorySlug: string,
  deviceSlug: string,
  repairSlug: string,
  tierSlug?: string | null,
): string {
  const parts = [categorySlug, deviceSlug, repairSlug];
  if (tierSlug) parts.push(tierSlug);
  return parts.join('/');
}

/** Build the absolute dynamic-shop booking URL for a booking slug. */
export function buildBookingUrl(bookingSlug: string): string {
  return `${BOOKING_BASE_URL}/${bookingSlug}`;
}

/**
 * Build the normalised booking option(s) for a single repair row.
 *
 * - quote-required repair -> one assessment option
 * - tiered repair         -> one option per tier (parallel to `repair.tiers`)
 * - fixed-price repair    -> one option
 */
export function getRepairBookingOptions(
  repair: Repair,
  ctx: DeviceContext,
): BookingOption[] {
  const repairSlug = slugify(repair.name);
  const base = {
    categorySlug: ctx.categorySlug,
    categoryName: ctx.categoryName,
    deviceSlug: ctx.deviceSlug,
    deviceName: ctx.deviceName,
    repairSlug,
    repairName: repair.name,
    repairDescription: repair.description ?? null,
    sourcePath: CATALOGUE_SOURCE_PATH,
  };

  if (repair.quote) {
    const bookingSlug = buildBookingSlug(ctx.categorySlug, ctx.deviceSlug, repairSlug);
    return [
      {
        ...base,
        kind: 'quote_required_repair',
        bookingSlug,
        bookingUrl: buildBookingUrl(bookingSlug),
        tierSlug: null,
        tierLabel: null,
        priceRaw: null,
        pricePence: null,
        priceLabel: 'Quote required',
        quoteRequired: true,
        bookable: true,
      },
    ];
  }

  if (repair.tiers && repair.tiers.length > 0) {
    return repair.tiers.map((tier: Tier) => {
      const tierSlug = slugify(tier.label);
      const bookingSlug = buildBookingSlug(
        ctx.categorySlug,
        ctx.deviceSlug,
        repairSlug,
        tierSlug,
      );
      const price = normalizePrice(tier.price);
      return {
        ...base,
        kind: 'tiered_repair' as const,
        bookingSlug,
        bookingUrl: buildBookingUrl(bookingSlug),
        tierSlug,
        tierLabel: tier.label,
        ...price,
      };
    });
  }

  if (repair.price !== undefined) {
    const bookingSlug = buildBookingSlug(ctx.categorySlug, ctx.deviceSlug, repairSlug);
    const price = normalizePrice(repair.price);
    return [
      {
        ...base,
        kind: 'fixed_price_repair',
        bookingSlug,
        bookingUrl: buildBookingUrl(bookingSlug),
        tierSlug: null,
        tierLabel: null,
        ...price,
      },
    ];
  }

  throw new Error(
    `Repair "${repair.name}" (${ctx.categorySlug}/${ctx.deviceSlug}) has no price, tiers, or quote flag.`,
  );
}

/**
 * Categories with top-level `repairs` (e.g. MacBook, Laptop) have no per-device
 * pages, so the category itself acts as the device for booking purposes.
 */
function deviceContextsForCategory(
  category: Category,
): { ctx: DeviceContext; repairs: Repair[] }[] {
  if (Array.isArray(category.devices) && category.devices.length > 0) {
    return category.devices.map((device: Device) => ({
      ctx: {
        categorySlug: category.slug,
        categoryName: category.name,
        deviceSlug: device.slug,
        deviceName: device.name,
      },
      repairs: device.repairs,
    }));
  }
  if (Array.isArray(category.repairs) && category.repairs.length > 0) {
    return [
      {
        ctx: {
          categorySlug: category.slug,
          categoryName: category.name,
          deviceSlug: category.slug,
          deviceName: category.name,
        },
        repairs: category.repairs,
      },
    ];
  }
  return [];
}

/**
 * Build the full booking catalogue from the YAML source of truth.
 *
 * Fails the build on duplicate booking slugs so stale/ambiguous links can't ship.
 */
export function buildBookingCatalogue(): BookingCatalogue {
  const options: BookingOption[] = [];
  const seen = new Map<string, string>();

  for (const category of getAllCategories()) {
    for (const { ctx, repairs } of deviceContextsForCategory(category)) {
      for (const repair of repairs) {
        for (const option of getRepairBookingOptions(repair, ctx)) {
          const prev = seen.get(option.bookingSlug);
          if (prev) {
            throw new Error(
              `Duplicate booking slug "${option.bookingSlug}" — produced by "${prev}" and "${option.repairName}${
                option.tierLabel ? ` / ${option.tierLabel}` : ''
              }".`,
            );
          }
          seen.set(
            option.bookingSlug,
            `${option.repairName}${option.tierLabel ? ` / ${option.tierLabel}` : ''}`,
          );
          options.push(option);
        }
      }
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    source: { repo: 'TechFath3r/ClaudeDSE', path: CATALOGUE_SOURCE_PATH },
    generatedAt: new Date().toISOString(),
    options,
  };
}
