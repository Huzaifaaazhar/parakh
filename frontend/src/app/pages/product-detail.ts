import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, signal, viewChildren } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';

import { ApiService } from '../core/api.service';
import { CompareTrayService } from '../core/compare-tray.service';
import { CompareResponse, ProductDetail } from '../core/models';
import { WishlistService } from '../core/wishlist.service';
import { LabelPipe, PkrPipe, TimeAgoPipe } from '../shared/format';
import { PriceChart } from '../shared/price-chart';
import { ProductImage } from '../shared/product-image';
import { Odometer, Reveal } from '../shared/motion';
import { PageHero } from '../shared/page-hero';
import { ProductCard } from '../shared/product-card';
import { Rail } from '../shared/rail';
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
  imports: [RouterLink, DecimalPipe, PkrPipe, LabelPipe, TimeAgoPipe, ProductImage, PriceChart, EmptyState, Odometer, Reveal, DatePipe, PageHero, ProductCard, Rail],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (error()) {
      <app-page-hero variant="paper" eyebrow="Not found" title="This product is gone" subtitle="It may have been removed from the store since our last check.">
        <a routerLink="/products" class="pk-btn pk-btn--primary">Browse products</a>
      </app-page-hero>
    } @else if (product(); as p) {
      <div class="pk-band-blue">
        <div class="mx-auto max-w-7xl px-4 pb-10 pt-5 sm:pb-14">
          <nav class="t-small mb-5" aria-label="Breadcrumb">
            <a routerLink="/products" class="pk-link font-normal">Browse</a>
            <span class="mx-1.5">/</span>
            <a routerLink="/products" [queryParams]="{ vertical: p.vertical }" class="pk-link font-normal">{{ p.vertical | label }}</a>
            <span class="mx-1.5">/</span>
            <a routerLink="/products" [queryParams]="{ vertical: p.vertical, category: p.category }" class="pk-link font-normal">{{ p.category | label }}</a>
          </nav>

          <div class="grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-12">
            <div appReveal class="lg:sticky lg:top-20 lg:self-start">
              <div
                class="pk-gallery"
                [class.is-zoomed]="zoom()"
                [style.view-transition-name]="'product-' + p.id"
                (click)="zoom.set(!zoom())"
                (pointermove)="pan($event)"
                (pointerleave)="zoom.set(false)"
                role="button"
                tabindex="0"
                [attr.aria-pressed]="zoom()"
                aria-label="Zoom image"
                (keydown.enter)="zoom.set(!zoom())"
              >
                <app-product-image [src]="p.image_url" [alt]="p.product_name" [label]="p.store_name || p.brand_name" />
                @if (p.discount_percentage > 0) {
                  <span class="pk-sticker absolute left-4 top-4">−{{ p.discount_percentage | number: '1.0-0' }}%</span>
                }
                <span class="absolute bottom-3 right-3 rounded-full bg-paper-raised/90 px-3 py-1.5 text-[12px] font-bold text-blue">{{ zoom() ? 'Tap to zoom out' : 'Tap to zoom' }}</span>
              </div>
            </div>

            <div class="space-y-5">
              <div class="pk-panel p-5 sm:p-7" appReveal>
                <p class="pk-card__store">{{ p.brand_name }} · sold by {{ p.store_name }}</p>
                <h1 class="mt-2 font-display text-[28px] font-extrabold leading-[1.05] text-blue [font-stretch:110%] sm:text-[36px]">{{ p.product_name }}</h1>

                <div class="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
                  @if (isLowest()) {
                    <span class="pk-circled">
                      <app-odometer class="t-price-xl" [class.text-pink-ink]="p.discount_percentage > 0" [class.text-blue]="!p.discount_percentage" [value]="p.price" />
                      <svg viewBox="0 0 200 60" preserveAspectRatio="none" aria-hidden="true">
                        <path d="M30 8 C 80 -2, 170 2, 192 22 C 206 40, 150 58, 92 56 C 34 54, 2 44, 6 28 C 9 15, 40 6, 70 5" />
                      </svg>
                    </span>
                  } @else {
                    <app-odometer class="t-price-xl" [class.text-pink-ink]="p.discount_percentage > 0" [class.text-blue]="!p.discount_percentage" [value]="p.price" />
                  }
                  @if (p.original_price > p.price) {
                    <span class="pk-price__was text-base"><span class="sr-only">was </span>{{ p.original_price | pkr }}</span>
                  }
                </div>
                <p class="mt-3 text-[15px]">
                  @if (storeRows().length > 1) {
                    @if (isLowest()) {
                      <b class="text-blue">Lowest of {{ storeRows().length }} stores</b> we track.
                    } @else {
                      <b class="text-pink-ink">{{ p.price - cheapestRow()!.price | pkr }} cheaper</b> at {{ cheapestRow()!.store }}.
                    }
                  } @else if (p.original_price > p.price) {
                    You save <b class="text-blue">{{ p.original_price - p.price | pkr }}</b> at {{ p.store_name }}.
                  } @else {
                    Only found at {{ p.store_name }} so far.
                  }
                </p>

                <div class="mt-6 grid gap-3">
                  <a [href]="p.product_url" target="_blank" rel="noopener noreferrer" class="pk-btn pk-btn--primary w-full">Go to {{ p.store_name }}</a>
                  <div class="grid grid-cols-2 gap-3">
                    <button type="button" class="pk-btn pk-btn--quiet pk-btn--sm" (click)="toggleSave(p.id)" [attr.aria-pressed]="wishlist.has(p.id)">
                      {{ wishlist.has(p.id) ? 'Saved' : 'Save and alert me' }}
                    </button>
                    <button type="button" class="pk-btn pk-btn--quiet pk-btn--sm" (click)="tray.toggle(p)" [disabled]="!tray.has(p.id) && tray.isFull()" [attr.aria-pressed]="tray.has(p.id)">
                      {{ tray.has(p.id) ? 'In compare' : 'Add to compare' }}
                    </button>
                  </div>
                </div>
                @if (saveMessage()) {
                  <p class="t-small mt-3" role="status">{{ saveMessage() }}</p>
                }
                <ul class="t-small mt-5 grid gap-1.5 border-t border-dashed border-line-strong pt-4">
                  <li>{{ p.in_stock ? 'In stock' : 'Out of stock' }} · checked {{ p.last_updated | timeAgo }}</li>
                  <li>Price tracked since {{ p.first_seen_at | date: 'd MMM' }}</li>
                </ul>
              </div>

              <section class="pk-panel pk-panel--blue p-5 sm:p-7" aria-labelledby="stores" appReveal>
                <h2 id="stores" class="t-heading mb-3">Price at each store</h2>
                @if (comparison() === null) {
                  <div class="pk-skel h-20"></div>
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
                    <p class="t-small mt-3">We haven't found this exact item at another store yet. Similar items are below.</p>
                  }
                }
              </section>

              <div class="pk-acc" appReveal>
                <details open>
                  <summary>Price history</summary>
                  <div>
                    <p class="t-receipt mb-3 text-charcoal-muted">low {{ p.lowest_price | pkr }} · high {{ p.highest_price | pkr }}</p>
                    <div class="rounded-[8px] border border-line bg-paper-raised p-4"><app-price-chart [points]="p.price_history" /></div>
                  </div>
                </details>
                <details>
                  <summary>Details</summary>
                  <div>
                    <dl class="pk-receipt max-w-md">
                      @for (spec of specs(); track spec.label) {
                        <div>
                          <dt class="capitalize">{{ spec.label }}</dt>
                          <span class="pk-leader"></span>
                          <dd class="max-w-[60%] truncate text-right capitalize">{{ spec.value }}</dd>
                        </div>
                      }
                    </dl>
                  </div>
                </details>
                @if (p.description) {
                  <details>
                    <summary>From the store</summary>
                    <div><p class="t-small whitespace-pre-line text-charcoal">{{ p.description }}</p></div>
                  </details>
                }
                <details>
                  <summary>Ask the assistant</summary>
                  <div>
                    <p class="t-small mb-3 text-charcoal">Ask for cheaper alternatives, the same item elsewhere, or what's on sale like it.</p>
                    <a routerLink="/assistant" [queryParams]="{ product: p.id }" class="pk-btn pk-btn--quiet pk-btn--sm">Ask about this item</a>
                  </div>
                </details>
              </div>
            </div>
          </div>
        </div>
      </div>

      <section class="pk-band-pink py-12 sm:py-16" aria-labelledby="similar">
        <div class="mx-auto mb-5 flex max-w-7xl flex-wrap items-end justify-between gap-4 px-4">
          <div>
            <h2 id="similar" class="t-display-lg">Similar items</h2>
            <p class="t-small mt-2 text-charcoal">From other brands and stores, for the same shopper.</p>
          </div>
          <div class="pk-tabs" role="tablist" aria-label="Filter similar items">
            <span class="pk-tabs__pill" [style.width.px]="pill().w" [style.transform]="'translateX(' + pill().x + 'px)'" aria-hidden="true"></span>
            <button #simTab type="button" role="tab" [attr.aria-selected]="!cheaperOnly()" (click)="cheaperOnly.set(false)">All similar</button>
            <button #simTab type="button" role="tab" [attr.aria-selected]="cheaperOnly()" (click)="cheaperOnly.set(true)">Cheaper only</button>
          </div>
        </div>
        <div class="mx-auto max-w-7xl">
          @if (comparison() === null) {
            <div class="mx-4 pk-skel h-60"></div>
          } @else if (similar().length) {
            <app-rail label="Similar items">
              @for (a of similar(); track a.product.id; let i = $index) {
                <div class="pk-railcard" [appReveal]="i">
                  <app-product-card [product]="a.product" />
                  <p class="mt-2 text-center font-mono text-[13px]" [class.text-pink-ink]="a.is_cheaper" [class.text-charcoal-muted]="!a.is_cheaper">
                    @if (a.price_difference === 0) {
                      same price
                    } @else {
                      {{ abs(a.price_difference) | pkr }} {{ a.is_cheaper ? 'less' : 'more' }}
                    }
                  </p>
                </div>
              }
            </app-rail>
          } @else {
            <div class="px-4">
              <app-empty-state
                [title]="cheaperOnly() ? 'Nothing cheaper yet' : 'No similar items yet'"
                [message]="cheaperOnly() ? 'This is already the lowest price among similar items we track.' : 'We will list similar items as more stores are checked.'"
              />
            </div>
          }
        </div>
      </section>
    } @else {
      <div class="mx-auto grid max-w-7xl gap-8 px-4 py-8 lg:grid-cols-2" aria-busy="true" aria-label="Loading product">
        <div class="pk-skel aspect-[4/5]"></div>
        <div class="space-y-3">
          <div class="pk-skel h-4 w-1/3"></div>
          <div class="pk-skel h-10 w-4/5"></div>
          <div class="pk-skel h-8 w-1/4"></div>
        </div>
      </div>
    }
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
  protected readonly zoom = signal(false);
  private simTabs = viewChildren<ElementRef<HTMLButtonElement>>('simTab');
  protected readonly pill = signal({ x: 0, w: 0 });

  /** Zoom follows the pointer or finger across the photo. */
  pan(e: PointerEvent): void {
    const el = e.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--zx', `${((e.clientX - r.left) / r.width) * 100}%`);
    el.style.setProperty('--zy', `${((e.clientY - r.top) / r.height) * 100}%`);
  }

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
      const btn = this.simTabs()[this.cheaperOnly() ? 1 : 0]?.nativeElement;
      if (btn) this.pill.set({ x: btn.offsetLeft - 4, w: btn.offsetWidth });
    });
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
