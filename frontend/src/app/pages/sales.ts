import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, signal, viewChildren } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, map, of, switchMap, tap } from 'rxjs';

import { ApiService } from '../core/api.service';
import { Page, PriceDrop, Product, SalesOverview } from '../core/models';
import { LabelPipe, PkrPipe, TimeAgoPipe } from '../shared/format';
import { ProductCard } from '../shared/product-card';
import { CountUp, Reveal } from '../shared/motion';
import { PageHero } from '../shared/page-hero';
import { EmptyState, SkeletonGrid } from '../shared/states';

@Component({
  selector: 'app-sales',
  imports: [RouterLink, DecimalPipe, LabelPipe, PkrPipe, TimeAgoPipe, ProductCard, SkeletonGrid, EmptyState, Reveal, CountUp, PageHero],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let q = params();
    <app-page-hero
      variant="pink"
      eyebrow="Sale aggregator"
      title="Every sale, in one place"
      [subtitle]="overview() ? storesOnSale() + ' of ' + overview()!.stores.length + ' stores have something on sale right now.' : 'Live sale status across every store we track.'"
      [images]="heroImages()"
    >
      <div class="flex flex-wrap gap-2" role="group" aria-label="Department">
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
    </app-page-hero>

    <div class="mx-auto max-w-7xl px-4 pb-16">
      @if (overview(); as ov) {
        <div appReveal class="pk-print relative z-[3] -mt-6 max-w-md">
          <dl class="pk-receipt">
            <div><dt>On sale now</dt><span class="pk-leader"></span><dd class="is-sale" [appCountUp]="ov.total_on_sale"></dd></div>
            <div><dt>Products tracked</dt><span class="pk-leader"></span><dd [appCountUp]="ov.total_products"></dd></div>
            <div><dt>Avg. discount</dt><span class="pk-leader"></span><dd [appCountUp]="ov.average_discount" suffix="%"></dd></div>
            <div><dt>Stores on sale</dt><span class="pk-leader"></span><dd>{{ storesOnSale() }} of {{ ov.stores.length }}</dd></div>
          </dl>
        </div>

        <section class="mt-12 sm:mt-16" aria-labelledby="stores">
          <div class="mb-5 flex items-end justify-between gap-4">
            <div>
              <h2 id="stores" class="t-display-lg">By store</h2>
              <p class="t-small mt-2">Tap a store to see only its deals.</p>
            </div>
            @if (q.store) {
              <button type="button" class="pk-link" (click)="set({ store: null })">Show all stores</button>
            }
          </div>
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            @for (s of ov.stores; track s.id; let i = $index) {
              <button
                type="button"
                [appReveal]="i"
                class="pk-storecard !w-auto text-left"
                [class.pk-storecard--quiet]="!s.on_sale"
                [class.ring-2]="q.store === s.slug"
                [class.ring-blue]="q.store === s.slug"
                (click)="set({ store: q.store === s.slug ? null : s.slug })"
                [attr.aria-pressed]="q.store === s.slug"
              >
                <span>
                  <span class="block font-sans text-[15px] font-bold text-blue">{{ s.name }}</span>
                  <span class="t-small block">{{ s.on_sale ? (s.on_sale | number) + ' of ' + (s.total_products | number) : 'Checked ' + (s.last_scraped_at | timeAgo) }}</span>
                </span>
                <span>
                  @if (s.on_sale) {
                    <span class="pk-storecard__pct block">−{{ s.max_discount | number: '1.0-0' }}%</span>
                    <span class="t-small block">avg {{ s.avg_discount | number: '1.0-0' }}% off</span>
                  } @else {
                    <span class="pk-storecard__pct block">No sale</span>
                  }
                  <span class="pk-storetag__meter block"><span [style.width.%]="s.sale_share"></span></span>
                </span>
              </button>
            }
          </div>
        </section>
      }

      <section class="mt-12 sm:mt-16" aria-labelledby="deals">
        <h2 id="deals" class="sr-only">Deals</h2>
        <div class="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div class="pk-tabs" role="tablist" aria-label="Deals or price drops">
            <span class="pk-tabs__pill" [style.width.px]="pill().w" [style.transform]="'translateX(' + pill().x + 'px)'" aria-hidden="true"></span>
            <button #dealTab type="button" role="tab" [attr.aria-selected]="q.tab !== 'drops'" (click)="set({ tab: null })">Top deals</button>
            <button #dealTab type="button" role="tab" [attr.aria-selected]="q.tab === 'drops'" (click)="set({ tab: 'drops' })">Price drops</button>
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
              @for (p of d.items; track p.id; let i = $index) {
                <app-product-card [product]="p" [appReveal]="i % 24" />
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
  private dealTabs = viewChildren<ElementRef<HTMLButtonElement>>('dealTab');
  protected readonly pill = signal({ x: 0, w: 0 });
  protected readonly heroImages = computed(() => (this.overview()?.top_deals ?? []).map((p) => p.image_url).filter(Boolean).slice(0, 3));
  protected readonly storesOnSale = computed(() => this.overview()?.stores.filter((s) => s.on_sale > 0).length ?? 0);

  constructor() {
    effect(() => {
      const btn = this.dealTabs()[this.params().tab === 'drops' ? 1 : 0]?.nativeElement;
      if (btn) this.pill.set({ x: btn.offsetLeft - 4, w: btn.offsetWidth });
    });
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
