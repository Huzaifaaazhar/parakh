import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Observable, catchError, of } from 'rxjs';

import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { CompareTrayService } from '../core/compare-tray.service';
import { CompareResponse, ProductDetail } from '../core/models';
import { LabelPipe, PkrPipe, TimeAgoPipe } from '../shared/format';
import { PriceChart } from '../shared/price-chart';
import { ProductImage } from '../shared/product-image';
import { EmptyState } from '../shared/states';

@Component({
  selector: 'app-product-detail',
  imports: [RouterLink, DecimalPipe, PkrPipe, LabelPipe, TimeAgoPipe, ProductImage, PriceChart, EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto max-w-7xl px-4 py-8">
      @if (error()) {
        <app-empty-state
          title="Product not found"
          message="It may have been removed from the store."
          actionLabel="Browse products"
          (action)="router.navigate(['/products'])"
        />
      } @else if (product(); as p) {
        <nav class="mb-4 text-sm text-muted" aria-label="Breadcrumb">
          <a routerLink="/products" [queryParams]="{ vertical: p.vertical }" class="hover:underline">{{ p.vertical | label }}</a>
          <span class="mx-1">/</span>
          <a routerLink="/products" [queryParams]="{ vertical: p.vertical, category: p.category }" class="hover:underline">{{ p.category | label }}</a>
        </nav>

        <div class="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <div class="card aspect-[4/5] overflow-hidden lg:sticky lg:top-24 lg:self-start">
            <app-product-image [src]="p.image_url" [alt]="p.product_name" [vertical]="p.vertical" [label]="p.category | label" />
          </div>

          <div class="space-y-6">
            <div>
              <p class="text-xs font-semibold uppercase tracking-wider text-muted">{{ p.brand_name }} · sold by {{ p.store_name }}</p>
              <h1 class="mt-1 text-3xl font-semibold leading-tight sm:text-4xl">{{ p.product_name }}</h1>
              <div class="mt-4 flex flex-wrap items-baseline gap-3">
                <span class="font-display text-4xl font-semibold" [class.text-sale]="p.discount_percentage > 0">{{ p.price | pkr }}</span>
                @if (p.original_price > p.price) {
                  <span class="text-lg text-muted line-through">{{ p.original_price | pkr }}</span>
                  <span class="badge-sale text-sm">{{ p.discount_percentage | number: '1.0-0' }}% off · save {{ p.original_price - p.price | pkr }}</span>
                }
              </div>
              <p class="mt-2 text-sm" [class.text-drop]="p.in_stock" [class.text-sale]="!p.in_stock">
                {{ p.in_stock ? 'In stock' : 'Out of stock' }} <span class="text-muted">· checked {{ p.last_updated | timeAgo }}</span>
              </p>
            </div>

            <div class="flex flex-wrap gap-2">
              <a [href]="p.product_url" target="_blank" rel="noopener noreferrer" class="btn-primary">View on {{ p.store_name }} ↗</a>
              <button type="button" class="btn-ghost" (click)="tray.toggle(p)" [disabled]="!tray.has(p.id) && tray.isFull()">
                {{ tray.has(p.id) ? '✓ In comparison' : '+ Add to compare' }}
              </button>
              <button type="button" class="btn-ghost" (click)="toggleWishlist()" [disabled]="wishBusy()">
                {{ saved() ? '♥ Saved' : '♡ Save & alert me' }}
              </button>
              <a routerLink="/assistant" [queryParams]="{ product: p.id }" class="btn-ghost text-teal">✦ Ask the assistant</a>
            </div>
            @if (wishMessage()) {
              <p class="text-sm text-muted" role="status">{{ wishMessage() }}</p>
            }

            <section class="card p-5" aria-labelledby="history">
              <div class="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="history" class="text-lg font-semibold">Price history</h2>
                <p class="text-xs text-muted">Lowest {{ p.lowest_price | pkr }} · Highest {{ p.highest_price | pkr }}</p>
              </div>
              <app-price-chart [points]="p.price_history" />
              @if (p.lowest_price !== null && p.price <= p.lowest_price) {
                <p class="mt-2 text-sm font-medium text-drop">This is the lowest price we've tracked.</p>
              }
            </section>

            <dl class="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
              @for (spec of specs(); track spec.label) {
                <div>
                  <dt class="text-muted">{{ spec.label }}</dt>
                  <dd class="font-medium">{{ spec.value }}</dd>
                </div>
              }
            </dl>

            @if (p.description) {
              <details class="card p-5 text-sm" open>
                <summary class="cursor-pointer font-semibold">Description</summary>
                <p class="mt-3 whitespace-pre-line leading-relaxed text-muted">{{ p.description }}</p>
              </details>
            }
          </div>
        </div>

        <section class="mt-14" aria-labelledby="alternatives">
          <div class="mb-4 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 id="alternatives" class="section-title">Compare alternatives</h2>
              <p class="text-sm text-muted">The same item at other stores, and similar items from other brands.</p>
            </div>
            <div class="flex gap-2" role="group" aria-label="Alternative filter">
              <button type="button" [class]="!cheaperOnly() ? 'chip-active' : 'chip'" (click)="cheaperOnly.set(false)">All similar</button>
              <button type="button" [class]="cheaperOnly() ? 'chip-active' : 'chip'" (click)="cheaperOnly.set(true)">Cheaper only</button>
            </div>
          </div>
          @if (comparison(); as c) {
            <p class="mb-4 rounded-xl bg-teal-soft px-4 py-3 text-sm text-teal">{{ c.summary }}</p>
            @if (c.alternatives.length) {
              <ul class="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-card">
                @for (a of c.alternatives; track a.product.id) {
                  <li class="flex items-center gap-4 p-3 sm:p-4">
                    <a [routerLink]="['/products', a.product.id]" class="h-20 w-16 shrink-0 overflow-hidden rounded-lg bg-paper">
                      <app-product-image [src]="a.product.image_url" [vertical]="a.product.vertical" />
                    </a>
                    <div class="min-w-0 flex-1">
                      <div class="flex flex-wrap items-center gap-2">
                        <span class="text-xs font-semibold uppercase tracking-wider text-muted">{{ a.product.store_name }}</span>
                        @if (a.match_type === 'same_product') {
                          <span class="rounded-full bg-saffron-soft px-2 py-0.5 text-[11px] font-semibold text-saffron-dark">Same product</span>
                        } @else {
                          <span class="text-[11px] text-muted">{{ a.similarity * 100 | number: '1.0-0' }}% similar</span>
                        }
                      </div>
                      <a [routerLink]="['/products', a.product.id]" class="line-clamp-1 font-medium hover:underline">{{ a.product.product_name }}</a>
                      <p class="line-clamp-1 text-xs text-muted">{{ a.shared_features.concat(a.differences).slice(0, 4).join(' · ') }}</p>
                    </div>
                    <div class="shrink-0 text-right">
                      <p class="font-semibold">{{ a.product.price | pkr }}</p>
                      <p
                        class="text-xs font-semibold"
                        [class.text-drop]="a.is_cheaper"
                        [class.text-sale]="!a.is_cheaper && a.price_difference > 0"
                        [class.text-muted]="a.price_difference === 0"
                      >
                        @if (a.price_difference === 0) {
                          Same price
                        } @else {
                          {{ a.is_cheaper ? '−' : '+' }}{{ abs(a.price_difference) | pkr }} ({{ abs(a.price_difference_pct) | number: '1.0-0' }}%)
                        }
                      </p>
                      <button type="button" class="mt-1 text-xs font-medium text-teal hover:underline" (click)="tray.toggle(a.product)">
                        {{ tray.has(a.product.id) ? 'Remove' : '+ Compare' }}
                      </button>
                    </div>
                  </li>
                }
              </ul>
            } @else {
              <app-empty-state title="No cheaper alternatives" message="This looks like the best price among similar items we track." />
            }
          } @else {
            <div class="h-40 animate-pulse rounded-2xl bg-line/50" aria-busy="true"></div>
          }
        </section>
      } @else {
        <div class="grid gap-8 lg:grid-cols-2" aria-busy="true">
          <div class="aspect-[4/5] animate-pulse rounded-2xl bg-line/60"></div>
          <div class="space-y-3">
            <div class="h-4 w-1/3 animate-pulse rounded bg-line/70"></div>
            <div class="h-10 w-4/5 animate-pulse rounded bg-line/70"></div>
            <div class="h-8 w-1/4 animate-pulse rounded bg-line/70"></div>
          </div>
        </div>
      }
    </div>
  `,
})
export class ProductDetailPage {
  readonly id = input.required<string>();
  private api = inject(ApiService);
  private auth = inject(AuthService);
  protected readonly router = inject(Router);
  protected readonly tray = inject(CompareTrayService);

  protected readonly product = signal<ProductDetail | null>(null);
  protected readonly error = signal(false);
  protected readonly comparison = signal<CompareResponse | null>(null);
  protected readonly cheaperOnly = signal(false);
  protected readonly saved = signal(false);
  protected readonly wishBusy = signal(false);
  protected readonly wishMessage = signal('');
  protected readonly abs = Math.abs;

  protected readonly specs = computed(() => {
    const p = this.product();
    if (!p) return [];
    const out: { label: string; value: string }[] = [
      { label: 'Category', value: p.category.replace(/-/g, ' ') },
      { label: 'Store', value: p.store_name ?? '—' },
    ];
    if (p.gender) out.push({ label: 'For', value: p.gender });
    if (p.color) out.push({ label: 'Colour', value: p.color });
    if (p.fabric) out.push({ label: 'Fabric', value: p.fabric });
    for (const [k, v] of Object.entries(p.attributes ?? {})) {
      if (k === 'options' || k === 'source_type' || typeof v === 'object') continue;
      out.push({ label: k.replace(/_/g, ' '), value: String(v) });
    }
    const sizes = (p.attributes?.['options'] as Record<string, string[]> | undefined)?.['size'];
    if (sizes?.length) out.push({ label: 'Sizes', value: sizes.slice(0, 8).join(', ') });
    return out;
  });

  constructor() {
    effect(() => {
      const id = Number(this.id());
      this.product.set(null);
      this.error.set(false);
      this.saved.set(false);
      this.wishMessage.set('');
      this.api
        .product(id)
        .pipe(catchError(() => (this.error.set(true), of(null))))
        .subscribe((p) => this.product.set(p));
    });
    effect(() => {
      const id = Number(this.id());
      const cheaper = this.cheaperOnly();
      this.comparison.set(null);
      this.api
        .alternatives(id, cheaper)
        .pipe(catchError(() => of(null)))
        .subscribe((c) =>
          this.comparison.set(c ?? { base: null!, alternatives: [], cheapest: null, best_value: null, summary: "Couldn't load alternatives right now." }),
        );
    });
  }

  toggleWishlist(): void {
    const p = this.product();
    if (!p) return;
    if (!this.auth.isLoggedIn()) {
      this.router.navigate(['/account'], { queryParams: { next: `/products/${p.id}` } });
      return;
    }
    this.wishBusy.set(true);
    const req: Observable<unknown> = this.saved() ? this.api.removeFromWishlist(p.id) : this.api.addToWishlist(p.id);
    req.subscribe({
      next: () => {
        this.saved.set(!this.saved());
        this.wishMessage.set(this.saved() ? "Saved. We'll notify you when the price drops." : 'Removed from your list.');
        this.wishBusy.set(false);
      },
      error: () => {
        this.wishMessage.set("Couldn't update your list. Please sign in again.");
        this.wishBusy.set(false);
      },
    });
  }
}
