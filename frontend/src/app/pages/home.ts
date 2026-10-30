import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';

import { ApiService } from '../core/api.service';
import { PriceDrop, Product, SalesOverview } from '../core/models';
import { PkrPipe } from '../shared/format';
import { ProductCard } from '../shared/product-card';
import { EmptyState, SkeletonGrid } from '../shared/states';

@Component({
  selector: 'app-home',
  imports: [FormsModule, RouterLink, DecimalPipe, PkrPipe, ProductCard, SkeletonGrid, EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="border-b border-line bg-gradient-to-b from-pink-soft/60 to-paper">
      <div class="mx-auto max-w-7xl px-4 pb-12 pt-10 sm:pb-16 sm:pt-16">
        <p class="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-pink-deep">Pakistan's price checker</p>
        <h1 class="max-w-3xl text-4xl font-semibold leading-[1.05] sm:text-6xl">
          Compare before you buy.<br /><span class="text-blue">Every store, every sale, one place.</span>
        </h1>
        <p class="mt-4 max-w-2xl text-base text-muted sm:text-lg">
          Clothes, shoes, phones, earbuds, perfumes and home goods from {{ storeCount() || 'dozens of' }} Pakistani stores — searched, matched and price-tracked
          for you.
        </p>
        <form (ngSubmit)="search()" class="mt-8 flex max-w-2xl flex-col gap-2 sm:flex-row" role="search">
          <label class="flex-1">
            <span class="sr-only">What are you looking for?</span>
            <input [(ngModel)]="query" name="q" class="input h-12 rounded-full px-5 text-base shadow-sm" placeholder="e.g. men's kurta under 4000" />
          </label>
          <button class="btn-accent h-12 px-6 text-base font-semibold">Search</button>
        </form>
        <div class="mt-4 flex flex-wrap gap-2">
          @for (q of examples; track q) {
            <a [routerLink]="['/products']" [queryParams]="{ q }" class="chip">{{ q }}</a>
          }
          <a routerLink="/assistant" class="chip border-pink bg-pink-soft text-pink-deep hover:border-pink-deep">✦ Ask the assistant</a>
        </div>

        @if (overview(); as ov) {
          <dl class="mt-10 grid max-w-2xl grid-cols-3 gap-4">
            <div>
              <dt class="text-xs uppercase tracking-wider text-muted">Products tracked</dt>
              <dd class="font-display text-2xl font-semibold sm:text-3xl">{{ ov.total_products | number }}</dd>
            </div>
            <div>
              <dt class="text-xs uppercase tracking-wider text-muted">On sale now</dt>
              <dd class="font-display text-2xl font-semibold text-sale sm:text-3xl">{{ ov.total_on_sale | number }}</dd>
            </div>
            <div>
              <dt class="text-xs uppercase tracking-wider text-muted">Avg. discount</dt>
              <dd class="font-display text-2xl font-semibold sm:text-3xl">{{ ov.average_discount | number: '1.0-0' }}%</dd>
            </div>
          </dl>
        }
      </div>
    </section>

    <div class="mx-auto max-w-7xl space-y-14 px-4 pt-10">
      <section aria-labelledby="shop-by">
        <h2 id="shop-by" class="section-title mb-4">Shop by department</h2>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          @for (v of verticals; track v.key) {
            <a
              [routerLink]="['/products']"
              [queryParams]="{ vertical: v.key }"
              class="card group flex flex-col gap-1 p-4 transition-colors hover:border-pink sm:p-5"
            >
              <span class="text-2xl" aria-hidden="true">{{ v.emoji }}</span>
              <span class="font-display text-lg font-semibold">{{ v.label }}</span>
              <span class="text-xs text-muted">{{ v.blurb }}</span>
            </a>
          }
        </div>
      </section>

      @if (overview(); as ov) {
        <section aria-labelledby="sales-now">
          <div class="mb-4 flex items-end justify-between gap-4">
            <div>
              <h2 id="sales-now" class="section-title">Who's on sale right now</h2>
              <p class="text-sm text-muted">Live sale status across stores, refreshed every few hours.</p>
            </div>
            <a routerLink="/sales" class="shrink-0 text-sm font-medium text-blue hover:underline">All sales →</a>
          </div>
          <div class="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2">
            @for (s of ov.stores.slice(0, 10); track s.id) {
              <a [routerLink]="['/sales']" [queryParams]="{ store: s.slug }" class="card w-48 shrink-0 snap-start p-4 transition-colors hover:border-ink/40">
                <p class="truncate font-semibold">{{ s.name }}</p>
                @if (s.on_sale > 0) {
                  <p class="mt-1 text-sm">
                    <span class="font-semibold text-sale">Up to {{ s.max_discount | number: '1.0-0' }}% off</span>
                  </p>
                  <p class="text-xs text-muted">{{ s.on_sale }} of {{ s.total_products }} items on sale</p>
                  <div class="mt-3 h-1.5 overflow-hidden rounded-full bg-line">
                    <div class="h-full rounded-full bg-sale" [style.width.%]="s.sale_share"></div>
                  </div>
                } @else {
                  <p class="mt-1 text-sm text-muted">No sale right now</p>
                }
              </a>
            }
          </div>
        </section>
      }

      <section aria-labelledby="trending">
        <div class="mb-4 flex items-end justify-between gap-4">
          <div>
            <h2 id="trending" class="section-title">Best value picks</h2>
            <p class="text-sm text-muted">Big discounts on items priced below similar products.</p>
          </div>
          <a routerLink="/products" [queryParams]="{ sort: 'value' }" class="shrink-0 text-sm font-medium text-blue hover:underline">See more →</a>
        </div>
        @if (trending() === null) {
          <app-skeleton-grid [count]="8" />
        } @else if (trending()!.length) {
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
            @for (p of trending(); track p.id) {
              <app-product-card [product]="p" />
            }
          </div>
        } @else {
          <app-empty-state
            title="No products yet"
            message="The catalogue fills up after the first background scrape. Run the seed or scrape command from the README."
          />
        }
      </section>

      @if (drops().length) {
        <section aria-labelledby="drops">
          <div class="mb-4 flex items-end justify-between gap-4">
            <div>
              <h2 id="drops" class="section-title">Fresh price drops</h2>
              <p class="text-sm text-muted">Prices that fell since our last check.</p>
            </div>
            <a routerLink="/sales" [queryParams]="{ tab: 'drops' }" class="shrink-0 text-sm font-medium text-blue hover:underline">All drops →</a>
          </div>
          <ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            @for (d of drops(); track d.product.id) {
              <li>
                <a [routerLink]="['/products', d.product.id]" class="card flex items-center gap-3 p-3 transition-colors hover:border-ink/40">
                  <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-drop/10 text-sm font-bold text-drop"
                    >−{{ d.drop_percentage | number: '1.0-0' }}%</span
                  >
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-sm font-medium">{{ d.product.product_name }}</span>
                    <span class="block text-xs text-muted"
                      >{{ d.product.store_name }} · <s>{{ d.old_price | pkr }}</s> → <b class="text-ink">{{ d.new_price | pkr }}</b></span
                    >
                  </span>
                </a>
              </li>
            }
          </ul>
        </section>
      }
    </div>
  `,
})
export class HomePage {
  private api = inject(ApiService);
  private router = inject(Router);
  protected query = '';
  protected readonly trending = signal<Product[] | null>(null);
  protected readonly overview = signal<SalesOverview | null>(null);
  protected readonly drops = signal<PriceDrop[]>([]);
  protected readonly storeCount = signal(0);

  protected readonly examples = ['Best shirts under 3000', 'Lawn suits on sale', 'Earbuds under 5000', 'Samsung Galaxy', 'Perfume for men', 'Kids sneakers'];
  protected readonly verticals = [
    { key: 'fashion', label: 'Fashion', emoji: '👗', blurb: 'Kurtas, lawn, western, shoes' },
    { key: 'electronics', label: 'Electronics', emoji: '🎧', blurb: 'Phones, audio, gadgets' },
    { key: 'beauty', label: 'Beauty', emoji: '🧴', blurb: 'Fragrance, skin & hair care' },
    { key: 'home', label: 'Home', emoji: '🛏️', blurb: 'Bedding, kitchen, décor' },
  ];

  constructor() {
    this.api
      .trending(undefined, 8)
      .pipe(catchError(() => of({ items: [] as Product[] })))
      .subscribe((res) => this.trending.set(res.items));
    this.api
      .sales()
      .pipe(catchError(() => of(null)))
      .subscribe((ov) => {
        this.overview.set(ov);
        if (ov) {
          this.drops.set(ov.recent_price_drops.slice(0, 6));
          this.storeCount.set(ov.stores.length);
        }
      });
  }

  search(): void {
    const q = this.query.trim();
    this.router.navigate(['/products'], { queryParams: q ? { q } : {} });
  }
}
