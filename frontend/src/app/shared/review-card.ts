import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ApiService } from '../core/api.service';
import { Review } from '../core/models';

/**
 * One review: who wrote it (and where it came from: a Parakh diner or Google), stars, the dish,
 * the words, and any photos or videos they posted. Google reviews keep the author's name and link.
 */
@Component({
  selector: 'app-review-card',
  host: { class: 'block' },
  imports: [DatePipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let r = review();
    <article class="pk-review" [attr.id]="'review-' + r.id">
      <header class="pk-review__head">
        @if (r.author_photo) {
          <img class="pk-review__avatar" [src]="r.author_photo" alt="" referrerpolicy="no-referrer" />
        } @else {
          <span class="pk-review__avatar" aria-hidden="true">{{ initial() }}</span>
        }
        <span class="min-w-0">
          <span class="pk-review__author">
            @if (r.author_url) {
              <a [href]="r.author_url" target="_blank" rel="noopener nofollow">{{ r.author_name }}</a>
            } @else {
              {{ r.author_name }}
            }
          </span>
          <span class="pk-review__meta">
            <span class="pk-review__src" [class.pk-review__src--google]="r.source === 'google'">{{ r.source === 'google' ? 'Google review' : 'Parakh diner' }}</span>
            @if (r.verified) {
              <span class="pk-review__src pk-review__src--verified">Verified visit</span>
            }
            {{ r.created_at | date: 'd MMM y' }}
          </span>
        </span>
        <span class="pk-review__stars" [attr.aria-label]="r.rating + ' out of 5'">
          @for (s of stars; track s) {
            <span [class.is-on]="s <= rounded()">★</span>
          }
        </span>
      </header>
      @if (showRestaurant() && r.restaurant_slug) {
        <a class="pk-review__dish" [routerLink]="['/restaurants', r.restaurant_slug]">{{ r.restaurant_name }}{{ r.dish_name ? ' · ' + r.dish_name : '' }}</a>
      } @else if (r.dish_name) {
        <p class="pk-review__dish">{{ r.dish_name }}{{ r.visited_branch ? ' · ' + r.visited_branch : '' }}</p>
      }
      @if (r.text) {
        <p class="pk-review__text" [class.is-clamped]="!expanded() && long()">{{ r.text }}</p>
        @if (long()) {
          <button type="button" class="pk-link mt-1 text-[14px]" (click)="expanded.set(!expanded())">{{ expanded() ? 'Less' : 'Read more' }}</button>
        }
      }
      @if (r.media.length) {
        <div class="pk-review__media">
          @for (m of r.media; track m.url) {
            @if (m.type === 'video') {
              <video [src]="api.mediaUrl(m.url)" controls playsinline preload="metadata" [attr.aria-label]="'Video from ' + r.author_name"></video>
            } @else {
              <a [href]="api.mediaUrl(m.url)" target="_blank" rel="noopener">
                <img [src]="api.mediaUrl(m.url)" [alt]="'Photo from ' + r.author_name" loading="lazy" />
              </a>
            }
          }
        </div>
      }
    </article>
  `,
})
export class ReviewCard {
  protected readonly api = inject(ApiService);
  readonly review = input.required<Review>();
  readonly showRestaurant = input(false);
  protected readonly stars = [1, 2, 3, 4, 5];
  protected readonly expanded = signal(false);
  protected readonly rounded = computed(() => Math.round(this.review().rating));
  protected readonly initial = computed(() => (this.review().author_name || '?').trim().charAt(0).toUpperCase());
  protected readonly long = computed(() => (this.review().text || '').length > 260);
}
