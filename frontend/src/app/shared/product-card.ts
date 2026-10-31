import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { CompareTrayService } from '../core/compare-tray.service';
import { Product } from '../core/models';
import { WishlistService } from '../core/wishlist.service';
import { PkrPipe, TimeAgoPipe } from './format';
import { ProductImage } from './product-image';

/**
 * Grid item for every product list. Fixed slots in a fixed order on every card
 * (image, store, title, price, note, compare) so a row scans cleanly.
 */
@Component({
  selector: 'app-product-card',
  imports: [RouterLink, PkrPipe, TimeAgoPipe, ProductImage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let p = product();
    <article class="pk-card">
      <div class="pk-card__media" [style.view-transition-name]="'product-' + p.id">
        <app-product-image [src]="p.image_url" [alt]="p.product_name" [label]="p.store_name || p.brand_name" />
        @if (p.drop_percentage) {
          <span class="pk-card__sticker pk-sticker pk-sticker--drop">▼ {{ round(p.drop_percentage) }}%</span>
        } @else if (p.discount_percentage > 0) {
          <span class="pk-card__sticker pk-sticker">−{{ round(p.discount_percentage) }}%</span>
        } @else if (!p.in_stock) {
          <span class="pk-card__sticker pk-sticker pk-sticker--muted">Sold out</span>
        }
        <button
          type="button"
          class="pk-card__save"
          (click)="wishlist.toggle(p.id).subscribe()"
          [attr.aria-pressed]="wishlist.has(p.id)"
          [attr.aria-label]="wishlist.has(p.id) ? 'Remove from my list' : 'Save to my list'"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" [attr.fill]="wishlist.has(p.id) ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.75" stroke-linecap="square" aria-hidden="true">
            <path d="M6 3h12v18l-6-4-6 4z" />
          </svg>
        </button>
      </div>
      <div class="pk-card__body">
        <span class="pk-card__store">{{ p.store_name || p.brand_name }}</span>
        <h3 class="pk-card__title"><a [routerLink]="['/products', p.id]">{{ p.product_name }}</a></h3>
        <div class="pk-price">
          <span class="pk-price__now" [class.pk-price__now--sale]="onSale()">{{ p.price | pkr }}</span>
          @if (wasPrice(); as was) {
            <span class="pk-price__was"><span class="sr-only">was </span>{{ was | pkr }}</span>
          }
          <span class="pk-price__note">
            @if (p.drop_percentage) {
              Dropped <b>{{ round(p.drop_percentage) }}%</b> since our last check
            } @else if (onSale()) {
              You save <b>{{ p.original_price - p.price | pkr }}</b>
            } @else if (!p.in_stock) {
              Out of stock · checked {{ p.last_updated | timeAgo }}
            } @else {
              Checked <b>{{ p.last_updated | timeAgo }}</b>
            }
          </span>
        </div>
        <label class="pk-card__compare">
          <input type="checkbox" [checked]="tray.has(p.id)" [disabled]="!tray.has(p.id) && tray.isFull()" (change)="tray.toggle(p)" />
          {{ !tray.has(p.id) && tray.isFull() ? 'Compare is full (4)' : 'Compare' }}
        </label>
      </div>
    </article>
  `,
})
export class ProductCard {
  readonly product = input.required<Product>();
  protected readonly tray = inject(CompareTrayService);
  protected readonly wishlist = inject(WishlistService);
  protected readonly round = Math.round;
  protected readonly onSale = computed(() => this.product().original_price > this.product().price || !!this.product().drop_percentage);
  protected readonly wasPrice = computed(() => {
    const p = this.product();
    if (p.original_price > p.price) return p.original_price;
    if (p.old_price && p.old_price > p.price) return p.old_price;
    return null;
  });
}
