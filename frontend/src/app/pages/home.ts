import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';

import { ApiService } from '../core/api.service';
import { Facets, Product, SalesOverview } from '../core/models';
import { PkrPipe, TimeAgoPipe } from '../shared/format';
import { ProductCard } from '../shared/product-card';
import { EmptyState, SkeletonGrid } from '../shared/states';

@Component({
  selector: 'app-home',
  imports: [FormsModule, RouterLink, DecimalPipe, PkrPipe, TimeAgoPipe, ProductCard, SkeletonGrid, EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pk-hero pk-on-blue">
      <div class="mx-auto max-w-7xl px-4 pb-14 pt-8 sm:pb-[88px] sm:pt-[72px]">
        <h1 class="t-display-xl max-w-4xl">Compare before you <span class="pk-hero__mark">buy.</span></h1>
        <p class="mt-4 max-w-[34ch] text-[17px] leading-normal sm:max-w-[44ch] sm:text-lg">
          Clothes, shoes, phones and perfumes from {{ storeCount() || 'Pakistani' }} Pakistani stores, matched and price-tracked.
        </p>
        <form (ngSubmit)="search()" class="pk-search mt-6 max-w-2xl" role="search">
          <label for="hero-q" class="sr-only">What are you looking for?</label>
          <input id="hero-q" [(ngModel)]="query" name="q" placeholder="Men's kurta under 4000" autocomplete="off" />
          <button type="submit">Search prices</button>
        </form>
        <div class="mt-3 flex flex-wrap items-center gap-2">
          @for (q of examples; track q) {
            <a class="pk-chip" [routerLink]="['/products']" [queryParams]="{ q }">{{ q }}</a>
          }
          <a routerLink="/assistant" class="pk-btn pk-btn--quiet pk-btn--sm sm:ml-2">Ask the assistant</a>
        </div>
      </div>
    </section>

    <div class="mx-auto max-w-7xl px-4">
      @if (overview(); as ov) {
        <dl class="pk-receipt relative -mt-6 max-w-md">
          <div><dt>Products tracked</dt><span class="pk-leader"></span><dd>{{ ov.total_products | number }}</dd></div>
          <div><dt>On sale now</dt><span class="pk-leader"></span><dd class="is-sale">{{ ov.total_on_sale | number }}</dd></div>
          <div><dt>Avg. discount</dt><span class="pk-leader"></span><dd>{{ ov.average_discount | number: '1.0-0' }}%</dd></div>
          @if (lastChecked(); as lc) {
            <div><dt>Last checked</dt><span class="pk-leader"></span><dd>{{ lc | timeAgo }}</dd></div>
          }
        </dl>
      }

      <section class="mt-12 sm:mt-[72px]" aria-labelledby="departments">
        <h2 id="departments" class="t-display-lg mb-6">Departments</h2>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-6">
          @for (v of verticals; track v.key) {
            <a class="pk-dept" [routerLink]="['/products']" [queryParams]="{ vertical: v.key }">
              <span class="pk-dept__name">{{ v.label }}</span>
              <span>
                <span class="pk-dept__meta">{{ v.blurb }}</span>
                @if (deptCount(v.key); as n) {
                  <span class="pk-dept__count">{{ n | number }} items</span>
                }
              </span>
            </a>
          }
        </div>
      </section>

      @if (overview(); as ov) {
        <section class="mt-12 sm:mt-[72px]" aria-labelledby="on-sale">
          <div class="mb-6 flex items-end justify-between gap-4">
            <h2 id="on-sale" class="t-display-lg">Who's on sale right now</h2>
            <a routerLink="/sales" class="pk-link shrink-0">All sales</a>
          </div>
          <div class="pk-strip -mx-4 px-4 sm:mx-0 sm:px-0">
            @for (s of ov.stores.slice(0, 10); track s.id) {
              <a class="pk-storetag" [class.pk-storetag--quiet]="!s.on_sale" [routerLink]="['/sales']" [queryParams]="{ store: s.slug }">
                <div class="pk-storetag__name">{{ s.name }}</div>
                @if (s.on_sale) {
                  <div class="pk-storetag__deal">Up to {{ s.max_discount | number: '1.0-0' }}% off</div>
                  <div class="pk-storetag__meta">{{ s.on_sale | number }} of {{ s.total_products | number }} items</div>
                } @else {
                  <div class="pk-storetag__deal">No sale right now</div>
                  <div class="pk-storetag__meta">Checked {{ s.last_scraped_at | timeAgo }}</div>
                }
                <div class="pk-storetag__meter"><span [style.width.%]="s.sale_share"></span></div>
              </a>
            }
          </div>
        </section>
      }

      <section class="mt-12 sm:mt-[72px]" aria-labelledby="best-value">
        <div class="mb-6 flex items-end justify-between gap-4">
          <div>
            <h2 id="best-value" class="t-display-lg">Best value</h2>
            <p class="t-small mt-2">Big discounts on items priced below similar products.</p>
          </div>
          <a routerLink="/products" [queryParams]="{ sort: 'value' }" class="pk-link shrink-0">See more</a>
        </div>
        @if (trending() === null) {
          <app-skeleton-grid [count]="8" />
        } @else if (trending()!.length) {
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-6 lg:grid-cols-4">
            @for (p of trending(); track p.id) {
              <app-product-card [product]="p" />
            }
          </div>
        } @else {
          <app-empty-state title="No products yet" message="The catalogue fills up after the first background scrape." />
        }
      </section>

      @if (overview()?.recent_price_drops?.length) {
        <section class="mt-12 sm:mt-[72px]" aria-labelledby="drops">
          <div class="mb-6 flex items-end justify-between gap-4">
            <h2 id="drops" class="t-display-lg">Fresh price drops</h2>
            <a routerLink="/sales" [queryParams]="{ tab: 'drops' }" class="pk-link shrink-0">All drops</a>
          </div>
          <ul class="pk-ledger max-w-3xl">
            @for (d of overview()!.recent_price_drops.slice(0, 6); track d.product.id) {
              <li>
                <a class="pk-drop" [routerLink]="['/products', d.product.id]">
                  <span class="pk-drop__pct">−{{ d.drop_percentage | number: '1.0-0' }}%</span>
                  <span class="min-w-0">
                    <span class="pk-drop__name">{{ d.product.product_name }}</span>
                    <span class="pk-drop__store">{{ d.product.store_name }} · {{ d.detected_at | timeAgo }}</span>
                  </span>
                  <span class="pk-drop__prices">
                    <span class="pk-price__now block">{{ d.new_price | pkr }}</span>
                    <span class="pk-price__was"><span class="sr-only">was </span>{{ d.old_price | pkr }}</span>
                  </span>
                </a>
              </li>
            }
          </ul>
        </section>
      }
      <div class="h-12 sm:h-[72px]"></div>
    </div>
  `,
})
export class HomePage {
  private api = inject(ApiService);
  private router = inject(Router);
  protected query = '';
  protected readonly trending = signal<Product[] | null>(null);
  protected readonly overview = signal<SalesOverview | null>(null);
  protected readonly facets = signal<Facets | null>(null);
  protected readonly storeCount = computed(() => this.overview()?.stores.length ?? 0);
  protected readonly lastChecked = computed(() => {
    const times = (this.overview()?.stores ?? []).map((s) => s.last_scraped_at).filter((t): t is string => !!t);
    return times.length ? [...times].sort().at(-1)! : null;
  });

  protected readonly examples = ['Lawn suits on sale', 'Earbuds under 5000', "Men's kurta under 4000", 'Perfume for men', 'Kids sneakers'];
  protected readonly verticals = [
    { key: 'fashion', label: 'Fashion', blurb: 'Kurtas, lawn, western, shoes' },
    { key: 'electronics', label: 'Electronics', blurb: 'Phones, audio, gadgets' },
    { key: 'beauty', label: 'Beauty', blurb: 'Fragrance, skin and hair' },
    { key: 'home', label: 'Home', blurb: 'Bedding, kitchen, décor' },
  ];

  constructor() {
    this.api
      .trending(undefined, 8)
      .pipe(catchError(() => of({ items: [] as Product[] })))
      .subscribe((res) => this.trending.set(res.items));
    this.api
      .sales()
      .pipe(catchError(() => of(null)))
      .subscribe((ov) => this.overview.set(ov));
    this.api
      .facets()
      .pipe(catchError(() => of(null)))
      .subscribe((f) => this.facets.set(f));
  }

  deptCount(vertical: string): number | null {
    return this.facets()?.verticals.find((v) => v.value === vertical)?.count ?? null;
  }

  search(): void {
    const q = this.query.trim();
    this.router.navigate(['/products'], { queryParams: q ? { q } : {} });
  }
}
