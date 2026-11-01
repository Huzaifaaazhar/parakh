import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, ParamMap, Router, RouterLink } from '@angular/router';
import { Observable, catchError, distinctUntilChanged, forkJoin, map, of, switchMap, tap } from 'rxjs';

import { ApiService } from '../core/api.service';
import { Facets, Page, Product, ProductFilters, SearchResponse, SortOption } from '../core/models';
import { LabelPipe, PkrPipe, dishLabel } from '../shared/format';
import { ProductCard } from '../shared/product-card';
import { Reveal } from '../shared/motion';
import { PageHero } from '../shared/page-hero';
import { Rail } from '../shared/rail';
import { EmptyState, SkeletonGrid } from '../shared/states';

type Result = (Page<Product> & Partial<Pick<SearchResponse, 'parsed_filters' | 'semantic'>>) | { error: true };

function filtersFrom(params: ParamMap): ProductFilters {
  const num = (k: string) => (params.get(k) ? Number(params.get(k)) : undefined);
  return {
    q: params.get('q') ?? undefined,
    vertical: params.get('vertical') ?? undefined,
    category: params.get('category') ?? undefined,
    protein: params.get('protein') ?? undefined,
    city: params.get('city') ?? undefined,
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
  imports: [FormsModule, DecimalPipe, PkrPipe, LabelPipe, ProductCard, SkeletonGrid, EmptyState, Reveal, PageHero, Rail, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let f = filters();
    <app-page-hero [variant]="heroVariant()" [eyebrow]="heroEyebrow()" [title]="heroTitle()" [subtitle]="heroSubtitle()" [images]="heroImages()">
      <form (ngSubmit)="submitSearch()" class="pk-search max-w-xl" role="search">
        <label for="browse-q" class="sr-only">Search dishes</label>
        <input id="browse-q" [(ngModel)]="draftQuery" name="q" placeholder="Tikka, zinger, mutton karahi, biryani…" autocomplete="off" />
        <button type="submit">Search</button>
      </form>
    </app-page-hero>

    @if (catTiles().length) {
      <section class="pt-5" aria-label="Dishes">
        <app-rail label="Dishes">
          @for (t of catTiles(); track t.key; let i = $index) {
            <a class="pk-thumb" [appReveal]="i" [routerLink]="[]" [queryParams]="{ category: f.category === t.key ? null : t.key, page: null }" queryParamsHandling="merge" [attr.aria-current]="f.category === t.key ? 'true' : null">
              <span class="pk-thumb__img" [class.ring-2]="f.category === t.key" [class.ring-amber]="f.category === t.key">
                @if (t.image) {
                  <img [src]="t.image" alt="" loading="lazy" />
                }
              </span>
              <span class="pk-thumb__label">{{ t.key | label }} <span class="font-mono text-[11px] text-charcoal-muted">{{ t.count }}</span></span>
            </a>
          }
        </app-rail>
      </section>
    }

    <div class="pk-toolbar mt-4">
      <div class="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
        <div class="pk-strip min-w-0 flex-1" role="group" aria-label="Quick filters">
          <button type="button" class="pk-chip lg:hidden" (click)="showFilters.set(true)" aria-haspopup="dialog">
            Filters
            @if (activeCount()) {
              <span class="pk-tray__count h-5 min-w-5 text-[11px]">{{ activeCount() }}</span>
            }
          </button>
          <button type="button" class="pk-chip" [attr.aria-pressed]="f.category === 'deal'" (click)="update({ category: f.category === 'deal' ? null : 'deal' })">Deals & combos</button>
          <button type="button" class="pk-chip" [attr.aria-pressed]="!!f.on_sale" (click)="update({ on_sale: f.on_sale ? null : true })">On offer</button>
          @for (g of proteins; track g) {
            <button type="button" class="pk-chip" [attr.aria-pressed]="f.protein === g" (click)="update({ protein: f.protein === g ? null : g })">{{ g | label }}</button>
          }
          @for (b of [500, 1000]; track b) {
            <button type="button" class="pk-chip" [attr.aria-pressed]="f.max_price === b && !f.min_price" (click)="update({ min_price: null, max_price: f.max_price === b ? null : b })">
              Under {{ b | pkr }}
            </button>
          }
          @for (c of facets()?.cities ?? []; track c.value) {
            <button type="button" class="pk-chip" [attr.aria-pressed]="f.city === c.value" (click)="update({ city: f.city === c.value ? null : c.value })">
              {{ c.value }}
            </button>
          }
        </div>
        <label class="hidden shrink-0 items-center gap-2 sm:flex">
          <span class="t-label text-charcoal-muted">Sort</span>
          <select class="pk-input w-auto" [ngModel]="f.sort" (ngModelChange)="update({ sort: $event })" name="sort">
            @for (s of sorts; track s.value) {
              <option [value]="s.value">{{ s.label }}</option>
            }
          </select>
        </label>
      </div>
    </div>

    <div class="mx-auto grid max-w-7xl gap-8 px-4 pb-16 pt-6 lg:grid-cols-[240px_1fr]">
      @if (showFilters()) {
        <div class="fixed inset-0 z-40 bg-charcoal/40 lg:hidden" (click)="showFilters.set(false)" aria-hidden="true"></div>
      }
      <aside
        class="space-y-6 lg:sticky lg:top-[132px] lg:block lg:self-start lg:bg-transparent lg:p-0"
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
          <span class="t-label mb-2 block text-sage">Dish</span>
          <select class="pk-input" [ngModel]="f.category ?? ''" (ngModelChange)="update({ category: $event || null })" name="category">
            <option value="">Any dish</option>
            @for (c of facets()?.categories ?? []; track c.value) {
              @if (c.value !== 'other') {
                <option [value]="c.value">{{ c.value | label }} ({{ c.count }})</option>
              }
            }
          </select>
        </label>

        <fieldset>
          <legend class="t-label mb-2 text-sage">Price</legend>
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
            <legend class="t-label mb-2 text-sage">Restaurants</legend>
            <div class="max-h-72 overflow-y-auto border-t border-line">
              @for (s of facets()!.stores; track s.value) {
                <label class="flex min-h-11 cursor-pointer items-center gap-3 border-b border-line px-1 hover:bg-sage-tint">
                  <input type="checkbox" class="h-[18px] w-[18px] accent-sage" [checked]="f.store?.includes(s.value)" (change)="toggleStore(s.value)" />
                  <span class="flex-1 text-[15px]">{{ storeName(s.value) }}</span>
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
        <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
          @if (result(); as r0) {
            @if (!isError(r0)) {
              <p class="t-small"><span class="font-mono font-semibold text-sage">{{ r0.total | number }}</span> dishes across restaurants</p>
            }
          }
          <label class="flex items-center gap-2 sm:hidden">
            <span class="t-label text-charcoal-muted">Sort</span>
            <select class="pk-input w-auto" [ngModel]="f.sort" (ngModelChange)="update({ sort: $event })" name="sortm">
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
          <app-empty-state title="We couldn't load dishes" message="The menu service isn't answering. Try again in a moment." actionLabel="Try again" (action)="reload()" />
        } @else if (r && r.items.length) {
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-6 xl:grid-cols-4">
            @for (p of r.items; track p.id; let i = $index) {
              <app-product-card [product]="p" [appReveal]="i" />
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
          <app-empty-state title="Nothing matched" message="Try another dish, raise your budget, or clear a filter." actionLabel="Clear filters" (action)="clear()" />
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
  protected readonly proteins = ['chicken', 'beef', 'mutton', 'veg'];
  protected readonly budgets = [500, 1000, 2000, 5000];
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
    if (pf['protein']) out.push(String(pf['protein']));
    if (pf['brand']) out.push(String(pf['brand']));
    if (pf['min_price'] && pf['max_price']) out.push(`Rs ${pf['min_price']}–${pf['max_price']}`);
    else if (pf['max_price']) out.push(`under Rs ${pf['max_price']}`);
    else if (pf['min_price']) out.push(`above Rs ${pf['min_price']}`);
    if (pf['on_sale']) out.push('on offer');
    return out;
  });

  protected readonly hasFilters = computed(() => {
    const f = this.filters();
    return !!(f.category || f.protein || f.city || f.store || f.min_price || f.max_price || f.on_sale);
  });

  protected readonly heroVariant = computed(() => {
    const f = this.filters();
    if (f.on_sale || f.category === 'deal') return 'amber' as const;
    if (f.category || f.protein) return 'ink' as const;
    return 'paper' as const;
  });
  protected readonly heroEyebrow = computed(() => {
    const f = this.filters();
    if (f.q) return 'Search results';
    if (f.on_sale) return 'On offer now';
    if (f.city) return `Dishes in ${f.city}`;
    return f.category ? 'Compare' : 'Dishes';
  });
  protected readonly heroTitle = computed(() => {
    const f = this.filters();
    if (f.q) return `“${f.q}”`;
    if (f.category) return f.protein ? `${dishLabel(f.protein)} ${dishLabel(f.category).toLowerCase()}` : dishLabel(f.category);
    if (f.protein) return dishLabel(f.protein) + ' dishes';
    return 'Every dish, every restaurant';
  });
  protected readonly heroSubtitle = computed(() => {
    const r = this.result();
    if (!r || this.isError(r)) return 'Menus from every restaurant we read, matched dish by dish.';
    const extra = this.understood().length ? ` · showing ${this.understood().join(' · ')}` : '';
    return `${r.total.toLocaleString('en-PK')} dishes across restaurants${extra}`;
  });
  protected readonly heroImages = computed(() => {
    const r = this.result();
    return r && !this.isError(r) ? r.items.map((p) => p.image_url).filter(Boolean).slice(0, 3) : [];
  });
  /** Photo tiles for the categories in view (one product image each). */
  protected readonly catTiles = signal<{ key: string; count: number; image: string | null }[]>([]);
  private catKey = '';

  protected readonly activeCount = computed(() => {
    const f = this.filters();
    return [f.category, f.protein, f.city, f.min_price || f.max_price, f.on_sale, ...(f.store ?? [])].filter(Boolean).length;
  });

  constructor() {
    effect(() => {
      const fac = this.facets();
      const cats = (fac?.categories ?? []).filter((c) => !['other', 'add-on', 'drink'].includes(c.value)).slice(0, 14);
      const key = cats.map((c) => c.value).join(',') + '|' + (this.filters().vertical ?? '');
      if (!cats.length || key === this.catKey) return;
      this.catKey = key;
      const vertical = this.filters().vertical;
      this.catTiles.set(cats.map((c) => ({ key: c.value, count: c.count, image: null })));
      forkJoin(
        cats.map((c) =>
          this.api.products({ category: c.value, vertical, page_size: 12 }).pipe(
            map((r) => r.items.find((p) => p.image_url)?.image_url ?? null),
            catchError(() => of(null)),
          ),
        ),
      ).subscribe((imgs) => this.catTiles.set(cats.map((c, i) => ({ key: c.value, count: c.count, image: imgs[i] }))));
    });
  }

  /** Restaurant names for the slug facets (falls back to a tidy slug). */
  private readonly names = toSignal(this.api.restaurants().pipe(catchError(() => of([]))), { initialValue: [] });
  storeName(slug: string): string {
    return this.names().find((r) => r.slug === slug)?.name ?? dishLabel(slug);
  }

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
