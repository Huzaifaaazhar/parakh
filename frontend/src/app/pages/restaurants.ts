import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';

import { ApiService } from '../core/api.service';
import { Restaurant } from '../core/models';
import { LabelPipe, PkrPipe } from '../shared/format';
import { Reveal, Tilt } from '../shared/motion';
import { PageHero } from '../shared/page-hero';
import { EmptyState } from '../shared/states';

@Component({
  selector: 'app-restaurants',
  imports: [RouterLink, DecimalPipe, PkrPipe, LabelPipe, PageHero, Reveal, Tilt, EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-hero
      variant="ink"
      eyebrow="Restaurants"
      title="Every menu, read for you."
      [subtitle]="all().length + ' restaurants, ' + (dishCount() | number) + ' dishes. Menus and offers come from each restaurant\\'s own ordering site.'"
      [images]="covers()"
    >
      <div class="flex flex-wrap gap-2" role="group" aria-label="Filter by city">
        <button type="button" class="pk-chip" [class.pk-chip--solid]="!city()" [attr.aria-pressed]="!city()" (click)="setCity(null)">All cities</button>
        @for (c of cities(); track c) {
          <button type="button" class="pk-chip" [class.pk-chip--solid]="city() === c" [attr.aria-pressed]="city() === c" (click)="setCity(c)">{{ c }}</button>
        }
      </div>
    </app-page-hero>

    <div class="mx-auto max-w-7xl px-4 pb-16 pt-6">
      <div class="pk-toolbar -mx-4 mb-6 px-4">
        <div class="flex gap-2 overflow-x-auto py-3" role="group" aria-label="Filter by cuisine">
          <button type="button" class="pk-chip shrink-0" [class.pk-chip--solid]="!cuisine()" [attr.aria-pressed]="!cuisine()" (click)="cuisine.set(null)">Everything</button>
          @for (c of cuisines(); track c) {
            <button type="button" class="pk-chip shrink-0" [class.pk-chip--solid]="cuisine() === c" [attr.aria-pressed]="cuisine() === c" (click)="cuisine.set(c)">{{ c | label }}</button>
          }
        </div>
      </div>

      @if (loading()) {
        <div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          @for (i of [1, 2, 3, 4, 5, 6]; track i) {
            <div class="pk-skel h-72"></div>
          }
        </div>
      } @else if (!shown().length) {
        <app-empty-state title="No restaurants here yet" message="Try another city or cuisine." />
      } @else {
        <div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          @for (r of shown(); track r.id; let i = $index) {
            <a class="pk-restcard" appTilt [appReveal]="i % 6" [routerLink]="['/restaurants', r.slug]">
              <span class="pk-restcard__media">
                @if (r.cover_image) {
                  <img [src]="r.cover_image" alt="" loading="lazy" />
                }
                @if (r.offers.length) {
                  <span class="pk-sticker">{{ r.offers[0].title }}</span>
                }
              </span>
              <span class="pk-restcard__body">
                <span class="flex items-start justify-between gap-3">
                  <span class="t-heading text-[20px]">{{ r.name }}</span>
                  @if (r.rating) {
                    <span class="pk-gbadge" [attr.aria-label]="'Rated ' + r.rating + ' on Google'">★ {{ r.rating }}<small>Google</small></span>
                  }
                </span>
                <span class="t-small block">{{ r.cuisines.join(' · ') | label }}{{ r.cities.length ? ' · ' + r.cities.join(', ') : '' }}</span>
                <span class="pk-restcard__dishes">
                  @for (d of r.dishes.slice(0, 4); track d) {
                    <span>{{ d }}</span>
                  }
                </span>
                <span class="pk-restcard__foot">
                  <span><b>{{ r.menu_items }}</b> dishes</span>
                  <span>from <b>{{ r.min_price | pkr }}</b></span>
                  @if (r.review_count) {
                    <span><b>{{ r.review_count }}</b> reviews</span>
                  }
                </span>
              </span>
            </a>
          }
        </div>
      }
    </div>
  `,
})
export class RestaurantsPage {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  protected readonly all = signal<Restaurant[]>([]);
  protected readonly loading = signal(true);
  protected readonly city = signal<string | null>(this.route.snapshot.queryParamMap.get('city'));
  protected readonly cuisine = signal<string | null>(null);

  protected readonly cities = computed(() => [...new Set(this.all().flatMap((r) => r.cities))].sort());
  protected readonly cuisines = computed(() => {
    const counts = new Map<string, number>();
    this.all().forEach((r) => r.cuisines.forEach((c) => counts.set(c, (counts.get(c) ?? 0) + 1)));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  });
  protected readonly shown = computed(() =>
    this.all().filter(
      (r) => (!this.city() || r.cities.includes(this.city()!)) && (!this.cuisine() || r.cuisines.includes(this.cuisine()!)),
    ),
  );
  protected readonly dishCount = computed(() => this.all().reduce((n, r) => n + r.menu_items, 0));
  protected readonly covers = computed(() => this.all().map((r) => r.cover_image).filter((x): x is string => !!x).slice(0, 3));

  constructor() {
    this.api
      .restaurants()
      .pipe(catchError(() => of([] as Restaurant[])))
      .subscribe((r) => {
        this.all.set(r);
        this.loading.set(false);
      });
  }

  setCity(c: string | null): void {
    this.city.set(c);
    this.router.navigate([], { queryParams: { city: c }, queryParamsHandling: 'merge', replaceUrl: true });
  }
}
