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

@Pipe({ name: 'label' })
export class LabelPipe implements PipeTransform {
  /** "t-shirt" -> "T-shirt", "power-bank" -> "Power bank" */
  transform(value: string | null | undefined): string {
    if (!value) return '';
    const text = value === 't-shirt' ? 't-shirt' : value.replace(/-/g, ' ');
    return text.charAt(0).toUpperCase() + text.slice(1);
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
