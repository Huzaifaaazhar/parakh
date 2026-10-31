import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, map, of, switchMap, tap } from 'rxjs';

import { ApiService } from '../core/api.service';
import { Page, PriceDrop, Product, SalesOverview } from '../core/models';
import { LabelPipe, PkrPipe, TimeAgoPipe } from '../shared/format';
import { ProductCard } from '../shared/product-card';
import { EmptyState, SkeletonGrid } from '../shared/states';

@Component({
  selector: 'app-sales',
  imports: [RouterLink, DecimalPipe, LabelPipe, PkrPipe, TimeAgoPipe, ProductCard, SkeletonGrid, EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let q = params();
    <div class="mx-auto max-w-7xl px-4 pb-16 pt-6 sm:pt-10">
      <h1 class="t-display-lg">Every sale, in one place</h1>
      @if (overview(); as ov) {
        <p class="t-small mt-2">{{ storesOnSale() }} of {{ ov.stores.length }} stores have something on sale right now.</p>
        <dl class="pk-receipt mt-6 max-w-md">
          <div><dt>On sale now</dt><span class="pk-leader"></span><dd class="is-sale">{{ ov.total_on_sale | number }}</dd></div>
          <div><dt>Products tracked</dt><span class="pk-leader"></span><dd>{{ ov.total_products | number }}</dd></div>
          <div><dt>Avg. discount</dt><span class="pk-leader"></span><dd>{{ ov.average_discount | number: '1.0-0' }}%</dd></div>
          <div><dt>Stores on sale</dt><span class="pk-leader"></span><dd>{{ storesOnSale() }} of {{ ov.stores.length }}</dd></div>
        </dl>
      }

      <div class="pk-strip mt-6 -mx-4 px-4 sm:mx-0 sm:px-0" role="group" aria-label="Department">
        <button type="button" class="pk-chip" [attr.aria-pressed]="!q.vertical" (click)="set({ vertical: null })">Everything</button>
        @for (v of verticals; track v) {
          <button type="button" class="pk-chip" [attr.aria-pressed]="q.vertical === v" (click)="set({ vertical: v })">
            {{ v | label }}
            @if (overview()?.by_vertical?.[v]; as n) {
              <span class="pk-chip__count">{{ n }}</span>
            }
          </button>
        }
      </div>

      @if (overview(); as ov) {
        <section class="mt-12 sm:mt-[72px]" aria-labelledby="stores">
          <div class="mb-6 flex items-end justify-between gap-4">
            <h2 id="stores" class="t-display-lg">By store</h2>
            @if (q.store) {
              <button type="button" class="pk-link" (click)="set({ store: null })">Show all stores</button>
            }
          </div>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            @for (s of ov.stores; track s.id) {
              <button type="button" class="pk-storetag" [class.pk-storetag--quiet]="!s.on_sale" (click)="set({ store: q.store === s.slug ? null : s.slug })" [attr.aria-pressed]="q.store === s.slug">
                <div class="pk-storetag__name">{{ s.name }}</div>
                @if (s.on_sale) {
                  <div class="pk-storetag__deal">Up to {{ s.max_discount | number: '1.0-0' }}% off</div>
                  <div class="pk-storetag__meta">{{ s.on_sale | number }} of {{ s.total_products | number }} items · avg {{ s.avg_discount | number: '1.0-0' }}% · {{ s.last_scraped_at | timeAgo }}</div>
                } @else {
                  <div class="pk-storetag__deal">No sale right now</div>
                  <div class="pk-storetag__meta">Checked {{ s.last_scraped_at | timeAgo }}</div>
                }
                <div class="pk-storetag__meter"><span [style.width.%]="s.sale_share"></span></div>
              </button>
            }
          </div>
        </section>
      }

      <section class="mt-12 sm:mt-[72px]" aria-labelledby="deals">
        <h2 id="deals" class="sr-only">Deals</h2>
        <div class="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div class="flex gap-2" role="tablist" aria-label="Deals or price drops">
            <button type="button" role="tab" class="pk-chip" [attr.aria-selected]="q.tab !== 'drops'" [attr.aria-pressed]="q.tab !== 'drops'" (click)="set({ tab: null })">Top deals</button>
            <button type="button" role="tab" class="pk-chip" [attr.aria-selected]="q.tab === 'drops'" [attr.aria-pressed]="q.tab === 'drops'" (click)="set({ tab: 'drops' })">Price drops</button>
          </div>
          @if (q.tab !== 'drops') {
            <label class="flex items-center gap-2">
              <span class="t-label text-charcoal-muted">Sort</span>
              <select class="pk-input w-auto" [value]="q.sort" (change)="set({ sort: $any($event.target).value })">
                <option value="discount">Biggest % off</option>
                <option value="savings">Biggest saving in rupees</option>
                <option value="price_asc">Cheapest first</option>
                <option value="newest">Recently discounted</option>
              </select>
            </label>
          }
        </div>

        @if (q.tab === 'drops') {
          @if (drops() === null) {
            <div class="pk-skel h-40"></div>
          } @else if (drops()!.length) {
            <ul class="pk-ledger max-w-3xl">
              @for (d of drops(); track d.product.id) {
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
          } @else {
            <app-empty-state title="No price drops yet" message="Drops show up once a store has been checked twice and a price has fallen." />
          }
        } @else {
          @let d = deals();
          @if (d === null) {
            <app-skeleton-grid />
          } @else if (d.items.length) {
            <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-6 lg:grid-cols-4">
              @for (p of d.items; track p.id) {
                <app-product-card [product]="p" />
              }
            </div>
            @if (d.total > d.items.length) {
              <div class="mt-8">
                <button type="button" class="pk-btn pk-btn--quiet" (click)="set({ size: (q.size || 24) + 24 })">Show 24 more ({{ d.total - d.items.length | number }} left)</button>
              </div>
            }
          } @else {
            <app-empty-state title="No deals match" message="Try another department or store." />
          }
        }
      </section>
    </div>
  `,
})
export class SalesPage {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  protected readonly verticals = ['fashion', 'electronics', 'beauty', 'home'];

  protected readonly params = toSignal(
    this.route.queryParamMap.pipe(
      map((p) => ({
        vertical: p.get('vertical'),
        store: p.get('store'),
        tab: p.get('tab'),
        sort: p.get('sort') ?? 'discount',
        size: Number(p.get('size')) || 24,
      })),
    ),
    { requireSync: true },
  );

  protected readonly overview = toSignal(
    this.route.queryParamMap.pipe(
      map((p) => p.get('vertical')),
      switchMap((v) => this.api.sales(v ?? undefined).pipe(catchError(() => of(null)))),
    ),
    { initialValue: null as SalesOverview | null },
  );

  protected readonly deals = signal<Page<Product> | null>(null);
  protected readonly drops = signal<PriceDrop[] | null>(null);
  protected readonly storesOnSale = computed(() => this.overview()?.stores.filter((s) => s.on_sale > 0).length ?? 0);

  constructor() {
    this.route.queryParamMap
      .pipe(
        tap(() => {
          this.deals.set(null);
          this.drops.set(null);
        }),
        switchMap((p) => {
          const vertical = p.get('vertical') ?? undefined;
          if (p.get('tab') === 'drops') {
            return this.api.priceDrops(30, 48, vertical).pipe(
              map((d) => ({ drops: p.get('store') ? d.filter((x) => this.storeMatches(x.product, p.get('store')!)) : d })),
              catchError(() => of({ drops: [] as PriceDrop[] })),
            );
          }
          return this.api
            .deals({
              vertical,
              store: p.get('store') ? [p.get('store')!] : undefined,
              sort: (p.get('sort') ?? 'discount') as never,
              page_size: Number(p.get('size')) || 24,
            })
            .pipe(
              map((d) => ({ deals: d })),
              catchError(() => of({ deals: { items: [], total: 0, page: 1, page_size: 24 } as Page<Product> })),
            );
        }),
      )
      .subscribe((res) => {
        if ('drops' in res) this.drops.set(res.drops);
        else this.deals.set(res.deals);
      });
  }

  private storeMatches(product: Product, slug: string): boolean {
    const store = this.overview()?.stores.find((s) => s.slug === slug);
    return !store || product.store_id === store.id;
  }

  withDrop(d: PriceDrop): Product {
    return { ...d.product, old_price: d.old_price, drop_percentage: d.drop_percentage };
  }

  set(changes: Record<string, unknown>): void {
    const extra = 'size' in changes ? {} : { size: null };
    this.router.navigate([], { queryParams: { ...extra, ...changes }, queryParamsHandling: 'merge' });
  }
}
