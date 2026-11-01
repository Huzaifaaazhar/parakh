import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, signal, viewChildren } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, map, of, switchMap, tap } from 'rxjs';

import { ApiService } from '../core/api.service';
import { OffersResponse, Page, PriceDrop, Product, Restaurant } from '../core/models';
import { PkrPipe, TimeAgoPipe } from '../shared/format';
import { ProductCard } from '../shared/product-card';
import { CountUp, Reveal } from '../shared/motion';
import { PageHero } from '../shared/page-hero';
import { EmptyState, SkeletonGrid } from '../shared/states';

type Tab = 'combos' | 'offers' | 'drops';

@Component({
  selector: 'app-sales',
  imports: [RouterLink, DecimalPipe, PkrPipe, TimeAgoPipe, ProductCard, SkeletonGrid, EmptyState, Reveal, CountUp, PageHero],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let q = params();
    <app-page-hero
      variant="amber"
      eyebrow="Deals & offers"
      title="Every deal, every restaurant."
      [subtitle]="offers() ? offerCount() + ' restaurant offers and ' + (comboCount() | number) + ' combo deals, read from their own ordering sites.' : 'Live offers and combo deals across the restaurants we read.'"
      [images]="heroImages()"
    >
      <div class="flex flex-wrap gap-2" role="group" aria-label="City">
        <button type="button" class="pk-chip" [attr.aria-pressed]="!q.city" (click)="set({ city: null })">All cities</button>
        @for (c of cities(); track c) {
          <button type="button" class="pk-chip" [attr.aria-pressed]="q.city === c" (click)="set({ city: c })">{{ c }}</button>
        }
      </div>
    </app-page-hero>

    <div class="mx-auto max-w-7xl px-4 pb-16">
      @if (offers(); as o) {
        <div appReveal class="pk-print relative z-[3] -mt-6 max-w-md">
          <dl class="pk-receipt">
            <div><dt>Restaurant offers</dt><span class="pk-leader"></span><dd class="is-sale" [appCountUp]="o.restaurant_offers.length"></dd></div>
            <div><dt>Combo deals</dt><span class="pk-leader"></span><dd [appCountUp]="comboCount()"></dd></div>
            <div><dt>Best offer</dt><span class="pk-leader"></span><dd [appCountUp]="bestOffer()" suffix="%"></dd></div>
            <div><dt>Restaurants read</dt><span class="pk-leader"></span><dd [appCountUp]="restaurants().length"></dd></div>
          </dl>
        </div>

        <section class="mt-12 sm:mt-16" aria-labelledby="running">
          <div class="mb-5">
            <h2 id="running" class="t-display-lg">Offers running now</h2>
            <p class="t-small mt-2">Whole-menu discounts each restaurant is running on its own site. Check the terms when you order.</p>
          </div>
          @if (o.restaurant_offers.length) {
            <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              @for (ro of o.restaurant_offers; track ro.restaurant.id + ro.offer.id; let i = $index) {
                <a [appReveal]="i" class="pk-storecard !w-auto" [routerLink]="['/restaurants', ro.restaurant.slug]">
                  <span>
                    <span class="block font-sans text-[15px] font-bold text-sage">{{ ro.restaurant.name }}</span>
                    <span class="t-small block">{{ ro.offer.detail }}</span>
                  </span>
                  <span>
                    <span class="pk-storecard__pct block">{{ ro.offer.percent ? '−' + (ro.offer.percent | number: '1.0-0') + '%' : ro.offer.title }}</span>
                    <span class="t-small block">
                      {{ ro.offer.channels?.length ? ro.offer.channels!.join(' & ') : 'all orders' }}
                      @if (ro.offer.max_discount) {
                        · up to {{ ro.offer.max_discount | pkr }}
                      }
                    </span>
                  </span>
                </a>
              }
            </div>
          } @else {
            <app-empty-state title="No restaurant-wide offers right now" message="Combo deals below are still running." />
          }
        </section>
      }

      <section class="mt-12 sm:mt-16" aria-labelledby="deals">
        <h2 id="deals" class="sr-only">Deals</h2>
        <div class="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div class="pk-tabs" role="tablist" aria-label="Kind of deal">
            <span class="pk-tabs__pill" [style.width.px]="pill().w" [style.transform]="'translateX(' + pill().x + 'px)'" aria-hidden="true"></span>
            @for (t of tabs; track t.key) {
              <button #dealTab type="button" role="tab" [attr.aria-selected]="q.tab === t.key" (click)="set({ tab: t.key === 'combos' ? null : t.key })">{{ t.label }}</button>
            }
          </div>
          @if (q.tab === 'combos') {
            <label class="flex items-center gap-2">
              <span class="t-label text-charcoal-muted">Sort</span>
              <select class="pk-input w-auto" [value]="q.sort" (change)="set({ sort: $any($event.target).value })">
                <option value="price_asc">Cheapest first</option>
                <option value="value">Best value</option>
                <option value="price_desc">Biggest first</option>
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
                  <a class="pk-drop" [routerLink]="['/dishes', d.product.id]">
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
            <app-empty-state title="No menu price drops yet" message="Drops show up once a menu has been read twice and a price has fallen." />
          }
        } @else {
          @let d = items();
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
            <app-empty-state
              [title]="q.tab === 'offers' ? 'No dishes on offer' : 'No combo deals here'"
              [message]="q.tab === 'offers' ? 'Restaurant-wide offers above still apply.' : 'Try another city.'"
            />
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
  protected readonly tabs: { key: Tab; label: string }[] = [
    { key: 'combos', label: 'Combo deals' },
    { key: 'offers', label: 'Dishes on offer' },
    { key: 'drops', label: 'Price drops' },
  ];

  protected readonly params = toSignal(
    this.route.queryParamMap.pipe(
      map((p) => ({
        city: p.get('city'),
        tab: (p.get('tab') as Tab | null) ?? 'combos',
        sort: p.get('sort') ?? 'price_asc',
        size: Number(p.get('size')) || 24,
      })),
    ),
    { requireSync: true },
  );

  protected readonly restaurants = toSignal(this.api.restaurants().pipe(catchError(() => of([] as Restaurant[]))), { initialValue: [] as Restaurant[] });
  protected readonly cities = computed(() => [...new Set(this.restaurants().flatMap((r) => r.cities))].sort());

  protected readonly offers = toSignal(
    this.route.queryParamMap.pipe(
      map((p) => p.get('city')),
      switchMap((c) => this.api.offers(c ?? undefined, 12).pipe(catchError(() => of(null)))),
    ),
    { initialValue: null as OffersResponse | null },
  );
  protected readonly offerCount = computed(() => this.offers()?.restaurant_offers.length ?? 0);
  protected readonly bestOffer = computed(() => Math.max(0, ...(this.offers()?.restaurant_offers ?? []).map((o) => o.offer.percent ?? 0)));
  protected readonly comboCount = signal(0);

  protected readonly items = signal<Page<Product> | null>(null);
  protected readonly drops = signal<PriceDrop[] | null>(null);
  private dealTabs = viewChildren<ElementRef<HTMLButtonElement>>('dealTab');
  protected readonly pill = signal({ x: 0, w: 0 });
  protected readonly heroImages = computed(() => (this.offers()?.deal_items ?? []).map((p) => p.image_url).filter(Boolean).slice(0, 3));

  constructor() {
    effect(() => {
      const i = this.tabs.findIndex((t) => t.key === this.params().tab);
      const btn = this.dealTabs()[Math.max(0, i)]?.nativeElement;
      if (btn) this.pill.set({ x: btn.offsetLeft - 4, w: btn.offsetWidth });
    });
    this.api
      .products({ category: 'deal', page_size: 1 })
      .pipe(catchError(() => of({ total: 0 })))
      .subscribe((r) => this.comboCount.set(r.total));
    this.route.queryParamMap
      .pipe(
        tap(() => {
          this.items.set(null);
          this.drops.set(null);
        }),
        switchMap((p) => {
          const city = p.get('city') ?? undefined;
          const size = Number(p.get('size')) || 24;
          if (p.get('tab') === 'drops') {
            return this.api.priceDrops(30, 48).pipe(
              map((d) => ({ drops: d })),
              catchError(() => of({ drops: [] as PriceDrop[] })),
            );
          }
          const req =
            p.get('tab') === 'offers'
              ? this.api.deals({ city, page_size: size, sort: 'discount' })
              : this.api.products({ category: 'deal', city, page_size: size, sort: (p.get('sort') ?? 'price_asc') as never });
          return req.pipe(
            map((d) => ({ items: d })),
            catchError(() => of({ items: { items: [], total: 0, page: 1, page_size: size } as Page<Product> })),
          );
        }),
      )
      .subscribe((res) => {
        if ('drops' in res) this.drops.set(res.drops);
        else this.items.set(res.items);
      });
  }

  set(changes: Record<string, unknown>): void {
    const extra = 'size' in changes ? {} : { size: null };
    this.router.navigate([], { queryParams: { ...extra, ...changes }, queryParamsHandling: 'merge' });
  }
}
