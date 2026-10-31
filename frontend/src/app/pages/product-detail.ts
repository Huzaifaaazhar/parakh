import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';

import { ApiService } from '../core/api.service';
import { CompareTrayService } from '../core/compare-tray.service';
import { CompareResponse, ProductDetail } from '../core/models';
import { WishlistService } from '../core/wishlist.service';
import { LabelPipe, PkrPipe, TimeAgoPipe } from '../shared/format';
import { PriceChart } from '../shared/price-chart';
import { ProductImage } from '../shared/product-image';
import { EmptyState } from '../shared/states';

interface StoreRow {
  id: number;
  store: string;
  price: number;
  updated: string;
  url: string;
  current: boolean;
}

@Component({
  selector: 'app-product-detail',
  imports: [RouterLink, DecimalPipe, PkrPipe, LabelPipe, TimeAgoPipe, ProductImage, PriceChart, EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto max-w-7xl px-4 pb-16 pt-6">
      @if (error()) {
        <app-empty-state title="Product not found" message="It may have been removed from the store." actionLabel="Browse products" (action)="router.navigate(['/products'])" />
      } @else if (product(); as p) {
        <nav class="t-small mb-4" aria-label="Breadcrumb">
          <a routerLink="/products" [queryParams]="{ vertical: p.vertical }" class="pk-link font-normal">{{ p.vertical | label }}</a>
          <span class="mx-1">/</span>
          <a routerLink="/products" [queryParams]="{ vertical: p.vertical, category: p.category }" class="pk-link font-normal">{{ p.category | label }}</a>
        </nav>

        <div class="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-12">
          <div class="relative aspect-[4/5] overflow-hidden rounded-tag border border-line bg-paper-raised lg:sticky lg:top-20 lg:self-start" [style.view-transition-name]="'product-' + p.id">
            <app-product-image [src]="p.image_url" [alt]="p.product_name" [label]="p.store_name || p.brand_name" />
            @if (p.discount_percentage > 0) {
              <span class="pk-sticker absolute left-3 top-3">−{{ p.discount_percentage | number: '1.0-0' }}%</span>
            }
          </div>

          <div class="space-y-8">
            <div>
              <p class="pk-card__store">{{ p.brand_name }} · sold by {{ p.store_name }}</p>
              <h1 class="mt-2 font-display text-[28px] font-extrabold leading-[1.05] [font-stretch:110%] sm:text-[34px]">{{ p.product_name }}</h1>

              <div class="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
                @if (isLowest()) {
                  <span class="pk-circled">
                    <span class="t-price-xl" [class.text-pink-ink]="p.discount_percentage > 0" [class.text-blue]="!p.discount_percentage">{{ p.price | pkr }}</span>
                    <svg viewBox="0 0 200 60" preserveAspectRatio="none" aria-hidden="true">
                      <path d="M30 8 C 80 -2, 170 2, 192 22 C 206 40, 150 58, 92 56 C 34 54, 2 44, 6 28 C 9 15, 40 6, 70 5" />
                    </svg>
                  </span>
                } @else {
                  <span class="t-price-xl" [class.text-pink-ink]="p.discount_percentage > 0" [class.text-blue]="!p.discount_percentage">{{ p.price | pkr }}</span>
                }
                @if (p.original_price > p.price) {
                  <span class="pk-price__was text-base"><span class="sr-only">was </span>{{ p.original_price | pkr }}</span>
                }
              </div>
              <p class="t-small mt-3">
                @if (storeRows().length > 1) {
                  @if (isLowest()) {
                    Lowest of <b class="text-blue">{{ storeRows().length }} stores</b> we track
                  } @else {
                    <b class="text-pink-ink">{{ p.price - cheapestRow()!.price | pkr }} cheaper</b> at {{ cheapestRow()!.store }}
                  }
                } @else if (p.original_price > p.price) {
                  You save <b class="text-blue">{{ p.original_price - p.price | pkr }}</b> at {{ p.store_name }}
                } @else {
                  Only found at {{ p.store_name }} so far
                }
                · {{ p.in_stock ? 'in stock' : 'out of stock' }}, checked {{ p.last_updated | timeAgo }}
              </p>
            </div>

            <div class="flex flex-wrap gap-3">
              <a [href]="p.product_url" target="_blank" rel="noopener noreferrer" class="pk-btn pk-btn--primary">Go to {{ p.store_name }}</a>
              <button type="button" class="pk-btn pk-btn--quiet" (click)="toggleSave(p.id)" [attr.aria-pressed]="wishlist.has(p.id)">
                {{ wishlist.has(p.id) ? 'Saved to my list' : 'Save and alert me' }}
              </button>
              <button type="button" class="pk-btn pk-btn--quiet" (click)="tray.toggle(p)" [disabled]="!tray.has(p.id) && tray.isFull()" [attr.aria-pressed]="tray.has(p.id)">
                {{ tray.has(p.id) ? 'In compare' : 'Add to compare' }}
              </button>
            </div>
            @if (saveMessage()) {
              <p class="t-small" role="status">{{ saveMessage() }}</p>
            }

            <section aria-labelledby="stores">
              <h2 id="stores" class="t-heading mb-3">Price at each store</h2>
              @if (comparison() === null) {
                <div class="pk-skel h-24"></div>
              } @else {
                <ul class="pk-storelist border-t-2 border-blue">
                  @for (row of storeRows(); track row.id) {
                    <li [class.is-cheapest]="row.id === cheapestRow()?.id && storeRows().length > 1">
                      <span class="font-sans text-[15px] font-bold" [class.text-blue]="row.current">{{ row.store }}</span>
                      @if (row.current) {
                        <span class="t-small">(this page)</span>
                      }
                      <span class="pk-leader"></span>
                      <span class="text-right">
                        @if (row.current) {
                          <span class="block font-semibold text-blue">{{ row.price | pkr }}</span>
                        } @else {
                          <a [routerLink]="['/products', row.id]" class="block font-semibold text-blue underline-offset-2 hover:underline">{{ row.price | pkr }}</a>
                        }
                        <span class="block text-[11px] text-charcoal-muted">updated {{ row.updated | timeAgo }}</span>
                      </span>
                    </li>
                  }
                </ul>
                @if (storeRows().length === 1) {
                  <p class="t-small mt-2">We haven't found this exact item at another store yet. Similar items are below.</p>
                }
              }
            </section>

            <section aria-labelledby="history">
              <div class="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="history" class="t-heading">Price history</h2>
                <p class="t-receipt text-charcoal-muted">low {{ p.lowest_price | pkr }} · high {{ p.highest_price | pkr }}</p>
              </div>
              <div class="rounded-tag border border-line bg-paper-raised p-4">
                <app-price-chart [points]="p.price_history" />
              </div>
            </section>

            <section aria-labelledby="details">
              <h2 id="details" class="t-heading mb-3">Details</h2>
              <dl class="pk-receipt max-w-md">
                @for (spec of specs(); track spec.label) {
                  <div>
                    <dt class="capitalize">{{ spec.label }}</dt>
                    <span class="pk-leader"></span>
                    <dd class="max-w-[60%] truncate text-right capitalize">{{ spec.value }}</dd>
                  </div>
                }
              </dl>
              @if (p.description) {
                <details class="mt-4">
                  <summary class="pk-link cursor-pointer">Store description</summary>
                  <p class="t-small mt-3 whitespace-pre-line">{{ p.description }}</p>
                </details>
              }
              <a routerLink="/assistant" [queryParams]="{ product: p.id }" class="pk-link mt-4 inline-block">Ask the assistant about this item</a>
            </section>
          </div>
        </div>

        <section class="mt-12 sm:mt-[72px]" aria-labelledby="similar">
          <div class="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 id="similar" class="t-display-lg">Similar items</h2>
              <p class="t-small mt-2">From other brands and stores, for the same shopper.</p>
            </div>
            <div class="flex gap-2" role="group" aria-label="Filter similar items">
              <button type="button" class="pk-chip" [attr.aria-pressed]="!cheaperOnly()" (click)="cheaperOnly.set(false)">All similar</button>
              <button type="button" class="pk-chip" [attr.aria-pressed]="cheaperOnly()" (click)="cheaperOnly.set(true)">Cheaper only</button>
            </div>
          </div>
          @if (comparison() === null) {
            <div class="pk-skel h-40"></div>
          } @else if (similar().length) {
            <ul class="pk-ledger">
              @for (a of similar(); track a.product.id) {
                <li>
                  <a class="pk-drop grid-cols-[56px_1fr_auto] sm:grid-cols-[64px_1fr_auto]" [routerLink]="['/products', a.product.id]">
                    <span class="block h-16 w-14 overflow-hidden rounded-tag border border-line sm:h-20 sm:w-16">
                      <app-product-image [src]="a.product.image_url" [label]="a.product.store_name || a.product.brand_name" />
                    </span>
                    <span class="min-w-0">
                      <span class="pk-card__store">{{ a.product.store_name }}</span>
                      <span class="pk-drop__name mt-1">{{ a.product.product_name }}</span>
                      <span class="pk-drop__store">{{ a.shared_features.slice(0, 2).join(' · ') || 'Similar style' }}</span>
                    </span>
                    <span class="pk-drop__prices">
                      <span class="pk-price__now block" [class.pk-price__now--sale]="a.product.discount_percentage > 0">{{ a.product.price | pkr }}</span>
                      @if (a.price_difference === 0) {
                        <span class="t-receipt text-charcoal-muted">same price</span>
                      } @else if (a.is_cheaper) {
                        <span class="t-receipt font-semibold text-pink-ink">{{ abs(a.price_difference) | pkr }} less</span>
                      } @else {
                        <span class="t-receipt text-charcoal-muted">{{ a.price_difference | pkr }} more</span>
                      }
                    </span>
                  </a>
                </li>
              }
            </ul>
          } @else {
            <app-empty-state
              [title]="cheaperOnly() ? 'Nothing cheaper yet' : 'No similar items yet'"
              [message]="cheaperOnly() ? 'This is already the lowest price among similar items we track.' : 'We will list similar items as more stores are checked.'"
            />
          }
        </section>
      } @else {
        <div class="grid gap-8 lg:grid-cols-2" aria-busy="true" aria-label="Loading product">
          <div class="pk-skel aspect-[4/5]"></div>
          <div class="space-y-3">
            <div class="pk-skel h-4 w-1/3"></div>
            <div class="pk-skel h-10 w-4/5"></div>
            <div class="pk-skel h-8 w-1/4"></div>
          </div>
        </div>
      }
    </div>
  `,
})
export class ProductDetailPage {
  readonly id = input.required<string>();
  private api = inject(ApiService);
  protected readonly router = inject(Router);
  protected readonly tray = inject(CompareTrayService);
  protected readonly wishlist = inject(WishlistService);

  protected readonly product = signal<ProductDetail | null>(null);
  protected readonly error = signal(false);
  protected readonly comparison = signal<CompareResponse | null>(null);
  protected readonly cheaperOnly = signal(false);
  protected readonly saveMessage = signal('');
  protected readonly abs = Math.abs;

  /** This product plus the same item at other stores, cheapest first. */
  protected readonly storeRows = computed<StoreRow[]>(() => {
    const p = this.product();
    if (!p) return [];
    const rows: StoreRow[] = [{ id: p.id, store: p.store_name ?? p.brand_name, price: p.price, updated: p.last_updated, url: p.product_url, current: true }];
    for (const a of this.comparison()?.alternatives ?? []) {
      if (a.match_type !== 'same_product') continue;
      const o = a.product;
      rows.push({ id: o.id, store: o.store_name ?? o.brand_name, price: o.price, updated: o.last_updated, url: o.product_url, current: false });
    }
    return rows.sort((x, y) => x.price - y.price);
  });
  protected readonly cheapestRow = computed(() => this.storeRows()[0] ?? null);
  protected readonly isLowest = computed(() => {
    const p = this.product();
    const c = this.cheapestRow();
    return !!p && !!c && p.price <= c.price;
  });

  protected readonly similar = computed(() =>
    (this.comparison()?.alternatives ?? []).filter((a) => a.match_type !== 'same_product' && (!this.cheaperOnly() || a.is_cheaper)),
  );

  protected readonly specs = computed(() => {
    const p = this.product();
    if (!p) return [];
    const out: { label: string; value: string }[] = [{ label: 'Category', value: p.category.replace(/-/g, ' ') }];
    if (p.gender) out.push({ label: 'For', value: p.gender });
    if (p.color) out.push({ label: 'Colour', value: p.color });
    if (p.fabric) out.push({ label: 'Fabric', value: p.fabric });
    for (const [k, v] of Object.entries(p.attributes ?? {})) {
      if (k === 'options' || k === 'source_type' || typeof v === 'object') continue;
      out.push({ label: k.replace(/_/g, ' '), value: String(v) });
    }
    const sizes = (p.attributes?.['options'] as Record<string, string[]> | undefined)?.['size'];
    if (sizes?.length) out.push({ label: 'Sizes', value: sizes.slice(0, 8).join(', ') });
    out.push({ label: 'First seen', value: new Date(p.first_seen_at).toLocaleDateString('en-PK', { day: 'numeric', month: 'short' }) });
    return out;
  });

  constructor() {
    effect(() => {
      const id = Number(this.id());
      this.product.set(null);
      this.error.set(false);
      this.saveMessage.set('');
      this.cheaperOnly.set(false);
      this.api
        .product(id)
        .pipe(catchError(() => (this.error.set(true), of(null))))
        .subscribe((p) => this.product.set(p));
      // One unfiltered request feeds both the per-store list and "similar items".
      this.comparison.set(null);
      this.api
        .alternatives(id, false, 24)
        .pipe(catchError(() => of(null)))
        .subscribe((c) => this.comparison.set(c ?? { base: null!, alternatives: [], cheapest: null, best_value: null, summary: '' }));
    });
  }

  toggleSave(id: number): void {
    const wasSaved = this.wishlist.has(id);
    this.wishlist.toggle(id).subscribe({
      next: () => {
        if (this.wishlist.has(id) !== wasSaved) {
          this.saveMessage.set(wasSaved ? 'Removed from your list.' : "Saved. We'll tell you when the price drops.");
        }
      },
      error: () => this.saveMessage.set("We couldn't update your list. Please sign in again."),
    });
  }
}
