import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, of, switchMap } from 'rxjs';

import { ApiService } from '../core/api.service';
import { RestaurantDetail, Review } from '../core/models';
import { LabelPipe, TimeAgoPipe } from "../shared/format";
import { Reveal } from '../shared/motion';
import { PageHero } from '../shared/page-hero';
import { ProductCard } from '../shared/product-card';
import { ReviewCard } from '../shared/review-card';
import { ReviewForm } from '../shared/review-form';
import { EmptyState } from '../shared/states';

const PREVIEW = 8;

@Component({
  selector: 'app-restaurant',
  imports: [RouterLink, DecimalPipe, LabelPipe, TimeAgoPipe, PageHero, ProductCard, ReviewCard, ReviewForm, Reveal, EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (error()) {
      <div class="mx-auto max-w-7xl px-4 py-16">
        <app-empty-state title="We couldn't find that restaurant" message="It may have been removed from Parakh." />
        <a routerLink="/restaurants" class="pk-btn pk-btn--primary mt-6">All restaurants</a>
      </div>
    } @else if (data(); as d) {
      @let r = d.restaurant;
      <app-page-hero variant="ink" [eyebrow]="(r.cuisines.join(' · ') | label) || 'Restaurant'" [title]="r.name" [subtitle]="subtitle()" [images]="heroImages()">
        <div class="flex flex-wrap items-center gap-3">
          @if (r.rating) {
            <a class="pk-gbadge pk-gbadge--lg" [href]="r.maps_url" target="_blank" rel="noopener" [attr.aria-label]="'Rated ' + r.rating + ' from ' + r.rating_count + ' Google reviews'">
              ★ {{ r.rating }}<small>{{ r.rating_count | number }} Google reviews</small>
            </a>
          }
          @if (r.parakh_rating) {
            <span class="pk-gbadge pk-gbadge--lg">★ {{ r.parakh_rating }}<small>{{ r.review_count }} on Parakh</small></span>
          }
          <a class="pk-btn pk-btn--deal" [href]="r.website" target="_blank" rel="noopener">Order on their site</a>
          <a class="pk-btn pk-btn--light" href="#reviews">Reviews</a>
        </div>
        @if (r.offers.length) {
          <div class="mt-4 flex flex-wrap gap-2">
            @for (o of r.offers; track o.id) {
              <span class="pk-offerchip"><b>{{ o.title }}</b> {{ o.detail }}</span>
            }
          </div>
        }
      </app-page-hero>

      <!-- Section jump bar -->
      <nav class="pk-toolbar" aria-label="Menu sections">
        <div class="mx-auto flex max-w-7xl gap-2 overflow-x-auto px-4 py-3">
          @for (s of d.sections; track s.name; let i = $index) {
            <a class="pk-chip shrink-0" [href]="'#sec-' + i" (click)="jump($event, i)">{{ s.name }} <span class="pk-chip__count">{{ s.items.length }}</span></a>
          }
        </div>
      </nav>

      <div class="mx-auto max-w-7xl px-4 pb-10 pt-8">
        <p class="t-small mb-6">Menu read {{ r.last_scraped_at ? (r.last_scraped_at | timeAgo) : 'recently' }} from {{ host(r.website) }}. Prices may differ by branch; confirm when you order.</p>
        @for (s of d.sections; track s.name; let i = $index) {
          <section class="mb-12 scroll-mt-32" [attr.id]="'sec-' + i" [attr.aria-labelledby]="'sech-' + i">
            <div class="mb-4 flex items-end justify-between gap-4">
              <h2 class="t-display-md" [attr.id]="'sech-' + i">{{ s.name }}</h2>
              <span class="t-small">{{ s.items.length }} {{ s.items.length === 1 ? 'item' : 'items' }}</span>
            </div>
            <div class="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
              @for (p of open().has(i) ? s.items : s.items.slice(0, preview); track p.id; let j = $index) {
                <div [appReveal]="j % 8"><app-product-card [product]="p" /></div>
              }
            </div>
            @if (s.items.length > preview && !open().has(i)) {
              <button type="button" class="pk-btn pk-btn--quiet pk-btn--sm mt-4" (click)="expand(i)">Show all {{ s.items.length }}</button>
            }
          </section>
        }
      </div>

      <!-- Reviews -->
      <section id="reviews" class="pk-band-sage py-12 sm:py-16" aria-labelledby="reviews-h">
        <div class="mx-auto grid max-w-7xl gap-8 px-4 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <h2 id="reviews-h" class="t-display-lg">Reviews</h2>
            @if (d.reviews.length) {
              <div class="pk-ratebars mt-5" aria-label="Rating breakdown">
                @for (k of ['5', '4', '3', '2', '1']; track k) {
                  <div>
                    <span>{{ k }}★</span>
                    <span class="pk-ratebars__bar"><span [style.width.%]="share(k)"></span></span>
                    <span>{{ d.rating_breakdown[k] || 0 }}</span>
                  </div>
                }
              </div>
            }
            <div class="mt-6">
              <app-review-form [restaurantSlug]="r.slug" [dishes]="allDishes()" (posted)="added($event)" />
            </div>
          </div>
          <div class="space-y-4">
            @if (reviews().length) {
              @if (withMedia().length) {
                <div class="pk-reviewstrip" aria-label="Photos and videos from diners">
                  @for (m of withMedia(); track m.url) {
                    @if (m.type === 'video') {
                      <video [src]="api.mediaUrl(m.url)" controls playsinline preload="metadata"></video>
                    } @else {
                      <img [src]="api.mediaUrl(m.url)" alt="Photo from a diner" loading="lazy" />
                    }
                  }
                </div>
              }
              @for (rv of reviews(); track rv.id; let i = $index) {
                <app-review-card [review]="rv" [appReveal]="i % 6" />
              }
            } @else {
              <div class="pk-panel p-6">
                <p class="t-heading">No reviews yet</p>
                <p class="t-small mt-2">Be the first to rate {{ r.name }} — add a photo or a short video of what you ordered.</p>
              </div>
            }
          </div>
        </div>
      </section>
    } @else {
      <div class="mx-auto max-w-7xl px-4 py-10"><div class="pk-skel h-[60vh]" aria-busy="true"></div></div>
    }
  `,
})
export class RestaurantPage {
  protected readonly api = inject(ApiService);
  private route = inject(ActivatedRoute);
  private title = inject(Title);
  protected readonly preview = PREVIEW;
  protected readonly data = signal<RestaurantDetail | null>(null);
  protected readonly error = signal(false);
  protected readonly open = signal<Set<number>>(new Set());
  private readonly extra = signal<Review[]>([]);

  protected readonly reviews = computed(() => [...this.extra(), ...(this.data()?.reviews ?? [])]);
  protected readonly withMedia = computed(() => this.reviews().flatMap((r) => r.media).slice(0, 10));
  protected readonly allDishes = computed(() => (this.data()?.sections ?? []).flatMap((s) => s.items));
  protected readonly heroImages = computed(() =>
    this.allDishes()
      .filter((p) => p.image_url && p.category !== 'drink' && p.category !== 'add-on')
      .map((p) => p.image_url)
      .slice(0, 3),
  );
  protected readonly subtitle = computed(() => {
    const r = this.data()?.restaurant;
    if (!r) return '';
    const parts = [`${r.menu_items} dishes from Rs ${Math.round(r.min_price ?? 0).toLocaleString('en-PK')}`];
    if (r.cities.length) parts.push(r.cities.join(', '));
    if (r.address) parts.push(r.address);
    return parts.join(' · ');
  });

  constructor() {
    this.route.paramMap
      .pipe(
        switchMap((p) => {
          this.data.set(null);
          this.error.set(false);
          this.open.set(new Set());
          this.extra.set([]);
          return this.api.restaurant(p.get('slug') ?? '').pipe(catchError(() => (this.error.set(true), of(null))));
        }),
      )
      .subscribe((d) => {
        this.data.set(d);
        if (d) this.title.setTitle(`${d.restaurant.name} menu & reviews · Parakh`);
      });
  }

  share(k: string): number {
    const b = this.data()?.rating_breakdown ?? {};
    const total = Object.values(b).reduce((a, n) => a + n, 0) || 1;
    return ((b[k] ?? 0) / total) * 100;
  }

  expand(i: number): void {
    this.open.update((s) => new Set(s).add(i));
  }

  jump(e: Event, i: number): void {
    e.preventDefault();
    document.getElementById('sec-' + i)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  added(r: Review): void {
    this.extra.update((list) => [r, ...list]);
  }

  host(url: string): string {
    try {
      return new URL(url).host.replace(/^www\./, '');
    } catch {
      return 'their site';
    }
  }
}
