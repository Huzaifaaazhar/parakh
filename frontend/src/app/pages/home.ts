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
import { Banner, OffersResponse, Product, Restaurant, Review } from '../core/models';
import { HEADLINE_DISHES, LabelPipe, PkrPipe, TimeAgoPipe, dishLabel } from '../shared/format';
import { CountUp, Motion, Reveal } from '../shared/motion';
import { ProductCard } from '../shared/product-card';
import { Rail } from '../shared/rail';
import { ReviewCard } from '../shared/review-card';
import { SkeletonGrid } from '../shared/states';

interface Tile {
  key: string;
  label: string;
  image: string | null;
  count: number | null;
}

/** One slide of the top banner: our own hero, a restaurant's ad, a live offer, or the "advertise here" slot. */
interface Slide {
  kind: 'hero' | 'sponsored' | 'featured' | 'offer' | 'advertise';
  tone: 'ink' | 'amber' | 'paper';
  eyebrow: string;
  title: string;
  subtitle: string;
  cta: string;
  link: string[] | null;
  href: string | null;
  bannerId: number | null;
  images: string[];
}

/** "Same dish, every restaurant" ledger tabs. */
interface DishCheck {
  label: string;
  q: string;
  category: string;
  unit: boolean; // compare per-unit price (pizza per sq in) instead of plate price
  note: string;
}

interface LedgerRow {
  product: Product;
  value: number;
  share: number; // 0..1 of the most expensive row, for the bar
}

const SLIDE_MS = 7000;

