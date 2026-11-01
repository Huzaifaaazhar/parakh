import { Pipe, PipeTransform } from '@angular/core';

const pkr = new Intl.NumberFormat('en-PK', { maximumFractionDigits: 0 });

export function formatPkr(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `Rs ${pkr.format(value)}`;
}

@Pipe({ name: 'pkr' })
export class PkrPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    return formatPkr(value);
  }
}

/** Dish names as diners say them (mirrors the backend's CATEGORY_LABELS). */
export const DISH_LABELS: Record<string, string> = {
  deal: 'Deals & platters',
  'add-on': 'Extras & sauces',
  rice: 'Rice bowls',
  shake: 'Shakes',
  'chai-coffee': 'Chai & coffee',
  drink: 'Drinks',
  'ice-cream': 'Ice cream',
  dessert: 'Desserts',
  pizza: 'Pizza',
  shawarma: 'Shawarma',
  'roll-wrap': 'Rolls & wraps',
  burger: 'Burgers',
  sandwich: 'Sandwiches',
  tikka: 'Tikka',
  boti: 'Boti',
  kabab: 'Kababs',
  sajji: 'Sajji',
  chargha: 'Chargha',
  mandi: 'Mandi',
  'bbq-platter': 'BBQ',
  karahi: 'Karahi',
  handi: 'Handi',
  nihari: 'Nihari',
  haleem: 'Haleem',
  qorma: 'Qorma & curries',
  'daal-veg': 'Daal & sabzi',
  biryani: 'Biryani',
  pulao: 'Pulao',
  chinese: 'Chinese',
  soup: 'Soups',
  wings: 'Wings',
  'fried-chicken': 'Fried chicken',
  fries: 'Fries & sides',
  pasta: 'Pasta',
  steak: 'Steaks',
  seafood: 'Fish & seafood',
  bread: 'Naan & roti',
  salad: 'Salads',
  starter: 'Starters',
  breakfast: 'Breakfast',
  other: 'Other',
};

/** The dishes people compare most, in the order the home page shows them. */
export const HEADLINE_DISHES = ['tikka', 'karahi', 'biryani', 'burger', 'pizza', 'boti', 'kabab', 'roll-wrap', 'fried-chicken', 'deal', 'shake', 'dessert'];

export function dishLabel(value: string | null | undefined): string {
  if (!value) return '';
  if (DISH_LABELS[value]) return DISH_LABELS[value];
  const text = value.replace(/-/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

@Pipe({ name: 'label' })
export class LabelPipe implements PipeTransform {
  /** "roll-wrap" -> "Rolls & wraps", "chicken" -> "Chicken" */
  transform(value: string | null | undefined): string {
    return dishLabel(value);
  }
}

@Pipe({ name: 'timeAgo' })
export class TimeAgoPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    if (!value) return '';
    const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
    if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}m ago`;
    if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
    return `${Math.round(seconds / 86400)}d ago`;
  }
}
