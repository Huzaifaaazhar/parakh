import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { Observable, catchError, distinctUntilChanged, map, of, switchMap, tap } from 'rxjs';

import { ApiService } from '../core/api.service';
import { Facets, Page, Product, ProductFilters, SearchResponse, SortOption } from '../core/models';
import { LabelPipe, PkrPipe } from '../shared/format';
import { ProductCard } from '../shared/product-card';
import { EmptyState, SkeletonGrid } from '../shared/states';

type Result = (Page<Product> & Partial<Pick<SearchResponse, 'parsed_filters' | 'semantic'>>) | { error: true };

function filtersFrom(params: ParamMap): ProductFilters {
  const num = (k: string) => (params.get(k) ? Number(params.get(k)) : undefined);
  return {
    q: params.get('q') ?? undefined,
    vertical: params.get('vertical') ?? undefined,
    category: params.get('category') ?? undefined,
    gender: params.get('gender') ?? undefined,
    store: params.getAll('store').length ? params.getAll('store') : undefined,
    color: params.get('color') ?? undefined,
    min_price: num('min_price'),
    max_price: num('max_price'),
    on_sale: params.get('on_sale') === 'true',
    sort: (params.get('sort') as SortOption) ?? 'relevance',
    page: num('page') ?? 1,
    page_size: 24,
  };
}

