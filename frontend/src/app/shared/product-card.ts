import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { CompareTrayService } from '../core/compare-tray.service';
import { Product } from '../core/models';
import { LabelPipe, PkrPipe } from './format';
import { ProductImage } from './product-image';

@Component({
  selector: 'app-product-card',
  imports: [RouterLink, DecimalPipe, PkrPipe, LabelPipe, ProductImage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let p = product();
    <article class="group card relative flex h-full flex-col overflow-hidden transition-shadow hover:shadow-lg hover:shadow-ink/5">
      <a [routerLink]="['/products', p.id]" class="relative block aspect-[4/5] bg-paper">
        <app-product-image [src]="p.image_url" [alt]="p.product_name" [vertical]="p.vertical" [label]="p.category | label" />
        <div class="absolute left-2 top-2 flex flex-col items-start gap-1">
          @if (p.drop_percentage) {
            <span class="rounded-full bg-drop px-2 py-0.5 text-[11px] font-semibold text-white">↓ {{ p.drop_percentage | number: '1.0-0' }}% drop</span>
          } @else if (p.discount_percentage > 0) {
            <span class="badge-sale">−{{ p.discount_percentage | number: '1.0-0' }}%</span>
          }
          @if (!p.in_stock) {
            <span class="rounded-full bg-ink/80 px-2 py-0.5 text-[11px] font-medium text-white">Out of stock</span>
          }
        </div>
      </a>
      <button
        type="button"
        (click)="tray.toggle(p)"
        [disabled]="!tray.has(p.id) && tray.isFull()"
        [attr.aria-pressed]="tray.has(p.id)"
        [attr.aria-label]="(tray.has(p.id) ? 'Remove from' : 'Add to') + ' comparison'"
        class="absolute right-2 top-2 rounded-full border px-2.5 py-1 text-[11px] font-semibold backdrop-blur transition-colors disabled:opacity-40"
        [class]="tray.has(p.id) ? 'border-ink bg-ink text-paper' : 'border-white/70 bg-white/80 text-ink hover:bg-white'"
      >
        {{ tray.has(p.id) ? '✓ Comparing' : '+ Compare' }}
      </button>
      <div class="flex flex-1 flex-col gap-1 p-3">
        <p class="text-[11px] font-semibold uppercase tracking-wider text-muted">{{ p.store_name || p.brand_name }}</p>
        <a [routerLink]="['/products', p.id]" class="line-clamp-2 text-sm font-medium leading-snug hover:underline">{{ p.product_name }}</a>
        <div class="mt-auto flex flex-wrap items-baseline gap-x-2 pt-2">
          <span class="text-base font-semibold" [class.text-sale]="p.discount_percentage > 0">{{ p.price | pkr }}</span>
          @if (p.original_price > p.price) {
            <span class="text-xs text-muted line-through">{{ p.original_price | pkr }}</span>
          } @else if (p.old_price && p.old_price > p.price) {
            <span class="text-xs text-muted line-through">{{ p.old_price | pkr }}</span>
          }
        </div>
      </div>
    </article>
  `,
})
export class ProductCard {
  readonly product = input.required<Product>();
  protected readonly tray = inject(CompareTrayService);
}
