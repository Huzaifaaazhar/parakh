import { DecimalPipe } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  computed,
  effect,
  inject,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { catchError, forkJoin, map, of } from 'rxjs';

import { ApiService } from '../core/api.service';
import { Product, SalesOverview, SortOption, StoreSummary } from '../core/models';
import { PkrPipe, TimeAgoPipe } from '../shared/format';
import { CountUp, Motion, Odometer, Reveal } from '../shared/motion';
import { ProductCard } from '../shared/product-card';
import { Rail } from '../shared/rail';
import { SkeletonGrid } from '../shared/states';

interface Tile {
  key: string;
  label: string;
  image: string | null;
}
interface Dept {
  key: string;
  label: string;
  blurb: string;
  image: string | null;
  count: number | null;
}

const SLIDE_MS = 6500;

@Component({
  selector: 'app-home',
  imports: [FormsModule, RouterLink, DecimalPipe, PkrPipe, TimeAgoPipe, ProductCard, SkeletonGrid, Reveal, CountUp, Odometer, Rail],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- 1. Hero slider -->
    <section
      #slider
      class="pk-slider"
      [class.is-paused]="paused()"
      [style.--slide-ms]="slideMs + 'ms'"
      aria-roledescription="carousel"
      aria-label="Highlights"
      (pointerenter)="pause(true)"
      (pointerleave)="pause(false)"
      (focusin)="pause(true)"
      (focusout)="pause(false)"
      (pointerdown)="dragStart($event)"
      (pointerup)="dragEnd($event)"
    >
      <!-- Slide 1: brand + search on the ink field -->
      <div class="pk-slide pk-inkhero pk-on-blue" [class.is-active]="slide() === 0" role="group" aria-roledescription="slide" aria-label="1 of 3" [attr.aria-hidden]="slide() !== 0">
        <div class="pk-ink pk-ink--fold" aria-hidden="true"></div>
        <div class="pk-ink pk-ink--seam" aria-hidden="true"></div>
        <div class="pk-ink pk-ink--glow" aria-hidden="true"></div>
        <div class="relative z-[2] mx-auto grid h-full max-w-7xl items-center gap-6 px-4 pb-16 pt-8 sm:grid-cols-[1.15fr_1fr] sm:pt-0">
          <div class="pk-slide__copy">
            <h1 class="t-display-xl">Compare before you <span class="pk-hero__mark">buy.</span></h1>
            <p class="mt-4 max-w-[36ch] text-[17px] leading-normal sm:text-lg">{{ overview()?.total_products ?? 0 | number }} products from {{ storeCount() || 15 }} Pakistani stores, price-checked every few hours.</p>
            <form (ngSubmit)="search()" class="pk-search mt-6 max-w-xl" role="search">
              <label for="hero-q" class="sr-only">What are you looking for?</label>
              <input id="hero-q" [(ngModel)]="query" name="q" placeholder="Men's kurta under 4000" autocomplete="off" />
              <button type="submit">Search prices</button>
            </form>
            <div class="mt-3 flex flex-wrap gap-2">
              @for (q of examples; track q) {
                <a class="pk-chip pk-chip--solid" [routerLink]="['/products']" [queryParams]="{ q }">{{ q }}</a>
              }
            </div>
          </div>
          <div class="pk-slide__visual relative hidden h-[420px] sm:block" aria-hidden="true">
            @for (p of heroPicks(); track p.id; let i = $index) {
              <div class="pk-print-photo" [style]="printStyle(i)">
                <img [src]="p.image_url" alt="" />
                @if (p.discount_percentage > 0) {
                  <span class="pk-sticker">−{{ p.discount_percentage | number: '1.0-0' }}%</span>
                }
                <span class="pk-pricechip">{{ p.price | pkr }}</span>
              </div>
            }
          </div>
        </div>
      </div>

      <!-- Slide 2: the biggest sale right now (bubblegum gradient) -->
      @if (topStore(); as st) {
        <div class="pk-slide pk-slide--pink" [class.is-active]="slide() === 1" role="group" aria-roledescription="slide" aria-label="2 of 3" [attr.aria-hidden]="slide() !== 1">
          <div class="mx-auto grid h-full max-w-7xl items-center gap-6 px-4 pb-16 pt-10 sm:grid-cols-[1.1fr_1fr] sm:pt-0">
            <div class="pk-slide__copy">
              <p class="t-label text-blue-ink">Biggest sale right now</p>
              <h2 class="t-display-xl mt-3">{{ st.name }} is up to {{ st.max_discount | number: '1.0-0' }}% off</h2>
              <p class="mt-4 max-w-[36ch] text-[17px] text-blue-ink">{{ st.on_sale | number }} of its {{ st.total_products | number }} items are discounted today.</p>
              <div class="mt-6"><a class="pk-btn pk-btn--primary" [routerLink]="['/sales']" [queryParams]="{ store: st.slug }">See the {{ st.name }} sale</a></div>
            </div>
            <div class="pk-slide__visual relative h-[260px] sm:h-[420px]" aria-hidden="true">
              @for (p of storePicks(); track p.id; let i = $index) {
                <div class="pk-print-photo" [style]="printStyle(i)">
                  <img [src]="p.image_url" alt="" />
                  <span class="pk-sticker">−{{ p.discount_percentage | number: '1.0-0' }}%</span>
                  <span class="pk-pricechip">{{ p.price | pkr }}</span>
                </div>
              }
            </div>
          </div>
        </div>
      }

      <!-- Slide 3: every sale in one place (charcoal white into blue) -->
      <div class="pk-slide pk-slide--paper" [class.is-active]="slide() === 2" role="group" aria-roledescription="slide" aria-label="3 of 3" [attr.aria-hidden]="slide() !== 2">
        <div class="mx-auto grid h-full max-w-7xl items-center gap-6 px-4 pb-16 pt-10 sm:grid-cols-[1.1fr_1fr] sm:pt-0">
          <div class="pk-slide__copy">
            <p class="t-label text-pink-ink">Updated {{ lastChecked() ? (lastChecked() | timeAgo) : 'today' }}</p>
            <h2 class="t-display-xl mt-3">Every sale, in one place.</h2>
            <p class="mt-4 max-w-[36ch] text-[17px]">{{ overview()?.total_on_sale ?? 0 | number }} items are on sale across {{ storeCount() || 15 }} stores, averaging {{ overview()?.average_discount ?? 0 | number: '1.0-0' }}% off.</p>
            <div class="mt-6"><a class="pk-btn pk-btn--primary" routerLink="/sales">Browse all sales</a></div>
          </div>
          <div class="pk-slide__visual grid h-[260px] grid-cols-2 gap-3 sm:h-[420px]" aria-hidden="true">
            @for (p of wallPicks().slice(0, 4); track p.id) {
              <div class="relative overflow-hidden rounded-[6px] border-[5px] border-paper-raised bg-paper-raised shadow-[0_18px_30px_-18px_rgba(11,26,71,.55)]">
                <img [src]="p.image_url" alt="" class="h-full w-full object-cover" />
                <span class="pk-pricechip">{{ p.price | pkr }}</span>
              </div>
            }
          </div>
        </div>
      </div>

      <div class="absolute bottom-6 left-0 right-0 z-[3] mx-auto flex max-w-7xl items-center justify-between px-4">
        <div class="pk-dots" [class.pk-dots--light]="slide() === 0">
          @for (i of [0, 1, 2]; track i) {
            <button type="button" class="pk-dot" [class.is-active]="slide() === i" [class.is-done]="i < slide()" (click)="go(i)" [attr.aria-label]="'Show slide ' + (i + 1)" [attr.aria-current]="slide() === i"></button>
          }
        </div>
        <div class="hidden gap-2 sm:flex">
          <button type="button" class="pk-rail__btn !static !grid !h-10 !w-10" (click)="go(slide() - 1)" aria-label="Previous slide">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <button type="button" class="pk-rail__btn !static !grid !h-10 !w-10" (click)="go(slide() + 1)" aria-label="Next slide">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>
      </div>
    </section>

    <!-- 2. Category thumbnails -->
    <section class="pt-6" aria-label="Popular categories">
      <app-rail label="Popular categories">
        @for (t of tiles(); track t.key; let i = $index) {
          <a class="pk-thumb" [appReveal]="i" [routerLink]="['/products']" [queryParams]="{ category: t.key }">
            <span class="pk-thumb__img">
              @if (t.image) {
                <img [src]="t.image" [alt]="''" loading="lazy" />
              }
            </span>
            <span class="pk-thumb__label">{{ t.label }}</span>
          </a>
        }
      </app-rail>
    </section>

    <!-- 3. Departments: photo cards -->
    <section class="mt-12 sm:mt-16" aria-labelledby="departments">
      <div class="mx-auto mb-5 flex max-w-7xl items-end justify-between gap-4 px-4">
        <div>
          <h2 id="departments" class="t-display-lg">Shop by department</h2>
          <p class="t-small mt-2">Same item, every store, one price check.</p>
        </div>
        <a routerLink="/products" class="pk-btn pk-btn--quiet pk-btn--sm hidden sm:inline-flex">Browse everything</a>
      </div>
      <div class="mx-auto max-w-7xl">
        <app-rail label="Departments">
          @for (d of depts(); track d.key; let i = $index) {
            <a class="pk-photocard" [appReveal]="i" [routerLink]="['/products']" [queryParams]="{ vertical: d.key }">
              @if (d.image) {
                <img [src]="d.image" alt="" loading="lazy" />
              }
              <span class="pk-photocard__copy">
                <span class="pk-photocard__name block">{{ d.label }}</span>
                <span class="pk-photocard__meta block">{{ d.blurb }}</span>
                @if (d.count) {
                  <span class="pk-photocard__count">{{ d.count | number }} items</span>
                }
              </span>
            </a>
          }
        </app-rail>
      </div>
    </section>

    <!-- 4. Tabbed deals rail -->
    <section class="mt-12 sm:mt-16" aria-labelledby="deals">
      <div class="mx-auto mb-5 flex max-w-7xl flex-wrap items-end justify-between gap-4 px-4">
        <h2 id="deals" class="t-display-lg">Deals worth a look</h2>
        <div class="pk-tabs" role="tablist" aria-label="Deal lists">
          <span class="pk-tabs__pill" [style.width.px]="pill().w" [style.transform]="'translateX(' + pill().x + 'px)'" aria-hidden="true"></span>
          @for (t of tabs; track t.key; let i = $index) {
            <button #tabBtn type="button" role="tab" [attr.aria-selected]="tab() === i" (click)="tab.set(i)">{{ t.label }}</button>
          }
        </div>
      </div>
      <div class="mx-auto max-w-7xl">
        @if (tabItems() === null) {
          <div class="px-4"><app-skeleton-grid [count]="4" /></div>
        } @else {
          <app-rail [label]="tabs[tab()].label">
            @for (p of tabItems(); track p.id; let i = $index) {
              <div class="pk-railcard" [appReveal]="i"><app-product-card [product]="p" /></div>
            }
          </app-rail>
        }
      </div>
      <div class="mx-auto mt-6 max-w-7xl px-4">
        <a class="pk-btn pk-btn--quiet" routerLink="/products" [queryParams]="{ sort: tabs[tab()].sort }">Shop all {{ tabs[tab()].label.toLowerCase() }}</a>
      </div>
    </section>

    <!-- 5. Who's on sale (pink gradient band) -->
    @if (overview(); as ov) {
      <section class="pk-band-pink mt-14 py-12 sm:mt-20 sm:py-16" aria-labelledby="on-sale">
        <div class="mx-auto mb-5 flex max-w-7xl items-end justify-between gap-4 px-4">
          <div>
            <h2 id="on-sale" class="t-display-lg">Who's on sale right now</h2>
            <p class="t-small mt-2 text-charcoal">{{ storesOnSale() }} of {{ ov.stores.length }} stores are running a sale.</p>
          </div>
          <a routerLink="/sales" class="pk-link shrink-0">All sales</a>
        </div>
        <div class="mx-auto max-w-7xl">
          <app-rail label="Stores on sale">
            @for (s of ov.stores; track s.id; let i = $index) {
              <a class="pk-storecard" [class.pk-storecard--quiet]="!s.on_sale" [appReveal]="i" [routerLink]="['/sales']" [queryParams]="{ store: s.slug }">
                <span>
                  <span class="block font-sans text-[15px] font-bold text-blue">{{ s.name }}</span>
                  <span class="t-small block">{{ s.on_sale ? (s.on_sale | number) + ' of ' + (s.total_products | number) + ' items' : 'Checked ' + (s.last_scraped_at | timeAgo) }}</span>
                </span>
                <span>
                  @if (s.on_sale) {
                    <span class="pk-storecard__pct block">−{{ s.max_discount | number: '1.0-0' }}%</span>
                    <span class="t-small block">max discount · avg {{ s.avg_discount | number: '1.0-0' }}%</span>
                  } @else {
                    <span class="pk-storecard__pct block">No sale</span>
                  }
                  <span class="pk-storetag__meter block"><span [style.width.%]="s.sale_share"></span></span>
                </span>
              </a>
            }
          </app-rail>
        </div>
      </section>
    }

    <!-- 6. How Parakh checks prices (graph paper, floating prints) -->
    <section #story class="pk-graph relative overflow-hidden py-14 sm:py-20" aria-labelledby="how">
      <div class="relative z-[1] mx-auto grid max-w-7xl gap-10 px-4 lg:grid-cols-2">
        <div>
          <h2 id="how" class="t-display-lg max-w-[16ch]">We check the price so you don't have to.</h2>
          <ol class="mt-8 space-y-5">
            @for (step of steps; track step.title; let i = $index) {
              <li class="flex gap-4" [appReveal]="i">
                <span class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-blue font-mono text-sm font-semibold text-on-blue">{{ i + 1 }}</span>
                <span>
                  <span class="t-heading block text-[19px]">{{ step.title }}</span>
                  <span class="t-small mt-1 block text-charcoal">{{ step.body }}</span>
                </span>
              </li>
            }
          </ol>
          @if (overview(); as ov) {
            <div appReveal class="pk-print mt-8 max-w-md">
              <dl class="pk-receipt">
                <div><dt>Products tracked</dt><span class="pk-leader"></span><dd [appCountUp]="ov.total_products"></dd></div>
                <div><dt>On sale now</dt><span class="pk-leader"></span><dd class="is-sale" [appCountUp]="ov.total_on_sale"></dd></div>
                <div><dt>Avg. discount</dt><span class="pk-leader"></span><dd [appCountUp]="ov.average_discount" suffix="%"></dd></div>
                <div><dt>Stores checked</dt><span class="pk-leader"></span><dd [appCountUp]="ov.stores.length"></dd></div>
              </dl>
            </div>
          }
        </div>
        <div class="relative hidden h-[460px] lg:block" aria-hidden="true">
          @for (p of floatPicks(); track p.id; let i = $index) {
            <div class="pk-float" [style]="floatStyle(i)">
              <img [src]="p.image_url" alt="" loading="lazy" />
            </div>
          }
        </div>
      </div>
    </section>

    <!-- 7. Fresh price drops -->
    @if (overview()?.recent_price_drops?.length) {
      <section class="mx-auto mt-14 max-w-7xl px-4" aria-labelledby="drops">
        <div class="mb-5 flex items-end justify-between gap-4">
          <h2 id="drops" class="t-display-lg">Fresh price drops</h2>
          <a routerLink="/sales" [queryParams]="{ tab: 'drops' }" class="pk-link shrink-0">All drops</a>
        </div>
        <ul class="pk-ledger max-w-3xl">
          @for (d of overview()!.recent_price_drops.slice(0, 6); track d.product.id; let i = $index) {
            <li [appReveal]="i">
              <a class="pk-drop" [routerLink]="['/products', d.product.id]">
                <span class="pk-drop__pct">−{{ d.drop_percentage | number: '1.0-0' }}%</span>
                <span class="min-w-0">
                  <span class="pk-drop__name">{{ d.product.product_name }}</span>
                  <span class="pk-drop__store">{{ d.product.store_name }} · {{ d.detected_at | timeAgo }}</span>
                </span>
                <span class="pk-drop__prices">
                  <app-odometer class="pk-price__now block" [value]="d.new_price" />
                  <span class="pk-price__was"><span class="sr-only">was </span>{{ d.old_price | pkr }}</span>
                </span>
              </a>
            </li>
          }
        </ul>
      </section>
    }

    <!-- 8. Deal wall (masonry) -->
    @if (wallPicks().length) {
      <section class="pk-band-blue mt-14 py-12 sm:mt-20 sm:py-16" aria-labelledby="wall">
        <div class="mx-auto max-w-7xl px-4">
          <div class="mb-6 flex items-end justify-between gap-4">
            <div>
              <h2 id="wall" class="t-display-lg">Marked down today</h2>
              <p class="t-small mt-2 text-charcoal">The deepest cuts we found this morning, from every store.</p>
            </div>
            <a routerLink="/sales" class="pk-link shrink-0">See all</a>
          </div>
          <div class="pk-wall">
            @for (p of wallPicks(); track p.id; let i = $index) {
              <a class="pk-wall__item" [appReveal]="i % 8" [routerLink]="['/products', p.id]" [style.view-transition-name]="'product-' + p.id">
                <img [src]="p.image_url" [alt]="p.product_name" loading="lazy" [style.aspect-ratio]="wallRatio(i)" class="object-cover" />
                <span class="pk-sticker">−{{ p.discount_percentage | number: '1.0-0' }}%</span>
                <span class="pk-wall__cap">
                  <b>{{ p.price | pkr }}</b>
                  <span>{{ p.store_name }} · {{ p.product_name }}</span>
                </span>
              </a>
            }
          </div>
        </div>
      </section>
    }
  `,
})
export class HomePage implements AfterViewInit, OnDestroy {
  private api = inject(ApiService);
  private router = inject(Router);
  private motion = inject(Motion);
  private zone = inject(NgZone);
  protected query = '';
  protected readonly slideMs = SLIDE_MS;

  protected readonly overview = signal<SalesOverview | null>(null);
  protected readonly tiles = signal<Tile[]>([]);
  protected readonly depts = signal<Dept[]>([]);
  protected readonly tab = signal(0);
  private readonly tabCache = signal<Record<number, Product[]>>({});
  protected readonly tabItems = computed(() => this.tabCache()[this.tab()] ?? null);

  protected readonly examples = ['Lawn suits on sale', 'Earbuds under 5000', 'Perfume for men'];
  protected readonly tabs: { key: string; label: string; sort: SortOption }[] = [
    { key: 'value', label: 'Best value', sort: 'value' },
    { key: 'discount', label: 'Biggest discounts', sort: 'discount' },
    { key: 'newest', label: 'Just added', sort: 'newest' },
  ];
  protected readonly steps = [
    { title: 'We read every store, every few hours', body: 'Prices, discounts and stock from each store, straight from their own catalogues.' },
    { title: 'We match the same item across stores', body: 'So you see who sells it cheapest, not just who shouts loudest.' },
    { title: 'We check if a sale is real', body: 'Price history shows whether a "50% off" is actually lower than last week.' },
  ];

  protected readonly storeCount = computed(() => this.overview()?.stores.length ?? 0);
  protected readonly storesOnSale = computed(() => this.overview()?.stores.filter((s) => s.on_sale > 0).length ?? 0);
  protected readonly lastChecked = computed(() => {
    const t = (this.overview()?.stores ?? []).map((s) => s.last_scraped_at).filter((x): x is string => !!x);
    return t.length ? [...t].sort().at(-1)! : null;
  });
  private readonly withImages = computed(() => (this.overview()?.top_deals ?? []).filter((p) => p.image_url));
  protected readonly heroPicks = computed(() => this.withImages().slice(0, 3));
  protected readonly topStore = computed<StoreSummary | null>(() => {
    const s = [...(this.overview()?.stores ?? [])].filter((x) => x.on_sale > 0).sort((a, b) => b.max_discount - a.max_discount);
    return s[0] ?? null;
  });
  private readonly storeDeals = signal<Product[]>([]);
  protected readonly storePicks = computed(() => (this.storeDeals().length ? this.storeDeals() : this.withImages()).slice(0, 3));
  private readonly wall = signal<Product[]>([]);
  protected readonly wallPicks = computed(() => this.wall());
  protected readonly floatPicks = computed(() => this.wall().slice(4, 7));

  // ---- slider state ----
  protected readonly slide = signal(0);
  protected readonly paused = signal(false);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dragX: number | null = null;
  private slider = viewChild.required<ElementRef<HTMLElement>>('slider');
  private story = viewChild<ElementRef<HTMLElement>>('story');
  private tabBtns = viewChildren<ElementRef<HTMLButtonElement>>('tabBtn');
  protected readonly pill = signal({ x: 0, w: 0 });
  private stopScroll?: () => void;
  private onVisibility = () => this.pause(document.hidden);

  constructor() {
    this.api
      .sales()
      .pipe(catchError(() => of(null)))
      .subscribe((ov) => this.overview.set(ov));
    this.api
      .deals({ page_size: 16, sort: 'discount' as never })
      .pipe(catchError(() => of({ items: [] as Product[] })))
      .subscribe((d) => this.wall.set(d.items.filter((p) => p.image_url).slice(0, 12)));

    const categories = [
      { key: 'kurta', label: 'Kurtas' },
      { key: 'suit', label: 'Lawn and suits' },
      { key: 'sneakers', label: 'Sneakers' },
      { key: 'earbuds', label: 'Earbuds' },
      { key: 'smartwatch', label: 'Smartwatches' },
      { key: 'fragrance', label: 'Fragrance' },
      { key: 'heels', label: 'Heels' },
      { key: 't-shirt', label: 'T-shirts' },
      { key: 'speaker', label: 'Speakers' },
      { key: 'bedding', label: 'Bedding' },
    ];
    this.tiles.set(categories.map((c) => ({ ...c, image: null })));
    forkJoin(
      categories.map((c) =>
        this.api.products({ category: c.key, sort: 'value', page_size: 1 }).pipe(
          map((r) => r.items[0]?.image_url ?? null),
          catchError(() => of(null)),
        ),
      ),
    ).subscribe((imgs) => this.tiles.set(categories.map((c, i) => ({ ...c, image: imgs[i] }))));

    const departments = [
      { key: 'fashion', label: 'Fashion', blurb: 'Kurtas, lawn, western, shoes' },
      { key: 'electronics', label: 'Electronics', blurb: 'Phones, audio, gadgets' },
      { key: 'beauty', label: 'Beauty', blurb: 'Fragrance, skin and hair' },
      { key: 'home', label: 'Home', blurb: 'Bedding, kitchen, décor' },
    ];
    this.depts.set(departments.map((d) => ({ ...d, image: null, count: null })));
    forkJoin(
      departments.map((d) =>
        this.api.products({ vertical: d.key, sort: 'discount', page_size: 1 }).pipe(
          map((r) => ({ image: r.items[0]?.image_url ?? null, count: r.total })),
          catchError(() => of({ image: null, count: null })),
        ),
      ),
    ).subscribe((res) => this.depts.set(departments.map((d, i) => ({ ...d, ...res[i] }))));

    // Tabs load lazily, once each.
    effect(() => {
      const i = this.tab();
      if (this.tabCache()[i]) return;
      this.api
        .products({ sort: this.tabs[i].sort, page_size: 12, on_sale: i !== 2 })
        .pipe(catchError(() => of({ items: [] as Product[] })))
        .subscribe((r) => this.tabCache.update((c) => ({ ...c, [i]: r.items })));
    });
    // Biggest-sale slide shows that store's own deals.
    effect(() => {
      const st = this.topStore();
      if (!st) return;
      this.api
        .deals({ store: [st.slug], page_size: 6 })
        .pipe(catchError(() => of({ items: [] as Product[] })))
        .subscribe((d) => this.storeDeals.set(d.items.filter((p) => p.image_url)));
    });
    // Keep the tab pill under the selected tab.
    effect(() => {
      const btn = this.tabBtns()[this.tab()]?.nativeElement;
      if (btn) this.pill.set({ x: btn.offsetLeft - 4, w: btn.offsetWidth });
    });
  }

  ngAfterViewInit(): void {
    queueMicrotask(() => {
      const btn = this.tabBtns()[this.tab()]?.nativeElement;
      if (btn) this.pill.set({ x: btn.offsetLeft - 4, w: btn.offsetWidth });
    });
    this.schedule();
    document.addEventListener('visibilitychange', this.onVisibility);
    // Floating prints drift at different depths as the story block scrolls past.
    if (!this.motion.reduced()) {
      this.stopScroll = this.motion.onScroll(() => {
        const el = this.story()?.nativeElement;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const p = (window.innerHeight - r.top) / (window.innerHeight + r.height);
        el.style.setProperty('--story', Math.min(1, Math.max(0, p)).toFixed(3));
      });
    }
  }

  ngOnDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.stopScroll?.();
  }

  // ---- slider ----
  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.paused() || this.motion.reduced()) return;
    this.zone.runOutsideAngular(() => {
      this.timer = setTimeout(() => this.zone.run(() => this.go(this.slide() + 1)), SLIDE_MS);
    });
  }

  go(i: number): void {
    const n = 3;
    this.slide.set(((i % n) + n) % n);
    this.schedule();
  }

  pause(on: boolean): void {
    this.paused.set(on);
    if (on && this.timer) clearTimeout(this.timer);
    if (!on) this.schedule();
  }

  dragStart(e: PointerEvent): void {
    this.dragX = e.clientX;
  }

  dragEnd(e: PointerEvent): void {
    if (this.dragX === null) return;
    const dx = e.clientX - this.dragX;
    this.dragX = null;
    if (Math.abs(dx) > 50) this.go(this.slide() + (dx < 0 ? 1 : -1));
  }

  // ---- layout helpers ----
  printStyle(i: number): string {
    const spots = [
      'left:4%;top:8%;width:46%;height:72%;transform:rotate(-5deg)',
      'left:40%;top:0;width:44%;height:66%;transform:rotate(4deg);z-index:2',
      'left:22%;top:38%;width:40%;height:58%;transform:rotate(-1deg);z-index:3',
    ];
    return spots[i] ?? '';
  }

  floatStyle(i: number): string {
    const spots = [
      { pos: 'left:8%;top:6%;width:42%;height:52%', rot: -6, depth: -60 },
      { pos: 'left:52%;top:16%;width:38%;height:46%', rot: 5, depth: -120 },
      { pos: 'left:26%;top:52%;width:40%;height:44%', rot: -2, depth: -30 },
    ];
    const s = spots[i];
    if (!s) return '';
    return `${s.pos};transform:translate3d(0,calc(var(--story,0.5) * ${s.depth}px),0) rotate(${s.rot}deg)`;
  }

  wallRatio(i: number): string {
    return ['4 / 5', '1 / 1', '3 / 4', '4 / 5', '1 / 1.25', '1 / 1'][i % 6];
  }

  search(): void {
    const q = this.query.trim();
    this.router.navigate(['/products'], { queryParams: q ? { q } : {} });
  }
}
