import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, map, of, switchMap, tap } from 'rxjs';

import { ApiService } from '../core/api.service';
import { Page, PriceDrop, Product, SalesOverview } from '../core/models';
import { LabelPipe, TimeAgoPipe } from '../shared/format';
import { ProductCard } from '../shared/product-card';
import { EmptyState, SkeletonGrid } from '../shared/states';

@Component({
  selector: 'app-sales',
  imports: [DecimalPipe, LabelPipe, TimeAgoPipe, ProductCard, SkeletonGrid, EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let q = params();
    <section class="bg-brand-reverse relative overflow-hidden text-white">
      <div class="pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full bg-pink/40 blur-3xl" aria-hidden="true"></div>
      <div class="mx-auto max-w-7xl px-4 py-10">
        <p class="relative text-xs font-semibold uppercase tracking-[0.2em] text-pink-light">Sale aggregator</p>
        <h1 class="relative mt-2 text-4xl font-semibold sm:text-5xl">Every sale, in one place</h1>
        @if (overview(); as ov) {
          <p class="mt-3 max-w-2xl text-white/85">
            <b class="text-white">{{ ov.total_on_sale | number }}</b> of {{ ov.total_products | number }} products are discounted right now, averaging
            <b class="text-white">{{ ov.average_discount | number: '1.0-0' }}% off</b> across {{ storesOnSale() }} stores.
          </p>
        }
        <div class="mt-6 flex flex-wrap gap-2" role="group" aria-label="Department">
          <button type="button" [class]="!q.vertical ? 'chip-active' : 'chip'" (click)="set({ vertical: null })">Everything</button>
          @for (v of verticals; track v) {
            <button type="button" [class]="q.vertical === v ? 'chip-active' : 'chip'" (click)="set({ vertical: v })">
              {{ v | label }}
              @if (overview()?.by_vertical?.[v]; as n) {
                <span class="opacity-60">{{ n }}</span>
              }
            </button>
          }
        </div>
      </div>
    </section>

    <div class="mx-auto max-w-7xl px-4 py-8">
      @if (overview(); as ov) {
        <section aria-labelledby="stores" class="mb-10">
          <h2 id="stores" class="section-title mb-4">Sales by store</h2>
          <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            @for (s of ov.stores; track s.id) {
              <button
                type="button"
                (click)="set({ store: q.store === s.slug ? null : s.slug })"
                [attr.aria-pressed]="q.store === s.slug"
                class="card p-4 text-left transition-colors hover:border-ink/40"
                [class.ring-2]="q.store === s.slug"
                [class.ring-ink]="q.store === s.slug"
              >
                <div class="flex items-baseline justify-between gap-2">
                  <p class="truncate font-semibold">{{ s.name }}</p>
                  @if (s.on_sale) {
                    <p class="shrink-0 text-sm font-semibold text-sale">−{{ s.max_discount | number: '1.0-0' }}%</p>
                  }
                </div>
                <p class="mt-1 text-xs text-muted">
                  @if (s.on_sale) {
                    {{ s.on_sale }} on sale · avg {{ s.avg_discount | number: '1.0-0' }}% off
                  } @else {
                    No sale right now
                  }
                </p>
                <div class="mt-3 h-1.5 overflow-hidden rounded-full bg-line">
                  <div class="h-full rounded-full bg-sale" [style.width.%]="s.sale_share"></div>
                </div>
                <p class="mt-2 text-[11px] text-muted">{{ s.sale_share | number: '1.0-0' }}% of catalogue · updated {{ s.last_scraped_at | timeAgo }}</p>
              </button>
            }
          </div>
        </section>
      }

      <div class="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div class="flex gap-2" role="tablist">
          <button
            type="button"
            role="tab"
            [attr.aria-selected]="q.tab !== 'drops'"
            [class]="q.tab !== 'drops' ? 'chip-active' : 'chip'"
            (click)="set({ tab: null })"
          >
            Top deals
          </button>
          <button
            type="button"
            role="tab"
            [attr.aria-selected]="q.tab === 'drops'"
            [class]="q.tab === 'drops' ? 'chip-active' : 'chip'"
            (click)="set({ tab: 'drops' })"
          >
            Recent price drops
          </button>
        </div>
        @if (q.tab !== 'drops') {
          <label class="flex items-center gap-2 text-sm">
            <span class="text-muted">Sort</span>
            <select class="input w-auto py-1.5" [value]="q.sort" (change)="set({ sort: $any($event.target).value })">
              <option value="discount">Biggest % off</option>
              <option value="savings">Biggest savings (Rs)</option>
              <option value="price_asc">Cheapest first</option>
              <option value="newest">Recently discounted</option>
            </select>
          </label>
        }
      </div>

      @if (q.tab === 'drops') {
        @if (drops() === null) {
          <app-skeleton-grid />
        } @else if (drops()!.length) {
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
            @for (d of drops(); track d.product.id) {
              <app-product-card [product]="withDrop(d)" />
            }
          </div>
        } @else {
          <app-empty-state title="No price drops recently" message="We'll list items here as soon as a store cuts a price." />
        }
      } @else {
        @let d = deals();
        @if (d === null) {
          <app-skeleton-grid />
        } @else if (d.items.length) {
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
            @for (p of d.items; track p.id) {
              <app-product-card [product]="p" />
            }
          </div>
          @if (d.total > d.items.length) {
            <div class="mt-8 text-center">
              <button type="button" class="btn-ghost" (click)="set({ size: (q.size || 24) + 24 })">Show more ({{ d.total - d.items.length }} left)</button>
            </div>
          }
        } @else {
          <app-empty-state title="No deals match" message="Try another department or store." />
        }
      }
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
