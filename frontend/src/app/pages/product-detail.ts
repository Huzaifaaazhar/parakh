import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, signal, viewChildren } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';

import { ApiService } from '../core/api.service';
import { CompareTrayService } from '../core/compare-tray.service';
import { CompareResponse, ProductDetail, Review } from '../core/models';
import { WishlistService } from '../core/wishlist.service';
import { LabelPipe, PkrPipe, TimeAgoPipe, dishLabel } from '../shared/format';
import { ReviewCard } from '../shared/review-card';
import { ReviewForm } from '../shared/review-form';
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
  name: string;
  unit: string | null;
  price: number;
  updated: string;
  url: string;
  current: boolean;
}

@Component({
  selector: 'app-product-detail',
  imports: [RouterLink, DecimalPipe, PkrPipe, LabelPipe, TimeAgoPipe, ProductImage, PriceChart, EmptyState, Odometer, Reveal, DatePipe, PageHero, ProductCard, Rail, ReviewCard, ReviewForm],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (error()) {
      <app-page-hero variant="paper" eyebrow="Not found" title="This dish is off the menu" subtitle="The restaurant may have removed it since our last check.">
        <a routerLink="/dishes" class="pk-btn pk-btn--primary">Browse dishes</a>
      </app-page-hero>
    } @else if (product(); as p) {
      <div class="pk-band-sage">
        <div class="mx-auto max-w-7xl px-4 pb-10 pt-5 sm:pb-14">
          <nav class="t-small mb-5" aria-label="Breadcrumb">
            <a routerLink="/dishes" class="pk-link font-normal">Dishes</a>
            <span class="mx-1.5">/</span>
            <a routerLink="/dishes" [queryParams]="{ category: p.category }" class="pk-link font-normal">{{ p.category | label }}</a>
            @if (p.store_slug) {
              <span class="mx-1.5">/</span>
              <a [routerLink]="['/restaurants', p.store_slug]" class="pk-link font-normal">{{ p.store_name }}</a>
            }
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
                <span class="absolute bottom-3 right-3 rounded-full bg-paper-raised/90 px-3 py-1.5 text-[12px] font-bold text-sage">{{ zoom() ? 'Tap to zoom out' : 'Tap to zoom' }}</span>
              </div>
            </div>

            <div class="space-y-5">
              <div class="pk-panel p-5 sm:p-7" appReveal>
                <p class="pk-card__store">
                  @if (p.store_slug) {
                    <a [routerLink]="['/restaurants', p.store_slug]" class="hover:underline">{{ p.store_name }}</a>
                  } @else {
                    {{ p.store_name }}
                  }
                  @if (p.store_rating) {
                    <span class="pk-card__rating">★ {{ p.store_rating }} Google</span>
                  }
                </p>
                <h1 class="mt-2 font-display text-[28px] font-extrabold leading-[1.05] text-sage [font-stretch:110%] sm:text-[36px]">{{ p.product_name }}</h1>
                <div class="mt-3 flex flex-wrap gap-2">
                  <span class="pk-chip pk-chip--static">{{ p.category | label }}</span>
                  @if (p.protein) {
                    <span class="pk-chip pk-chip--static">{{ p.protein | label }}</span>
                  }
                  @if (p.portion) {
                    <span class="pk-chip pk-chip--static">{{ p.portion }}</span>
                  }
                </div>

                <div class="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
                  @if (isLowest()) {
                    <span class="pk-circled">
                      <app-odometer class="t-price-xl" [class.text-amber-ink]="p.discount_percentage > 0" [class.text-sage]="!p.discount_percentage" [value]="p.price" />
                      <svg viewBox="0 0 200 60" preserveAspectRatio="none" aria-hidden="true">
                        <path d="M30 8 C 80 -2, 170 2, 192 22 C 206 40, 150 58, 92 56 C 34 54, 2 44, 6 28 C 9 15, 40 6, 70 5" />
                      </svg>
                    </span>
                  } @else {
                    <app-odometer class="t-price-xl" [class.text-amber-ink]="p.discount_percentage > 0" [class.text-sage]="!p.discount_percentage" [value]="p.price" />
                  }
                  @if (p.original_price > p.price) {
                    <span class="pk-price__was text-base"><span class="sr-only">was </span>{{ p.original_price | pkr }}</span>
                  }
                </div>
                @if (p.unit_price) {
                  <p class="t-receipt mt-2 text-charcoal-muted">{{ p.unit_price | pkr }} {{ p.unit_label }}</p>
                }
                <p class="mt-3 text-[15px]">
                  @if (storeRows().length > 1) {
                    @if (isLowest()) {
                      <b class="text-sage">Cheapest of {{ storeRows().length }} restaurants</b> serving this dish and portion.
                    } @else {
                      <b class="text-amber-ink">{{ p.price - cheapestRow()!.price | pkr }} less</b> at {{ cheapestRow()!.store }} for the same dish.
                    }
                  } @else if (p.original_price > p.price) {
                    You save <b class="text-sage">{{ p.original_price - p.price | pkr }}</b> at {{ p.store_name }}.
                  } @else {
                    No other restaurant lists the same dish and portion yet.
                  }
                </p>

                <div class="mt-6 grid gap-3">
                  <a [href]="p.product_url" target="_blank" rel="noopener noreferrer" class="pk-btn pk-btn--primary w-full">Order from {{ p.store_name }}</a>
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
                  <li>{{ p.in_stock ? 'On the menu' : 'Not available right now' }} · checked {{ p.last_updated | timeAgo }}</li>
                  <li>Price tracked since {{ p.first_seen_at | date: 'd MMM' }} · may vary by branch</li>
                </ul>
              </div>

              <section class="pk-panel pk-panel--sage p-5 sm:p-7" aria-labelledby="stores" appReveal>
                <h2 id="stores" class="t-heading mb-1">Same dish at other restaurants</h2>
                <p class="t-small mb-3">Same dish, protein and portion. Cheapest first.</p>
                @if (comparison() === null) {
                  <div class="pk-skel h-20"></div>
                } @else {
                  <ul class="pk-storelist border-t-2 border-sage">
                    @for (row of storeRows(); track row.id) {
                      <li [class.is-cheapest]="row.id === cheapestRow()?.id && storeRows().length > 1">
                        <span class="min-w-0">
                          <span class="block font-sans text-[15px] font-bold" [class.text-sage]="row.current">{{ row.store }}@if (row.current) { <span class="t-small font-normal">(this one)</span> }</span>
                          <span class="block truncate text-[12px] text-charcoal-muted">{{ row.name }}{{ row.unit ? ' · ' + row.unit : '' }}</span>
                        </span>
                        <span class="pk-leader"></span>
                        <span class="text-right">
                          @if (row.current) {
                            <span class="block font-semibold text-sage">{{ row.price | pkr }}</span>
                          } @else {
                            <a [routerLink]="['/dishes', row.id]" class="block font-semibold text-sage underline-offset-2 hover:underline">{{ row.price | pkr }}</a>
                          }
                          <span class="block text-[11px] text-charcoal-muted">updated {{ row.updated | timeAgo }}</span>
                        </span>
                      </li>
                    }
                  </ul>
                  @if (storeRows().length === 1) {
                    <p class="t-small mt-3">No other restaurant lists this exact dish and portion yet. Similar dishes are below.</p>
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
                  <summary>About this dish</summary>
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
                    <summary>On the menu</summary>
                    <div><p class="t-small whitespace-pre-line text-charcoal">{{ p.description }}</p></div>
                  </details>
                }
                <details>
                  <summary>Ask the assistant</summary>
                  <div>
                    <p class="t-small mb-3 text-charcoal">Ask where it's cheaper, what a better-value portion would be, or which deals include it.</p>
                    <a routerLink="/assistant" [queryParams]="{ product: p.id }" class="pk-btn pk-btn--quiet pk-btn--sm">Ask about this dish</a>
                  </div>
                </details>
              </div>
            </div>
          </div>
        </div>
      </div>

      <section class="pk-band-amber py-12 sm:py-16" aria-labelledby="similar">
        <div class="mx-auto mb-5 flex max-w-7xl flex-wrap items-end justify-between gap-4 px-4">
          <div>
            <h2 id="similar" class="t-display-lg">Similar dishes elsewhere</h2>
            <p class="t-small mt-2 text-charcoal">The same kind of dish at other restaurants, in a different portion or style.</p>
          </div>
          <div class="pk-tabs" role="tablist" aria-label="Filter similar items">
            <span class="pk-tabs__pill" [style.width.px]="pill().w" [style.transform]="'translateX(' + pill().x + 'px)'" aria-hidden="true"></span>
            <button #simTab type="button" role="tab" [attr.aria-selected]="!cheaperOnly()" (click)="cheaperOnly.set(false)">All</button>
            <button #simTab type="button" role="tab" [attr.aria-selected]="cheaperOnly()" (click)="cheaperOnly.set(true)">Cheaper only</button>
          </div>
        </div>
        <div class="mx-auto max-w-7xl">
          @if (comparison() === null) {
            <div class="mx-4 pk-skel h-60"></div>
          } @else if (similar().length) {
            <app-rail label="Similar dishes">
              @for (a of similar(); track a.product.id; let i = $index) {
                <div class="pk-railcard" [appReveal]="i">
                  <app-product-card [product]="a.product" />
                  <p class="mt-2 text-center font-mono text-[13px]" [class.text-amber-ink]="a.is_cheaper" [class.text-charcoal-muted]="!a.is_cheaper">
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
                [title]="cheaperOnly() ? 'Nothing cheaper yet' : 'No similar dishes yet'"
                [message]="cheaperOnly() ? 'This is already the lowest price among similar dishes we track.' : 'We will list similar dishes as more restaurants are read.'"
              />
            </div>
          }
        </div>
      </section>

      <section class="mx-auto max-w-7xl px-4 py-12 sm:py-16" aria-labelledby="dish-reviews">
        <div class="grid gap-8 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <h2 id="dish-reviews" class="t-display-lg">How it really looks</h2>
            <p class="t-small mt-2">Reviews of this dish from people who ordered it, with their photos and videos.</p>
            @if (p.store_slug) {
              <div class="mt-6"><app-review-form [restaurantSlug]="p.store_slug" [dishes]="[p]" [presetDish]="p.id" (posted)="added($event)" /></div>
            }
          </div>
          <div class="space-y-4">
            @for (r of reviews(); track r.id; let i = $index) {
              <app-review-card [review]="r" [appReveal]="i % 6" />
            } @empty {
              <div class="pk-panel p-6">
                <p class="t-heading">No reviews of this dish yet</p>
                <p class="t-small mt-2">Ordered it? A photo of the plate helps the next person decide.</p>
              </div>
            }
          </div>
        </div>
      </section>
    } @else {
      <div class="mx-auto grid max-w-7xl gap-8 px-4 py-8 lg:grid-cols-2" aria-busy="true" aria-label="Loading dish">
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
  protected readonly reviews = signal<Review[]>([]);
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
    const unit = (x: { unit_price?: number | null; unit_label?: string | null }) =>
      x.unit_price ? `Rs ${Math.round(x.unit_price).toLocaleString('en-PK')} ${x.unit_label}` : null;
    const rows: StoreRow[] = [
      { id: p.id, store: p.store_name ?? p.brand_name, name: p.product_name, unit: unit(p), price: p.price, updated: p.last_updated, url: p.product_url, current: true },
    ];
    // One row per restaurant: its cheapest same-dish, same-portion item.
    const seen = new Set([p.store_id]);
    const same = (this.comparison()?.alternatives ?? []).filter((a) => a.match_type === 'same_dish').sort((x, y) => x.product.price - y.product.price);
    for (const a of same) {
      const o = a.product;
      if (seen.has(o.store_id)) continue;
      seen.add(o.store_id);
      rows.push({ id: o.id, store: o.store_name ?? o.brand_name, name: o.product_name, unit: unit(o), price: o.price, updated: o.last_updated, url: o.product_url, current: false });
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
      (this.comparison()?.alternatives ?? []).filter((a) => !this.cheaperOnly() || a.is_cheaper),
  );

  protected readonly specs = computed(() => {
    const p = this.product();
    if (!p) return [];
    const a = (p.attributes ?? {}) as Record<string, unknown>;
    const out: { label: string; value: string }[] = [{ label: 'Dish', value: dishLabel(p.category) }];
    if (p.protein) out.push({ label: 'Protein', value: p.protein });
    if (p.portion) out.push({ label: 'Portion', value: p.portion });
    if (a['size_label']) out.push({ label: 'Size on the menu', value: String(a['size_label']) });
    if (a['menu_section']) out.push({ label: 'Menu section', value: String(a['menu_section']) });
    if (a['deal_parts']) out.push({ label: 'Items in the deal', value: String(a['deal_parts']) });
    if (p.unit_price) out.push({ label: 'Price ' + p.unit_label, value: `Rs ${Math.round(p.unit_price).toLocaleString('en-PK')}` });
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
      this.reviews.set([]);
      this.api
        .reviews({ product_id: id, limit: 20 })
        .pipe(catchError(() => of([] as Review[])))
        .subscribe((r) => this.reviews.set(r));
      // One unfiltered request feeds both the per-store list and "similar items".
      this.comparison.set(null);
      this.api
        .alternatives(id, false, 24)
        .pipe(catchError(() => of(null)))
        .subscribe((c) => this.comparison.set(c ?? { base: null!, alternatives: [], cheapest: null, best_value: null, summary: '' }));
    });
  }

  added(r: Review): void {
    this.reviews.update((list) => [r, ...list]);
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
