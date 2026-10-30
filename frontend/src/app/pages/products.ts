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
    <div class="mx-auto max-w-7xl px-4 py-8">
      <header class="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 class="text-3xl font-semibold sm:text-4xl">
            @if (f.q) {
              Results for “{{ f.q }}”
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
              <p class="mt-1 text-sm text-muted">{{ r.total | number }} items across stores</p>
            }
          }
        </div>
        <div class="flex items-center gap-2">
          <button type="button" class="btn-ghost lg:hidden" (click)="showFilters.set(!showFilters())" [attr.aria-expanded]="showFilters()">Filters</button>
          <label class="flex items-center gap-2 text-sm">
            <span class="text-muted">Sort</span>
            <select class="input w-auto py-1.5" [ngModel]="f.sort" (ngModelChange)="update({ sort: $event })" name="sort">
              @for (s of sorts; track s.value) {
                <option [value]="s.value">{{ s.label }}</option>
              }
            </select>
          </label>
        </div>
      </header>

      @if (understood().length) {
        <div class="mb-5 flex flex-wrap items-center gap-2 text-sm">
          <span class="text-muted">We understood:</span>
          @for (u of understood(); track u) {
            <span class="rounded-full bg-blue-soft px-3 py-1 text-xs font-medium text-blue">{{ u }}</span>
          }
        </div>
      }

      <div class="grid gap-8 lg:grid-cols-[240px_1fr]">
        <aside class="space-y-6 text-sm lg:block" [class.hidden]="!showFilters()" aria-label="Filters">
          <fieldset>
            <legend class="mb-2 font-semibold">Department</legend>
            <div class="flex flex-wrap gap-2">
              <button type="button" [class]="!f.vertical ? 'chip-active' : 'chip'" (click)="update({ vertical: null, category: null })">All</button>
              @for (v of facets()?.verticals ?? []; track v.value) {
                <button type="button" [class]="f.vertical === v.value ? 'chip-active' : 'chip'" (click)="update({ vertical: v.value, category: null })">
                  {{ v.value | label }} <span class="opacity-60">{{ v.count }}</span>
                </button>
              }
            </div>
          </fieldset>

          <label class="block">
            <span class="mb-2 block font-semibold">Category</span>
            <select class="input" [ngModel]="f.category ?? ''" (ngModelChange)="update({ category: $event || null })" name="category">
              <option value="">Any category</option>
              @for (c of facets()?.categories ?? []; track c.value) {
                @if (c.value !== 'other') {
                  <option [value]="c.value">{{ c.value | label }} ({{ c.count }})</option>
                }
              }
            </select>
          </label>

          @if (!f.vertical || f.vertical === 'fashion' || f.vertical === 'beauty') {
            <fieldset>
              <legend class="mb-2 font-semibold">For</legend>
              <div class="flex flex-wrap gap-2">
                @for (g of genders; track g) {
                  <button type="button" [class]="f.gender === g ? 'chip-active' : 'chip'" (click)="update({ gender: f.gender === g ? null : g })">
                    {{ g | label }}
                  </button>
                }
              </div>
            </fieldset>
          }

          <fieldset>
            <legend class="mb-2 font-semibold">Price (PKR)</legend>
            <div class="flex items-center gap-2">
              <input class="input" type="number" min="0" placeholder="Min" [(ngModel)]="minPrice" name="min" aria-label="Minimum price" />
              <span class="text-muted">–</span>
              <input class="input" type="number" min="0" placeholder="Max" [(ngModel)]="maxPrice" name="max" aria-label="Maximum price" />
            </div>
            <div class="mt-2 flex flex-wrap gap-2">
              @for (b of budgets; track b) {
                <button type="button" class="chip" (click)="minPrice = null; maxPrice = b; applyPrice()">Under {{ b | pkr }}</button>
              }
            </div>
            <button type="button" class="btn-ghost mt-2 w-full" (click)="applyPrice()">Apply price</button>
          </fieldset>

          <label class="flex cursor-pointer items-center justify-between gap-2 rounded-xl border border-line bg-card px-3 py-2.5">
            <span class="font-semibold">On sale only</span>
            <input
              type="checkbox"
              class="h-4 w-4 accent-[var(--color-sale)]"
              [ngModel]="f.on_sale"
              (ngModelChange)="update({ on_sale: $event || null })"
              name="sale"
            />
          </label>

          @if (facets()?.stores?.length) {
            <fieldset>
              <legend class="mb-2 font-semibold">Stores</legend>
              <div class="max-h-64 space-y-1 overflow-y-auto pr-1">
                @for (s of facets()!.stores; track s.value) {
                  <label class="flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1 hover:bg-ink/5">
                    <input type="checkbox" class="h-4 w-4 accent-[var(--color-ink)]" [checked]="f.store?.includes(s.value)" (change)="toggleStore(s.value)" />
                    <span class="flex-1">{{ s.value | label }}</span>
                    <span class="text-xs text-muted">{{ s.count }}</span>
                  </label>
                }
              </div>
            </fieldset>
          }

          @if (hasFilters()) {
            <button type="button" class="w-full text-sm font-medium text-sale hover:underline" (click)="clear()">Clear all filters</button>
          }
        </aside>

        <section aria-live="polite">
          @let r = result();
          @if (loading()) {
            <app-skeleton-grid [count]="12" />
          } @else if (r && isError(r)) {
            <app-empty-state
              title="Couldn't load products"
              message="The API isn't responding. Check the backend is running and try again."
              actionLabel="Retry"
              (action)="reload()"
            />
          } @else if (r && r.items.length) {
            <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4">
              @for (p of r.items; track p.id) {
                <app-product-card [product]="p" />
              }
            </div>
            @if (totalPages() > 1) {
              <nav class="mt-8 flex items-center justify-center gap-3" aria-label="Pagination">
                <button type="button" class="btn-ghost" [disabled]="(f.page ?? 1) <= 1" (click)="update({ page: (f.page ?? 1) - 1 }, false)">← Previous</button>
                <span class="text-sm text-muted">Page {{ f.page }} of {{ totalPages() }}</span>
                <button type="button" class="btn-ghost" [disabled]="(f.page ?? 1) >= totalPages()" (click)="update({ page: (f.page ?? 1) + 1 }, false)">
                  Next →
                </button>
              </nav>
            }
          } @else {
            <app-empty-state
              title="Nothing matched"
              message="Try a broader search, raise your budget, or clear some filters."
              actionLabel="Clear filters"
              (action)="clear()"
            />
          }
        </section>
      </div>
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