@Component({
  selector: 'app-home',
  imports: [FormsModule, RouterLink, DecimalPipe, PkrPipe, LabelPipe, TimeAgoPipe, ProductCard, ReviewCard, SkeletonGrid, Reveal, CountUp, Rail],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- 1. Banner slider: our hero, restaurant ads (labelled), live offers, and the ad slot itself -->
    <section
      #slider
      class="pk-slider"
      [class.is-paused]="paused()"
      [style.--slide-ms]="slideMs + 'ms'"
      aria-roledescription="carousel"
      aria-label="Featured restaurants and offers"
      (pointerenter)="pause(true)"
      (pointerleave)="pause(false)"
      (focusin)="pause(true)"
      (focusout)="pause(false)"
      (pointerdown)="dragStart($event)"
      (pointerup)="dragEnd($event)"
    >
      @for (s of slides(); track $index; let i = $index) {
        <div
          class="pk-slide"
          [class.pk-inkhero]="s.tone === 'ink'"
          [class.pk-on-sage]="s.tone === 'ink'"
          [class.pk-slide--amber]="s.tone === 'amber'"
          [class.pk-slide--paper]="s.tone === 'paper'"
          [class.is-active]="slide() === i"
          role="group"
          aria-roledescription="slide"
          [attr.aria-label]="(i + 1) + ' of ' + slides().length"
          [attr.aria-hidden]="slide() !== i"
        >
          @if (s.tone === 'ink') {
            <div class="pk-ink pk-ink--fold" aria-hidden="true"></div>
            <div class="pk-ink pk-ink--seam" aria-hidden="true"></div>
            <div class="pk-ink pk-ink--glow" aria-hidden="true"></div>
          }
          <div class="relative z-[2] mx-auto grid h-full max-w-7xl items-center gap-6 px-4 pb-16 pt-8 sm:grid-cols-[1.15fr_1fr] sm:pt-0">
            <div class="pk-slide__copy">
              @if (s.kind === 'sponsored' || s.kind === 'featured') {
                <span class="pk-adtag" [class.pk-adtag--paid]="s.kind === 'sponsored'">{{ s.kind === 'sponsored' ? 'Sponsored' : 'Featured' }}</span>
              }
              @if (s.kind === 'hero') {
                <h1 class="t-display-xl">Same dish. <span class="pk-hero__mark">Every</span> restaurant.</h1>
              } @else {
                <p class="t-label" [class.text-amber-ink]="s.tone !== 'ink'">{{ s.eyebrow }}</p>
                <h2 class="t-display-xl mt-3">{{ s.title }}</h2>
              }
              <p class="mt-4 max-w-[38ch] text-[17px] leading-normal sm:text-lg">{{ s.subtitle }}</p>
              @if (s.kind === 'hero') {
                <form (ngSubmit)="search()" class="pk-search mt-6 max-w-xl" role="search">
                  <label for="hero-q" class="sr-only">Which dish are you craving?</label>
                  <input id="hero-q" [(ngModel)]="query" name="q" placeholder="Chicken tikka under 800" autocomplete="off" />
                  <button type="submit">Compare</button>
                </form>
                <div class="mt-3 flex flex-wrap gap-2">
                  @for (q of examples; track q) {
                    <a class="pk-chip pk-chip--solid" [routerLink]="['/dishes']" [queryParams]="{ q }">{{ q }}</a>
                  }
                </div>
              } @else {
                <div class="mt-6 flex flex-wrap items-center gap-3">
                  @if (s.link) {
                    <a class="pk-btn" [class.pk-btn--deal]="s.tone === 'ink'" [class.pk-btn--primary]="s.tone !== 'ink'" [routerLink]="s.link" (click)="clicked(s)">{{ s.cta }}</a>
                  } @else if (s.href) {
                    <a class="pk-btn pk-btn--primary" [href]="s.href" target="_blank" rel="noopener sponsored" (click)="clicked(s)">{{ s.cta }}</a>
                  }
                </div>
              }
            </div>
            <div class="pk-slide__visual relative hidden h-[420px] sm:block" [class.!block]="s.kind !== 'hero'" [class.!h-[230px]]="s.kind !== 'hero'" aria-hidden="true">
              @for (img of s.images.slice(0, 3); track $index; let j = $index) {
                <div class="pk-print-photo" [style]="printStyle(j)"><img [src]="img" alt="" /></div>
              }
              @if (s.kind === 'hero') {
                @for (p of heroPicks(); track p.id; let j = $index) {
                  <span class="pk-pricechip pk-pricechip--float" [style]="chipStyle(j)">{{ p.store_name }} · {{ p.price | pkr }}</span>
                }
              }
            </div>
          </div>
        </div>
      }

      <div class="absolute bottom-6 left-0 right-0 z-[3] mx-auto flex max-w-7xl items-center justify-between px-4">
        <div class="pk-dots" [class.pk-dots--light]="slides()[slide()]?.tone === 'ink'">
          @for (s of slides(); track $index; let i = $index) {
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

    <!-- 2. Dishes people compare -->
    <section class="pt-6" aria-label="Dishes">
      <app-rail label="Dishes">
        @for (t of tiles(); track t.key; let i = $index) {
          <a class="pk-thumb" [appReveal]="i" [routerLink]="['/dishes']" [queryParams]="{ category: t.key }">
            <span class="pk-thumb__img">
              @if (t.image) {
                <img [src]="t.image" alt="" loading="lazy" />
              }
            </span>
            <span class="pk-thumb__label">{{ t.label }}@if (t.count) { <span class="pk-thumb__count">{{ t.count }}</span> }</span>
          </a>
        }
      </app-rail>
    </section>

    <!-- 3. Same dish, every restaurant: the core comparison, live -->
    <section class="mt-12 sm:mt-16" aria-labelledby="ledger">
      <div class="mx-auto grid max-w-7xl gap-8 px-4 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <p class="t-label text-amber-ink">Today's price check</p>
          <h2 id="ledger" class="t-display-lg mt-2 max-w-[14ch]">One dish, every restaurant.</h2>
          <p class="mt-3 max-w-[44ch] text-[16px] text-charcoal">
            Prices straight from each restaurant's own menu, matched like for like: same dish, same protein, same portion.
          </p>
          <div class="pk-tabs mt-6" role="tablist" aria-label="Dish to compare">
            <span class="pk-tabs__pill" [style.width.px]="pill().w" [style.transform]="'translateX(' + pill().x + 'px)'" aria-hidden="true"></span>
            @for (c of checks; track c.label; let i = $index) {
              <button #tabBtn type="button" role="tab" [attr.aria-selected]="tab() === i" (click)="tab.set(i)">{{ c.label }}</button>
            }
          </div>
          <p class="t-small mt-4 text-charcoal-muted">{{ checks[tab()].note }}</p>
        </div>
        <div class="pk-print" appReveal>
          <div class="pk-receipt pk-receipt--ledger">
            <p class="pk-receipt__head">
              <span>{{ checks[tab()].label }}</span>
              <span>{{ checks[tab()].unit ? 'per 100 sq in' : 'menu price' }}</span>
            </p>
            @if (ledger() === null) {
              <div class="pk-skel h-64" aria-busy="true"></div>
            } @else if (!ledger()!.length) {
              <p class="py-8 text-center text-[15px]">No restaurant lists this dish yet.</p>
            } @else {
              <ol class="pk-ledgerlist">
                @for (row of ledger(); track row.product.id; let i = $index) {
                  <li [appReveal]="i" [class.is-cheapest]="i === 0">
                    <a [routerLink]="['/dishes', row.product.id]">
                      <span class="pk-ledgerlist__name">
                        <b>{{ row.product.store_name }}</b>
                        <span>{{ row.product.product_name }}</span>
                      </span>
                      <span class="pk-ledgerlist__bar" aria-hidden="true"><span [style.width.%]="row.share * 100"></span></span>
                      <span class="pk-ledgerlist__price" [class.pk-circled]="i === 0">{{ row.value | pkr }}</span>
                    </a>
                  </li>
                }
              </ol>
              @if (spread(); as sp) {
                <p class="pk-receipt__foot">Cheapest saves <b>{{ sp | pkr }}</b> over the priciest</p>
              }
            }
          </div>
        </div>
      </div>
    </section>

    <!-- 4. Restaurants -->
    <section class="mt-14 sm:mt-20" aria-labelledby="restaurants">
      <div class="mx-auto mb-5 flex max-w-7xl items-end justify-between gap-4 px-4">
        <div>
          <h2 id="restaurants" class="t-display-lg">Restaurants we read</h2>
          <p class="t-small mt-2">{{ restaurants().length }} menus, refreshed every few hours from their own ordering sites.</p>
        </div>
        <a routerLink="/restaurants" class="pk-btn pk-btn--quiet pk-btn--sm hidden sm:inline-flex">All restaurants</a>
      </div>
      <div class="mx-auto max-w-7xl">
        <app-rail label="Restaurants">
          @for (r of restaurants(); track r.id; let i = $index) {
            <a class="pk-photocard pk-photocard--rest" [appReveal]="i" [routerLink]="['/restaurants', r.slug]">
              @if (r.cover_image) {
                <img [src]="r.cover_image" alt="" loading="lazy" />
              }
              @if (r.offers.length) {
                <span class="pk-sticker pk-photocard__sticker">{{ r.offers[0].title }}</span>
              }
              <span class="pk-photocard__copy">
                <span class="pk-photocard__name block">{{ r.name }}</span>
                <span class="pk-photocard__meta block">{{ r.cuisines.join(' · ') | label }}</span>
                <span class="pk-photocard__count">
                  @if (r.rating) {
                    ★ {{ r.rating }} ·
                  }
                  {{ r.menu_items }} dishes · from {{ r.min_price | pkr }}
                </span>
              </span>
            </a>
          }
        </app-rail>
      </div>
    </section>

    <!-- 5. Offers running now + combo deals -->
    @if (offers(); as o) {
      <section class="pk-band-amber mt-14 py-12 sm:mt-20 sm:py-16" aria-labelledby="offers">
        <div class="mx-auto mb-5 flex max-w-7xl items-end justify-between gap-4 px-4">
          <div>
            <h2 id="offers" class="t-display-lg">Offers running now</h2>
            <p class="t-small mt-2 text-charcoal">Read from each restaurant's ordering site{{ lastChecked() ? ' ' + (lastChecked() | timeAgo) : '' }}.</p>
          </div>
          <a routerLink="/deals" class="pk-link shrink-0">All deals</a>
        </div>
        @if (o.restaurant_offers.length) {
          <div class="mx-auto max-w-7xl">
            <app-rail label="Restaurant offers">
              @for (ro of o.restaurant_offers; track ro.restaurant.id + ro.offer.id; let i = $index) {
                <a class="pk-storecard" [appReveal]="i" [routerLink]="['/restaurants', ro.restaurant.slug]">
                  <span>
                    <span class="block font-sans text-[15px] font-bold text-sage">{{ ro.restaurant.name }}</span>
                    <span class="t-small block">{{ ro.offer.detail }}</span>
                  </span>
                  <span>
                    <span class="pk-storecard__pct block">{{ ro.offer.percent ? '−' + (ro.offer.percent | number: '1.0-0') + '%' : ro.offer.title }}</span>
                    @if (ro.offer.channels?.length) {
                      <span class="t-small block">{{ ro.offer.channels!.join(' & ') }}</span>
                    }
                  </span>
                </a>
              }
            </app-rail>
          </div>
        }
        <div class="mx-auto mt-8 max-w-7xl">
          <h3 class="t-heading mb-4 px-4">Combo deals, best value first</h3>
          <app-rail label="Combo deals">
            @for (p of o.deal_items.slice(0, 12); track p.id; let i = $index) {
              <div class="pk-railcard" [appReveal]="i"><app-product-card [product]="p" /></div>
            }
          </app-rail>
        </div>
      </section>
    } @else {
      <div class="mx-auto mt-14 max-w-7xl px-4"><app-skeleton-grid [count]="4" /></div>
    }

    <!-- 6. Real reviews: photos and videos from diners, then Google reviews -->
    <section class="mx-auto mt-14 max-w-7xl px-4 sm:mt-20" aria-labelledby="reviews">
      <div class="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 id="reviews" class="t-display-lg">What it actually looks like</h2>
          <p class="t-small mt-2 max-w-[52ch]">Photos and videos from people who ate there, next to the menu price. Google reviews are marked as such.</p>
        </div>
        <a routerLink="/restaurants" class="pk-btn pk-btn--primary pk-btn--sm">Post a review</a>
      </div>
      @if (mediaReviews().length) {
        <div class="pk-wall">
          @for (r of mediaReviews(); track r.id; let i = $index) {
            <a class="pk-wall__item" [appReveal]="i % 8" [routerLink]="['/restaurants', r.restaurant_slug]" [fragment]="'review-' + r.id">
              @if (r.media[0].type === 'video') {
                <video [src]="api.mediaUrl(r.media[0].url)" muted loop playsinline preload="metadata" [style.aspect-ratio]="wallRatio(i)" class="object-cover" (mouseenter)="play($event)" (mouseleave)="stop($event)"></video>
                <span class="pk-sticker">▶ Video</span>
              } @else {
                <img [src]="api.mediaUrl(r.media[0].url)" [alt]="'Photo of ' + (r.dish_name || r.restaurant_name)" loading="lazy" [style.aspect-ratio]="wallRatio(i)" class="object-cover" />
              }
              <span class="pk-wall__cap">
                <b>{{ '★'.repeat(round(r.rating)) }}</b>
                <span>{{ r.restaurant_name }}{{ r.dish_name ? ' · ' + r.dish_name : '' }}</span>
              </span>
            </a>
          }
        </div>
      } @else if (textReviews().length) {
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          @for (r of textReviews(); track r.id; let i = $index) {
            <app-review-card [review]="r" [showRestaurant]="true" [appReveal]="i" />
          }
        </div>
      } @else {
        <div class="pk-panel p-6 text-center">
          <p class="t-heading">No photo reviews yet</p>
          <p class="t-small mt-2">Be the first: open a restaurant, rate a dish and add a photo or a short video.</p>
        </div>
      }
    </section>

    <!-- 7. How the comparison works (graph paper, floating dish prints) -->
    <section #story class="pk-graph relative mt-14 overflow-hidden py-14 sm:mt-20 sm:py-20" aria-labelledby="how">
      <div class="relative z-[1] mx-auto grid max-w-7xl gap-10 px-4 lg:grid-cols-2">
        <div>
          <h2 id="how" class="t-display-lg max-w-[16ch]">Fair comparisons, plate for plate.</h2>
          <ol class="mt-8 space-y-5">
            @for (step of steps; track step.title; let i = $index) {
              <li class="flex gap-4" [appReveal]="i">
                <span class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-sage font-mono text-sm font-semibold text-on-sage">{{ i + 1 }}</span>
                <span>
                  <span class="t-heading block text-[19px]">{{ step.title }}</span>
                  <span class="t-small mt-1 block text-charcoal">{{ step.body }}</span>
                </span>
              </li>
            }
          </ol>
          @if (restaurants().length) {
            <div appReveal class="pk-print mt-8 max-w-md">
              <dl class="pk-receipt">
                <div><dt>Dishes on our menus</dt><span class="pk-leader"></span><dd [appCountUp]="dishCount()"></dd></div>
                <div><dt>Restaurants</dt><span class="pk-leader"></span><dd [appCountUp]="restaurants().length"></dd></div>
                <div><dt>Offers running</dt><span class="pk-leader"></span><dd class="is-sale" [appCountUp]="offers()?.restaurant_offers?.length ?? 0"></dd></div>
                <div><dt>Cities</dt><span class="pk-leader"></span><dd [appCountUp]="cityCount()"></dd></div>
              </dl>
            </div>
          }
        </div>
        <div class="relative hidden h-[460px] lg:block" aria-hidden="true">
          @for (img of floatPicks(); track $index; let i = $index) {
            <div class="pk-float" [style]="floatStyle(i)">
              <img [src]="img" alt="" loading="lazy" />
            </div>
          }
        </div>
      </div>
    </section>

    <!-- 8. For restaurants: the banner slot is for sale -->
    <section id="advertise" class="mx-auto mt-14 max-w-7xl px-4" aria-labelledby="for-restaurants">
      <div class="pk-panel pk-panel--sage grid gap-6 p-6 sm:grid-cols-[1.2fr_1fr] sm:p-10">
        <div>
          <p class="t-label text-amber-ink">For restaurants</p>
          <h2 id="for-restaurants" class="t-display-lg mt-2 max-w-[18ch]">Put your dish in the top banner.</h2>
          <p class="mt-3 max-w-[48ch] text-[16px] text-charcoal">
            The first slides on this page are paid placements for restaurants and cafés. They are always labelled
            <b>Sponsored</b>, sit beside honest price comparisons, and never change how dishes are ranked.
          </p>
        </div>
        <ul class="space-y-3 self-center text-[15px]">
          @for (point of adPoints; track point) {
            <li class="flex gap-3"><span class="pk-tick" aria-hidden="true"></span>{{ point }}</li>
          }
        </ul>
      </div>
    </section>
  `,
})
export class HomePage implements AfterViewInit, OnDestroy {
  protected api = inject(ApiService);
  private router = inject(Router);
  private motion = inject(Motion);
  private zone = inject(NgZone);
  protected query = '';
  protected readonly slideMs = SLIDE_MS;
  protected readonly round = Math.round;

  protected readonly examples = ['Chicken tikka under 800', 'Burger deals', 'Mutton karahi half'];
  protected readonly checks: DishCheck[] = [
    { label: 'Chicken tikka', q: 'chicken tikka', category: 'tikka', unit: false, note: 'One piece, leg or chest, as each menu lists it. Cheapest per restaurant.' },
    { label: 'Zinger', q: 'zinger', category: 'burger', unit: false, note: 'The classic zinger, single, without the meal.' },
    { label: 'Biryani', q: 'chicken biryani', category: 'biryani', unit: false, note: 'Chicken biryani, the smallest plate each restaurant sells.' },
    { label: 'Large pizza', q: 'large pizza', category: 'pizza', unit: false, note: 'Each restaurant\'s cheapest large pizza. Sizes vary a little; open a pizza to see price per square inch where the menu gives one.' },
  ];
  protected readonly steps = [
    { title: "We read each restaurant's own menu", body: 'Prices, sizes and running offers come from their ordering sites, refreshed every few hours.' },
    { title: 'We match the same dish', body: 'Chicken tikka with chicken tikka, half karahi with half karahi: never a tikka pizza or a full plate.' },
    { title: 'We compare per piece, per person, per inch', body: 'When portions differ, we show what each piece or slice really costs.' },
    { title: 'Real people show the real plate', body: 'Diners post photos and videos with their reviews; Google ratings sit alongside.' },
  ];
  protected readonly adPoints = [
    'Your banner on the first screen of the home page, on phones and desktop',
    'Links straight to your menu and running offers on Parakh',
    'Clicks are counted for you; rankings and prices are never for sale',
  ];

  protected readonly restaurants = signal<Restaurant[]>([]);
  protected readonly offers = signal<OffersResponse | null>(null);
  private readonly banners = signal<Banner[]>([]);
  protected readonly tiles = signal<Tile[]>([]);
  private readonly reviews = signal<Review[]>([]);
  private readonly mediaWall = signal<Review[]>([]);
  protected readonly mediaReviews = computed(() => this.mediaWall().filter((r) => r.media.length));
  protected readonly textReviews = computed(() => this.reviews().filter((r) => r.text).slice(0, 6));

  protected readonly tab = signal(0);
  private readonly ledgerCache = signal<Record<number, LedgerRow[]>>({});
  protected readonly ledger = computed(() => this.ledgerCache()[this.tab()] ?? null);
  protected readonly spread = computed(() => {
    const rows = this.ledger();
    if (!rows || rows.length < 2) return null;
    const vals = rows.map((r) => r.value);
    return Math.max(...vals) - Math.min(...vals);
  });
  protected readonly heroPicks = computed(() => (this.ledgerCache()[0] ?? []).slice(0, 2).map((r) => r.product));

  protected readonly dishCount = computed(() => this.restaurants().reduce((n, r) => n + r.menu_items, 0));
  protected readonly cityCount = computed(() => new Set(this.restaurants().flatMap((r) => r.cities)).size);
  protected readonly lastChecked = computed(() => {
    const t = this.restaurants().map((r) => r.last_scraped_at).filter((x): x is string => !!x);
    return t.length ? [...t].sort().at(-1)! : null;
  });
  private readonly dishImages = computed(() =>
    this.tiles()
      .map((t) => t.image)
      .filter((x): x is string => !!x),
  );
  protected readonly floatPicks = computed(() => this.dishImages().slice(3, 6));

  /** Slides: hero, then paid banners, then featured/offer slides, then the ad slot. */
  protected readonly slides = computed<Slide[]>(() => {
    const rests = new Map(this.restaurants().map((r) => [r.slug, r]));
    const imagesFor = (slug: string | null): string[] => {
      const r = slug ? rests.get(slug) : null;
      return r?.cover_image ? [r.cover_image] : [];
    };
    const out: Slide[] = [
      {
        kind: 'hero',
        tone: 'ink',
        eyebrow: '',
        title: '',
        subtitle: `${this.dishCount().toLocaleString('en-PK') || 'Thousands of'} dishes from ${this.restaurants().length || 'top'} Pakistani restaurants, compared portion for portion.`,
        cta: '',
        link: null,
        href: null,
        bannerId: null,
        images: this.dishImages().slice(0, 3),
      },
    ];
    for (const b of this.banners().slice(0, 3)) {
      out.push({
        kind: b.kind,
        tone: b.kind === 'sponsored' ? 'amber' : 'paper',
        eyebrow: b.eyebrow || b.restaurant_name || '',
        title: b.title,
        subtitle: b.subtitle || '',
        cta: b.cta_label,
        link: b.link_url ? null : b.restaurant_slug ? ['/restaurants', b.restaurant_slug] : null,
        href: b.link_url,
        bannerId: b.id,
        images: b.image_url ? [b.image_url] : imagesFor(b.restaurant_slug),
      });
    }
    if (!this.banners().length) {
      // No paid banners yet: show the biggest real offers, clearly as offers (not ads).
      for (const ro of (this.offers()?.restaurant_offers ?? []).slice(0, 2)) {
        out.push({
          kind: 'offer',
          tone: out.length % 2 ? 'amber' : 'paper',
          eyebrow: 'Offer running now',
          title: `${ro.offer.title} at ${ro.restaurant.name}`,
          subtitle: `${ro.offer.detail || 'On the menu'}. Read from ${ro.restaurant.name}'s own ordering site.`,
          cta: `See ${ro.restaurant.name}'s menu`,
          link: ['/restaurants', ro.restaurant.slug],
          href: null,
          bannerId: null,
          images: imagesFor(ro.restaurant.slug),
        });
      }
    }
    out.push({
      kind: 'advertise',
      tone: 'paper',
      eyebrow: 'Banner slot',
      title: 'Your restaurant could be here.',
      subtitle: 'Restaurants and cafés can feature a dish or a deal in this banner. Sponsored slides are always labelled.',
      cta: 'How banner ads work',
      link: ['/'],
      href: null,
      bannerId: null,
      images: this.dishImages().slice(6, 9),
    });
    return out;
  });

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
      .restaurants()
      .pipe(catchError(() => of([] as Restaurant[])))
      .subscribe((r) => this.restaurants.set(r));
    this.api
      .offers(undefined, 16)
      .pipe(catchError(() => of(null)))
      .subscribe((o) => this.offers.set(o));
    this.api
      .banners()
      .pipe(catchError(() => of([] as Banner[])))
      .subscribe((b) => this.banners.set(b));
    this.api
      .reviews({ with_media: true, limit: 12 })
      .pipe(catchError(() => of([] as Review[])))
      .subscribe((r) => this.mediaWall.set(r));
    this.api
      .reviews({ limit: 9 })
      .pipe(catchError(() => of([] as Review[])))
      .subscribe((r) => this.reviews.set(r));

    this.tiles.set(HEADLINE_DISHES.map((key) => ({ key, label: dishLabel(key), image: null, count: null })));
    forkJoin(
      HEADLINE_DISHES.map((key) =>
        this.api.products({ category: key, page_size: 24 }).pipe(
          map((r) => ({ image: r.items.find((p) => p.image_url)?.image_url ?? null, count: r.total })),
          catchError(() => of({ image: null, count: null })),
        ),
      ),
    ).subscribe((res) => this.tiles.set(HEADLINE_DISHES.map((key, i) => ({ key, label: dishLabel(key), ...res[i] }))));

    // Ledger tabs load lazily, once each.
    effect(() => {
      const i = this.tab();
      if (this.ledgerCache()[i]) return;
      const c = this.checks[i];
      this.api
        .search(c.q, { category: c.category, page_size: 100 })
        .pipe(catchError(() => of({ items: [] as Product[] })))
        .subscribe((r) => this.ledgerCache.update((cache) => ({ ...cache, [i]: this.cheapestPerRestaurant(r.items, c) })));
    });
    effect(() => {
      const btn = this.tabBtns()[this.tab()]?.nativeElement;
      if (btn) this.pill.set({ x: btn.offsetLeft - 4, w: btn.offsetWidth });
    });
    // Keep the active slide in range as banners/offers arrive.
    effect(() => {
      const n = this.slides().length;
      if (this.slide() >= n) this.slide.set(0);
    });
  }

  private cheapestPerRestaurant(items: Product[], c: DishCheck): LedgerRow[] {
    const best = new Map<string, { product: Product; value: number }>();
    for (const p of items) {
      if (!p.in_stock) continue;
      if (c.category === 'tikka' && p.protein && p.protein !== 'chicken') continue;
      if (c.category === 'biryani' && p.protein && p.protein !== 'chicken') continue;
      if (c.category === 'burger' && !/zinger/i.test(p.product_name)) continue;
      if (c.category === 'pizza' && !/large/i.test(`${p.product_name} ${p.portion ?? ''}`)) continue;
      if (/meal|deal|combo|platter|family|pack|\bx\s?\d/i.test(p.product_name)) continue; // single plates only
      const value = c.unit ? (p.unit_label === 'per 100 sq in' ? p.unit_price : null) : p.price;
      if (!value) continue;
      const key = p.store_slug || p.store_name || String(p.store_id);
      const prev = best.get(key);
      if (!prev || value < prev.value) best.set(key, { product: p, value });
    }
    const rows = [...best.values()].sort((a, b) => a.value - b.value).slice(0, 8);
    const max = Math.max(...rows.map((r) => r.value), 1);
    return rows.map((r) => ({ ...r, share: r.value / max }));
  }

  ngAfterViewInit(): void {
    queueMicrotask(() => {
      const btn = this.tabBtns()[this.tab()]?.nativeElement;
      if (btn) this.pill.set({ x: btn.offsetLeft - 4, w: btn.offsetWidth });
    });
    this.schedule();
    document.addEventListener('visibilitychange', this.onVisibility);
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
    const n = this.slides().length;
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

  clicked(s: Slide): void {
    if (s.kind === 'advertise') {
      document.getElementById('advertise')?.scrollIntoView({ behavior: this.motion.reduced() ? 'auto' : 'smooth' });
    }
    if (s.bannerId) this.api.bannerClick(s.bannerId).pipe(catchError(() => of(null))).subscribe();
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

  chipStyle(i: number): string {
    return ['left:2%;top:74%;z-index:4', 'left:58%;top:62%;z-index:4'][i] ?? '';
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

  play(e: Event): void {
    if (!this.motion.reduced()) (e.target as HTMLVideoElement).play().catch(() => undefined);
  }

  stop(e: Event): void {
    (e.target as HTMLVideoElement).pause();
  }

  search(): void {
    const q = this.query.trim();
    this.router.navigate(['/dishes'], { queryParams: q ? { q } : {} });
  }
}
