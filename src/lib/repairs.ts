import yaml from 'js-yaml';
import repairsRaw from '@data/repairs.yaml?raw';

export interface Tier {
  label: string;
  price: number | string;
}

export interface Repair {
  name: string;
  description?: string;
  price?: number | string;
  tiers?: Tier[];
  quote?: boolean;
}

export interface Device {
  name: string;
  slug: string;
  repairs: Repair[];
}

export interface Category {
  name: string;
  slug: string;
  icon: string;
  description: string;
  note?: string;
  devices?: Device[];
  repairs?: Repair[];
}

interface RepairsData {
  categories: Category[];
}

const data = yaml.load(repairsRaw) as RepairsData;

export function getAllCategories(): Category[] {
  return data.categories;
}

export function getCategoryBySlug(slug: string): Category | undefined {
  return data.categories.find((c) => c.slug === slug);
}

export function getDeviceBySlug(
  categorySlug: string,
  deviceSlug: string,
): Device | undefined {
  const category = getCategoryBySlug(categorySlug);
  return category?.devices?.find((d) => d.slug === deviceSlug);
}

export function hasDevices(category: Category): boolean {
  return Array.isArray(category.devices) && category.devices.length > 0;
}