@Component({
  selector: 'app-products',
  imports: [FormsModule, DecimalPipe, PkrPipe, LabelPipe, ProductCard, SkeletonGrid, EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let f = filters();
    <div class="mx-auto max-w-7xl px-4 pt-6 sm:pt-10">
      <h1 class="t-display-lg">
        @if (f.q) {
          “{{ f.q }}”
        } @else if (f.category) {
          {{ f.category | label }}
        } @else if (f.vertical) {
          {{ f.vertical | label }}
        } @else {
          All products
        }
      </h1>
      @if (result(); as r) {
        @if (!isError(r)) {
          <p class="t-small mt-2">
            <span class="font-mono text-blue">{{ r.total | number }}</span> items across stores
            @if (understood().length) {
              <span> · showing {{ understood().join(' · ') }}</span>
            }
          </p>
        }
      }
    </div>

    <div class="sticky top-14 z-20 mt-4 border-b border-line bg-paper">
      <div class="mx-auto max-w-7xl px-4 py-3">
        <form (ngSubmit)="submitSearch()" class="pk-search pk-search--sm" role="search">
          <label for="browse-q" class="sr-only">Search products</label>
          <input id="browse-q" [(ngModel)]="draftQuery" name="q" placeholder="Search kurtas, phones, perfumes" autocomplete="off" />
          <button type="submit">Search</button>
        </form>
        <div class="pk-strip mt-3 -mx-4 px-4 sm:mx-0 sm:px-0" role="group" aria-label="Quick filters">
          <button type="button" class="pk-chip lg:hidden" (click)="showFilters.set(true)" aria-haspopup="dialog">
            Filters
            @if (activeCount()) {
              <span class="pk-tray__count h-5 min-w-5 text-[11px]">{{ activeCount() }}</span>
            }
          </button>
          <button type="button" class="pk-chip" [attr.aria-pressed]="!!f.on_sale" (click)="update({ on_sale: f.on_sale ? null : true })">On sale</button>
          @for (g of genders; track g) {
            <button type="button" class="pk-chip" [attr.aria-pressed]="f.gender === g" (click)="update({ gender: f.gender === g ? null : g })">{{ g | label }}</button>
          }
          @for (b of [2000, 5000]; track b) {
            <button type="button" class="pk-chip" [attr.aria-pressed]="f.max_price === b && !f.min_price" (click)="update({ min_price: null, max_price: f.max_price === b ? null : b })">
              Under {{ b | pkr }}
            </button>
          }
          @for (v of facets()?.verticals ?? []; track v.value) {
            @if (v.value !== 'other') {
              <button type="button" class="pk-chip" [attr.aria-pressed]="f.vertical === v.value" (click)="update({ vertical: f.vertical === v.value ? null : v.value, category: null })">
                {{ v.value | label }} <span class="pk-chip__count">{{ v.count }}</span>
              </button>
            }
          }
        </div>
      </div>
    </div>

    <div class="mx-auto grid max-w-7xl gap-8 px-4 pb-16 pt-6 lg:grid-cols-[240px_1fr]">
      @if (showFilters()) {
        <div class="fixed inset-0 z-40 bg-charcoal/40 lg:hidden" (click)="showFilters.set(false)" aria-hidden="true"></div>
      }
      <aside
        class="space-y-6 lg:static lg:block lg:bg-transparent lg:p-0"
        [class.hidden]="!showFilters()"
        [class.pk-sheet]="showFilters()"
        [class.filters-sheet]="showFilters()"
        [attr.role]="showFilters() ? 'dialog' : null"
        [attr.aria-label]="'Filters'"
      >
        <div class="flex items-center justify-between lg:hidden">
          <p class="t-heading">Filters</p>
          <button type="button" class="pk-btn pk-btn--primary pk-btn--sm" (click)="showFilters.set(false)">Show results</button>
        </div>

        <label class="block">
          <span class="t-label mb-2 block text-blue">Category</span>
          <select class="pk-input" [ngModel]="f.category ?? ''" (ngModelChange)="update({ category: $event || null })" name="category">
            <option value="">Any category</option>
            @for (c of facets()?.categories ?? []; track c.value) {
              @if (c.value !== 'other') {
                <option [value]="c.value">{{ c.value | label }} ({{ c.count }})</option>
              }
            }
          </select>
        </label>

        <fieldset>
          <legend class="t-label mb-2 text-blue">Price</legend>
          <div class="flex items-center gap-2">
            <input class="pk-input font-mono" type="number" min="0" inputmode="numeric" placeholder="Min" [(ngModel)]="minPrice" name="min" aria-label="Minimum price in rupees" />
            <span class="text-charcoal-muted">–</span>
            <input class="pk-input font-mono" type="number" min="0" inputmode="numeric" placeholder="Max" [(ngModel)]="maxPrice" name="max" aria-label="Maximum price in rupees" />
          </div>
          <div class="mt-2 flex flex-wrap gap-2">
            @for (b of budgets; track b) {
              <button type="button" class="pk-chip" [attr.aria-pressed]="f.max_price === b && !f.min_price" (click)="minPrice = null; maxPrice = b; applyPrice()">Under {{ b | pkr }}</button>
            }
          </div>
          <button type="button" class="pk-btn pk-btn--quiet pk-btn--sm mt-3 w-full" (click)="applyPrice()">Apply price</button>
        </fieldset>

        @if (facets()?.stores?.length) {
          <fieldset>
            <legend class="t-label mb-2 text-blue">Stores</legend>
            <div class="max-h-72 overflow-y-auto border-t border-line">
              @for (s of facets()!.stores; track s.value) {
                <label class="flex min-h-11 cursor-pointer items-center gap-3 border-b border-line px-1 hover:bg-blue-tint">
                  <input type="checkbox" class="h-[18px] w-[18px] accent-blue" [checked]="f.store?.includes(s.value)" (change)="toggleStore(s.value)" />
                  <span class="flex-1 text-[15px]">{{ s.value | label }}</span>
                  <span class="font-mono text-xs text-charcoal-muted">{{ s.count }}</span>
                </label>
              }
            </div>
          </fieldset>
        }

        @if (hasFilters()) {
          <button type="button" class="pk-link" (click)="clear()">Clear all filters</button>
        }
      </aside>

      <section aria-live="polite" aria-label="Results">
        <div class="mb-4 flex items-center justify-end">
          <label class="flex items-center gap-2">
            <span class="t-label text-charcoal-muted">Sort</span>
            <select class="pk-input w-auto" [ngModel]="f.sort" (ngModelChange)="update({ sort: $event })" name="sort">
              @for (s of sorts; track s.value) {
                <option [value]="s.value">{{ s.label }}</option>
              }
            </select>
          </label>
        </div>
        @let r = result();
        @if (loading()) {
          <app-skeleton-grid [count]="12" />
        } @else if (r && isError(r)) {
          <app-empty-state title="We couldn't load products" message="The price service isn't answering. Try again in a moment." actionLabel="Try again" (action)="reload()" />
        } @else if (r && r.items.length) {
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-6 xl:grid-cols-4">
            @for (p of r.items; track p.id) {
              <app-product-card [product]="p" />
            }
          </div>
          @if (totalPages() > 1) {
            <nav class="mt-10 flex items-center justify-between gap-3 border-t border-line pt-4" aria-label="Pagination">
              <button type="button" class="pk-btn pk-btn--quiet pk-btn--sm" [disabled]="(f.page ?? 1) <= 1" (click)="update({ page: (f.page ?? 1) - 1 }, false)">Previous</button>
              <span class="t-receipt">Page {{ f.page }} of {{ totalPages() }}</span>
              <button type="button" class="pk-btn pk-btn--quiet pk-btn--sm" [disabled]="(f.page ?? 1) >= totalPages()" (click)="update({ page: (f.page ?? 1) + 1 }, false)">Next</button>
            </nav>
          }
        } @else {
          <app-empty-state title="Nothing matched" message="Try a broader search, raise your budget, or clear a filter." actionLabel="Clear filters" (action)="clear()" />
        }
      </section>
    </div>
  `,
})
export class ProductsPage {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  protected readonly sorts: { value: SortOption; label: string }[] = [
    { value: 'relevance', label: 'Most relevant' },
    { value: 'value', label: 'Best value' },
    { value: 'discount', label: 'Biggest discount' },
    { value: 'price_asc', label: 'Price: low to high' },
    { value: 'price_desc', label: 'Price: high to low' },
    { value: 'newest', label: 'Newest' },
  ];
  protected readonly genders = ['women', 'men', 'kids'];
  protected readonly budgets = [2000, 5000, 10000, 50000];
  protected readonly showFilters = signal(false);
  protected readonly loading = signal(true);
  protected minPrice: number | null = null;
  protected draftQuery = this.route.snapshot.queryParamMap.get('q') ?? '';
  protected maxPrice: number | null = null;

  protected readonly filters = toSignal(this.route.queryParamMap.pipe(map(filtersFrom)), { initialValue: filtersFrom(this.route.snapshot.queryParamMap) });

  protected readonly facets = toSignal(
    this.route.queryParamMap.pipe(
      map((p) => p.get('vertical') ?? ''),
      distinctUntilChanged(),
      switchMap((v) => this.api.facets(v || undefined).pipe(catchError(() => of(null)))),
    ),
    { initialValue: null as Facets | null },
  );

  private readonly reloadTick = signal(0);
  protected readonly result = toSignal(
    this.route.queryParamMap.pipe(
      map(filtersFrom),
      tap((f) => {
        this.loading.set(true);
        this.minPrice = f.min_price ?? null;
        this.maxPrice = f.max_price ?? null;
        this.draftQuery = f.q ?? '';
      }),
      switchMap((f): Observable<Result | null> => {
        const { q, ...rest } = f;
        const req: Observable<Result> = q ? this.api.search(q, rest) : this.api.products(rest);
        return req.pipe(catchError(() => of({ error: true as const })));
      }),
      tap(() => this.loading.set(false)),
    ),
    { initialValue: null as Result | null },
  );

  protected readonly totalPages = computed(() => {
    const r = this.result();
    return r && !this.isError(r) ? (r.pages ?? Math.ceil(r.total / r.page_size)) : 1;
  });

  protected readonly understood = computed(() => {
    const r = this.result();
    if (!r || this.isError(r) || !r.parsed_filters) return [];
    const pf = r.parsed_filters as Record<string, string | number | boolean | null>;
    const out: string[] = [];
    if (pf['category']) out.push(String(pf['category']).replace('-', ' '));
    if (pf['gender']) out.push(`for ${pf['gender']}`);
    if (pf['color']) out.push(String(pf['color']));
    if (pf['brand']) out.push(String(pf['brand']));
    if (pf['min_price'] && pf['max_price']) out.push(`Rs ${pf['min_price']}–${pf['max_price']}`);
    else if (pf['max_price']) out.push(`under Rs ${pf['max_price']}`);
    else if (pf['min_price']) out.push(`above Rs ${pf['min_price']}`);
    if (pf['on_sale']) out.push('on sale');
    return out;
  });

  protected readonly hasFilters = computed(() => {
    const f = this.filters();
    return !!(f.vertical || f.category || f.gender || f.store || f.min_price || f.max_price || f.on_sale || f.color);
  });

  protected readonly activeCount = computed(() => {
    const f = this.filters();
    return [f.vertical, f.category, f.gender, f.min_price || f.max_price, f.on_sale, ...(f.store ?? [])].filter(Boolean).length;
  });

  submitSearch(): void {
    const q = this.draftQuery.trim();
    this.update({ q: q || null });
  }

  protected isError(r: Result): r is { error: true } {
    return 'error' in r;
  }

  update(changes: Record<string, unknown>, resetPage = true): void {
    const queryParams: Record<string, unknown> = { ...changes };
    if (resetPage) queryParams['page'] = null;
    this.router.navigate([], { queryParams, queryParamsHandling: 'merge' });
  }

  applyPrice(): void {
    this.update({ min_price: this.minPrice || null, max_price: this.maxPrice || null });
  }

  toggleStore(slug: string): void {
    const current = this.filters().store ?? [];
    const next = current.includes(slug) ? current.filter((s) => s !== slug) : [...current, slug];
    this.update({ store: next.length ? next : null });
  }

  clear(): void {
    const q = this.filters().q;
    this.router.navigate([], { queryParams: q ? { q } : {} });
  }

  reload(): void {
    this.router.navigate([], { queryParams: { _r: this.reloadTick() + 1 }, queryParamsHandling: 'merge' });
    this.reloadTick.update((n) => n + 1);
  }
}
