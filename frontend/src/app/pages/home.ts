import { DecimalPipe } from '@angular/common';
import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';

import { ApiService } from '../core/api.service';
import { Facets, Product, SalesOverview } from '../core/models';
import { PkrPipe, TimeAgoPipe } from '../shared/format';
import { ProductCard } from '../shared/product-card';
import { CountUp, Motion, Odometer, Parallax, Reveal } from '../shared/motion';
import { EmptyState, SkeletonGrid } from '../shared/states';

@Component({
  selector: 'app-home',
  imports: [FormsModule, RouterLink, DecimalPipe, PkrPipe, TimeAgoPipe, ProductCard, SkeletonGrid, EmptyState, Reveal, CountUp, Parallax, Odometer],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      #hero
      class="pk-inkhero pk-on-blue -mt-14 min-h-[86svh] pt-14 sm:min-h-[80vh]"
      (pointermove)="point($event)"
      (pointerleave)="unpoint()"
    >
      <div class="pk-ink pk-ink--fold" aria-hidden="true"></div>
      <div class="pk-ink pk-ink--seam" aria-hidden="true"></div>
      <div class="pk-ink pk-ink--glow" aria-hidden="true"></div>
      <div class="relative z-[2] mx-auto max-w-7xl px-4 pb-24 pt-10 sm:pb-32 sm:pt-[88px]">
        <h1 class="t-display-xl max-w-4xl">Compare before you <span class="pk-hero__mark">buy.</span></h1>
        <p class="mt-5 max-w-[34ch] text-[17px] leading-normal sm:max-w-[44ch] sm:text-lg">
          Clothes, shoes, phones and perfumes from {{ storeCount() || 'Pakistani' }} Pakistani stores, matched and price-tracked.
        </p>
        <form (ngSubmit)="search()" class="pk-search mt-7 max-w-2xl" role="search">
          <label for="hero-q" class="sr-only">What are you looking for?</label>
          <input id="hero-q" [(ngModel)]="query" name="q" placeholder="Men's kurta under 4000" autocomplete="off" />
          <button type="submit">Search prices</button>
        </form>
        <div class="mt-3 flex flex-wrap items-center gap-2">
          @for (q of examples; track q) {
            <a class="pk-chip pk-chip--solid" [routerLink]="['/products']" [queryParams]="{ q }">{{ q }}</a>
          }
          <a routerLink="/assistant" class="pk-btn pk-btn--quiet pk-btn--sm sm:ml-2">Ask the assistant</a>
        </div>
      </div>
    </section>

    <div class="pk-sheet">
      <div class="mx-auto max-w-7xl px-4">
        @if (overview(); as ov) {
          <div appReveal class="pk-print relative -mt-2 max-w-md"><dl class="pk-receipt">
            <div><dt>Products tracked</dt><span class="pk-leader"></span><dd [appCountUp]="ov.total_products"></dd></div>
            <div><dt>On sale now</dt><span class="pk-leader"></span><dd class="is-sale" [appCountUp]="ov.total_on_sale"></dd></div>
            <div><dt>Avg. discount</dt><span class="pk-leader"></span><dd [appCountUp]="ov.average_discount" suffix="%"></dd></div>
            @if (lastChecked(); as lc) {
              <div><dt>Last checked</dt><span class="pk-leader"></span><dd>{{ lc | timeAgo }}</dd></div>
            }
          </dl></div>
        }
      </div>

      @if (overview(); as ov) {
        <section class="mt-10" aria-labelledby="stores-strip">
          <h2 id="stores-strip" class="sr-only">Stores we check</h2>
          <div #marquee class="pk-marquee" (pointerdown)="dragging = true" (pointerup)="dragging = false" (pointercancel)="dragging = false">
            @for (s of marqueeStores(); track $index) {
              <a class="pk-mtag" [class.pk-mtag--sale]="s.on_sale > 0" [routerLink]="['/sales']" [queryParams]="{ store: s.slug }" [attr.aria-hidden]="$index >= ov.stores.length ? 'true' : null" [attr.tabindex]="$index >= ov.stores.length ? -1 : null">
                <span class="pk-mtag__name">{{ s.name }}</span>
                @if (s.on_sale) {
                  <span class="pk-mtag__deal">Up to {{ s.max_discount | number: '1.0-0' }}% off</span>
                } @else {
                  <span class="t-small">no sale</span>
                }
              </a>
            }
          </div>
        </section>
      }

      <div class="mx-auto max-w-7xl px-4">
        <section class="mt-10 sm:mt-16" aria-labelledby="departments" appParallax>
          <h2 id="departments" class="t-display-lg mb-6">Departments</h2>
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-6">
            @for (v of verticals; track v.key; let i = $index) {
              <a class="pk-dept" [appReveal]="i" [routerLink]="['/products']" [queryParams]="{ vertical: v.key }">
                <span class="pk-dept__name">{{ v.label }}</span>
                <span>
                  <span class="pk-dept__meta">{{ v.blurb }}</span>
                  @if (deptCount(v.key); as n) {
                    <span class="pk-dept__count"><span [appCountUp]="n"></span> items</span>
                  }
                </span>
              </a>
            }
          </div>
        </section>
      </div>

      <section class="pk-slip--raised mt-12 pb-12 pt-10 sm:mt-[72px] sm:pb-16 sm:pt-14" aria-labelledby="best-value" appParallax>
        <div class="mx-auto max-w-7xl px-4">
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
              @for (p of trending(); track p.id; let i = $index) {
                <app-product-card [product]="p" [appReveal]="i" />
              }
            </div>
          } @else {
            <app-empty-state title="No products yet" message="The catalogue fills up after the first background scrape." />
          }
        </div>
      </section>

      @if (overview()?.recent_price_drops?.length) {
        <section class="pb-4 pt-10 sm:pt-14" aria-labelledby="drops" appParallax>
          <div class="mx-auto max-w-7xl px-4">
            <div class="mb-6 flex items-end justify-between gap-4">
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
          </div>
        </section>
      }
      <div class="h-12 sm:h-[72px]"></div>
    </div>
    `,
})
export class HomePage implements AfterViewInit, OnDestroy {
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

  private motion = inject(Motion);
  private hero = viewChild.required<ElementRef<HTMLElement>>('hero');
  private marquee = viewChild<ElementRef<HTMLElement>>('marquee');
  protected dragging = false;
  private stopScroll?: () => void;
  private pointFrame = 0;
  /** The store list twice, so the marquee can wrap seamlessly. */
  protected readonly marqueeStores = computed(() => {
    const stores = this.overview()?.stores ?? [];
    return [...stores, ...stores];
  });

  ngAfterViewInit(): void {
    const hero = this.hero().nativeElement;
    const reduced = this.motion.reduced();
    this.stopScroll = this.motion.onScroll((y, dy) => {
      const h = hero.offsetHeight || 1;
      const p = Math.min(1, Math.max(0, y / (h * 0.85)));
      if (!reduced) hero.style.setProperty('--hp', p.toFixed(3));
      // Header goes back to solid paper once the ink has started to dissolve.
      const over = p < 0.3;
      if (this.motion.overInk() !== over) this.motion.overInk.set(over);
      // The store tags drift with your scroll (and can be swiped); they never move on their own.
      const m = this.marquee()?.nativeElement;
      if (m && !reduced && !this.dragging && dy) {
        const half = m.scrollWidth / 2;
        let next = m.scrollLeft + dy * 0.6;
        if (next >= half) next -= half;
        if (next < 0) next += half;
        m.scrollLeft = next;
      }
    });
  }

  ngOnDestroy(): void {
    this.stopScroll?.();
    this.motion.overInk.set(false);
  }

  /** Ink follows the pointer or finger a little, like light moving across printed paper. */
  point(e: PointerEvent): void {
    if (this.motion.reduced()) return;
    cancelAnimationFrame(this.pointFrame);
    this.pointFrame = requestAnimationFrame(() => {
      const r = this.hero().nativeElement.getBoundingClientRect();
      this.hero().nativeElement.style.setProperty('--mx', (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3));
      this.hero().nativeElement.style.setProperty('--my', (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3));
    });
  }

  unpoint(): void {
    cancelAnimationFrame(this.pointFrame);
    this.hero().nativeElement.style.setProperty('--mx', '0');
    this.hero().nativeElement.style.setProperty('--my', '0');
  }

  deptCount(vertical: string): number | null {
    return this.facets()?.verticals.find((v) => v.value === vertical)?.count ?? null;
  }

  search(): void {
    const q = this.query.trim();
    this.router.navigate(['/products'], { queryParams: q ? { q } : {} });
  }
}
