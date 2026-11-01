import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';

import { ApiService } from '../core/api.service';
import { CompareTrayService } from '../core/compare-tray.service';
import { Product, SideBySideResponse } from '../core/models';
import { ProductImage } from '../shared/product-image';
import { Reveal } from '../shared/motion';
import { PageHero } from '../shared/page-hero';
import { ProductCard } from '../shared/product-card';
import { Rail } from '../shared/rail';
import { EmptyState } from '../shared/states';

@Component({
  selector: 'app-compare',
  imports: [RouterLink, ProductImage, EmptyState, PageHero, ProductCard, Rail, Reveal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-page-hero
      variant="paper"
      eyebrow="Side by side"
      title="Compare"
      [subtitle]="tray.count() >= 2 ? 'Comparing ' + tray.count() + ' dishes. The best figure in each row is marked.' : 'Up to four dishes from any restaurant. Compare the same dish for a fair fight.'"
      [images]="heroImages()"
    >
      @if (tray.count()) {
        <button type="button" class="pk-btn pk-btn--quiet pk-btn--sm" (click)="tray.clear()">Clear all</button>
      }
    </app-page-hero>

    <div class="mx-auto max-w-7xl px-4 pb-16 pt-8">
      @if (tray.count() < 2) {
        <div class="pk-panel p-5 sm:p-7">
          <h2 class="t-heading">{{ tray.count() === 1 ? 'Add one more to compare' : 'Pick two or more dishes' }}</h2>
          <p class="t-small mt-2 text-charcoal">Tick “Compare” on any dish below, or on any dish anywhere on Parakh.</p>
        </div>
        <section class="mt-8" aria-labelledby="suggest">
          <h2 id="suggest" class="t-display-lg mb-5">Good places to start</h2>
          <app-rail label="Suggested dishes">
            @for (p of suggestions(); track p.id; let i = $index) {
              <div class="pk-railcard" [appReveal]="i"><app-product-card [product]="p" /></div>
            }
          </app-rail>
        </section>
      } @else if (error()) {
        <app-empty-state title="We couldn't compare these" message="One of the dishes may be off the menu now." />
      } @else if (data(); as d) {
        <p class="mb-6 rounded-[8px] bg-gradient-to-r from-amber-soft to-paper-raised px-4 py-3 text-[15px] text-charcoal">{{ d.summary }}</p>
        <div class="pk-panel overflow-x-auto">
          <table class="pk-cmp w-full min-w-[640px] table-fixed border-collapse text-[15px]">
            <caption class="sr-only">Side-by-side dish comparison</caption>
            <thead class="sticky top-14 z-10 bg-paper-raised">
              <tr>
                <th scope="col" class="w-32 p-4 text-left align-bottom"><span class="t-label text-charcoal-muted">Product</span></th>
                @for (p of d.products; track p.id) {
                  <th scope="col" class="p-4 text-left align-top font-normal">
                    <div class="relative">
                      <a [routerLink]="['/dishes', p.id]" class="block aspect-square overflow-hidden rounded-[8px] bg-gradient-to-br from-paper-raised to-sage-tint" [style.view-transition-name]="'product-' + p.id">
                        <app-product-image [src]="p.image_url" [label]="p.store_name || p.brand_name" />
                      </a>
                      <button
                        type="button"
                        class="absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-full bg-paper-raised text-sage shadow"
                        (click)="tray.remove(p.id)"
                        [attr.aria-label]="'Remove ' + p.product_name"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="square" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                      </button>
                      <p class="pk-card__store mt-3">{{ p.store_name }}</p>
                      <a [routerLink]="['/dishes', p.id]" class="t-title mt-1 line-clamp-2 hover:underline">{{ p.product_name }}</a>
                    </div>
                  </th>
                }
              </tr>
            </thead>
            <tbody>
              @for (row of d.rows; track row.attribute) {
                <tr>
                  <th scope="row" class="p-4 text-left align-top"><span class="t-label text-charcoal-muted">{{ row.attribute }}</span></th>
                  @for (v of row.values; track $index) {
                    <td class="p-4 align-top" [class.font-mono]="isNumeric(row.attribute)" [class.capitalize]="!isNumeric(row.attribute)">
                      @if (row.best_index === $index) {
                        <span class="is-best">{{ v }}</span>
                        <span class="sr-only">(best)</span>
                      } @else {
                        <span [class.text-sage]="isNumeric(row.attribute)">{{ v ?? '—' }}</span>
                      }
                    </td>
                  }
                </tr>
              }
              <tr>
                <th scope="row" class="p-4"></th>
                @for (p of d.products; track p.id) {
                  <td class="p-4"><a [href]="p.product_url" target="_blank" rel="noopener noreferrer" class="pk-btn pk-btn--primary pk-btn--sm w-full">Go to {{ p.store_name }}</a></td>
                }
              </tr>
            </tbody>
          </table>
        </div>
      } @else {
        <div class="pk-skel h-96" aria-busy="true"></div>
      }
    </div>
  `,
})
export class ComparePage {
  private api = inject(ApiService);
  protected readonly router = inject(Router);
  protected readonly tray = inject(CompareTrayService);
  protected readonly data = signal<SideBySideResponse | null>(null);
  protected readonly error = signal(false);
  protected readonly suggestions = signal<Product[]>([]);
  protected readonly heroImages = computed(() => this.tray.items().map((p) => p.image_url).filter(Boolean).slice(0, 3));

  constructor() {
    this.api
      .products({ category: 'tikka', page_size: 12 })
      .pipe(catchError(() => of({ items: [] as Product[] })))
      .subscribe((r) => this.suggestions.set(r.items));
    effect(() => {
      const ids = this.tray.items().map((p) => p.id);
      this.error.set(false);
      if (ids.length < 2) return;
      this.api
        .sideBySide(ids)
        .pipe(catchError(() => (this.error.set(true), of(null))))
        .subscribe((d) => this.data.set(d));
    });
  }

  isNumeric(attribute: string): boolean {
    return /price|discount|rating/i.test(attribute);
  }
}
