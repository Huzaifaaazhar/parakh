import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

import { PricePoint } from '../core/models';
import { PkrPipe } from './format';

const W = 600;
const H = 160;
const PAD = { top: 16, right: 12, bottom: 24, left: 12 };

/** Step chart of a product's price over time (prices change in steps between scrapes). */
@Component({
  selector: 'app-price-chart',
  imports: [PkrPipe, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (points().length < 2) {
      <p class="t-small">We've seen one price so far ({{ points()[0]?.price | pkr }}). History builds up with each scrape.</p>
    } @else {
      <div class="relative">
        <svg [attr.viewBox]="'0 0 ' + W + ' ' + H" class="h-40 w-full" role="img" [attr.aria-label]="summary()" (mouseleave)="hover.set(null)">
          <line [attr.x1]="PAD.left" [attr.x2]="W - PAD.right" [attr.y1]="yLow()" [attr.y2]="yLow()" class="stroke-pink-ink" stroke-dasharray="3 4" />
          <path [attr.d]="area()" class="fill-blue-tint" />
          <path [attr.d]="line()" class="fill-none stroke-blue" stroke-width="2" stroke-linejoin="round" />
          @for (pt of coords(); track $index) {
            <circle [attr.cx]="pt.x" [attr.cy]="pt.y" r="10" fill="transparent" (mouseenter)="hover.set($index)" (focus)="hover.set($index)" tabindex="0" />
            <circle [attr.cx]="pt.x" [attr.cy]="pt.y" [attr.r]="hover() === $index ? 5 : 3" class="fill-paper-raised stroke-blue" stroke-width="2" />
          }
          <text [attr.x]="PAD.left" [attr.y]="H - 6" class="fill-charcoal-muted font-mono text-[11px]">{{ points()[0].recorded_at | date: 'd MMM' }}</text>
          <text [attr.x]="W - PAD.right" [attr.y]="H - 6" text-anchor="end" class="fill-charcoal-muted font-mono text-[11px]">
            {{ points()[points().length - 1].recorded_at | date: 'd MMM' }}
          </text>
        </svg>
        @if (hover() !== null) {
          @let pt = coords()[hover()!];
          <div
            class="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-tag bg-blue px-2 py-1 font-mono text-xs text-on-blue"
            [style.left.%]="(pt.x / W) * 100"
            [style.top.%]="(pt.y / H) * 100 - 4"
          >
            <b>{{ points()[hover()!].price | pkr }}</b> · {{ points()[hover()!].recorded_at | date: 'd MMM, h:mm a' }}
          </div>
        }
      </div>
    }
  `,
})
export class PriceChart {
  readonly points = input.required<PricePoint[]>();
  protected readonly hover = signal<number | null>(null);
  protected readonly W = W;
  protected readonly H = H;
  protected readonly PAD = PAD;

  private readonly range = computed(() => {
    const prices = this.points().map((p) => p.price);
    const lo = Math.min(...prices);
    const hi = Math.max(...prices);
    const pad = (hi - lo || hi * 0.1 || 1) * 0.15;
    return { lo: lo - pad, hi: hi + pad, low: lo };
  });

  protected readonly coords = computed(() => {
    const pts = this.points();
    const t0 = new Date(pts[0].recorded_at).getTime();
    const t1 = new Date(pts[pts.length - 1].recorded_at).getTime();
    const { lo, hi } = this.range();
    return pts.map((p) => ({
      x: PAD.left + ((new Date(p.recorded_at).getTime() - t0) / (t1 - t0 || 1)) * (W - PAD.left - PAD.right),
      y: PAD.top + (1 - (p.price - lo) / (hi - lo)) * (H - PAD.top - PAD.bottom),
    }));
  });

  protected readonly line = computed(() => {
    const c = this.coords();
    return c.map((p, i) => (i === 0 ? `M${p.x},${p.y}` : `H${p.x}V${p.y}`)).join('') + `H${W - PAD.right}`;
  });

  protected readonly area = computed(() => `${this.line()}V${H - PAD.bottom}H${PAD.left}Z`);

  protected readonly yLow = computed(() => {
    const { lo, hi, low } = this.range();
    return PAD.top + (1 - (low - lo) / (hi - lo)) * (H - PAD.top - PAD.bottom);
  });

  protected readonly summary = computed(() => {
    const p = this.points();
    return `Price history: ${p.length} points, from Rs ${p[0].price} to Rs ${p[p.length - 1].price}`;
  });
}
