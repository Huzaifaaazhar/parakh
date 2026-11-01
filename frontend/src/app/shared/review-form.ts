import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { Product, Review } from '../core/models';

interface Picked {
  file: File;
  url: string;
  type: 'photo' | 'video';
}

const MAX_FILES = 6;
const MAX_MB = 40;

/** Write a review for a restaurant (optionally about one dish) with up to six photos/videos. */
@Component({
  selector: 'app-review-form',
  host: { class: 'block' },
  imports: [FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!auth.isLoggedIn()) {
      <div class="pk-panel p-5">
        <p class="t-heading">Ate here? Show people the plate.</p>
        <p class="t-small mt-2">Sign in to rate a dish and post photos or a short video. Reviews carry your name.</p>
        <a routerLink="/account" class="pk-btn pk-btn--primary pk-btn--sm mt-4">Sign in to review</a>
      </div>
    } @else if (done()) {
      <div class="pk-panel p-5" role="status">
        <p class="t-heading">Thanks — your review is up.</p>
        <button type="button" class="pk-link mt-2" (click)="reset()">Write another</button>
      </div>
    } @else {
      <form class="pk-panel space-y-4 p-5" (ngSubmit)="submit()" aria-label="Write a review">
        <fieldset>
          <legend class="t-label mb-2">Your rating</legend>
          <div class="pk-ratepick" role="radiogroup" aria-label="Rating">
            @for (s of stars; track s) {
              <button
                type="button"
                role="radio"
                [attr.aria-checked]="rating() === s"
                [attr.aria-label]="s + (s === 1 ? ' star' : ' stars')"
                [class.is-on]="s <= rating()"
                (click)="rating.set(s)"
              >★</button>
            }
          </div>
        </fieldset>
        @if (dishes().length) {
          <label class="block">
            <span class="t-label mb-1 block">Which dish? (optional)</span>
            <select class="pk-field" [ngModel]="dishId()" (ngModelChange)="dishId.set($event)" name="dish">
              <option [ngValue]="null">The whole meal</option>
              @for (d of dishes(); track d.id) {
                <option [ngValue]="d.id">{{ d.product_name }}</option>
              }
            </select>
          </label>
        }
        <label class="block">
          <span class="t-label mb-1 block">Branch (optional)</span>
          <input class="pk-field" [(ngModel)]="branch" name="branch" maxlength="200" placeholder="e.g. MM Alam Road, Lahore" />
        </label>
        <label class="block">
          <span class="t-label mb-1 block">Your review</span>
          <textarea class="pk-field min-h-28" [(ngModel)]="text" name="text" maxlength="4000" placeholder="Portion, taste, spice, how long it took…"></textarea>
        </label>
        <div>
          <span class="t-label mb-2 block">Photos or videos <span class="font-normal normal-case text-charcoal-muted">(up to {{ maxFiles }}, {{ maxMb }} MB each)</span></span>
          <div class="pk-uploads">
            @for (p of picked(); track p.url; let i = $index) {
              <span class="pk-uploads__item">
                @if (p.type === 'video') {
                  <video [src]="p.url" muted playsinline preload="metadata"></video>
                  <span class="pk-uploads__tag">Video</span>
                } @else {
                  <img [src]="p.url" alt="" />
                }
                <button type="button" (click)="remove(i)" [attr.aria-label]="'Remove ' + p.file.name">×</button>
              </span>
            }
            @if (picked().length < maxFiles) {
              <label class="pk-uploads__add">
                <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,video/mp4,video/webm,video/quicktime" multiple (change)="pick($event)" class="sr-only" />
                <span aria-hidden="true">＋</span>
                <span>Add</span>
              </label>
            }
          </div>
        </div>
        @if (error()) {
          <p class="text-[14px] text-amber-ink" role="alert">{{ error() }}</p>
        }
        <button type="submit" class="pk-btn pk-btn--primary w-full sm:w-auto" [disabled]="!canSubmit() || busy()">{{ busy() ? 'Posting…' : 'Post review' }}</button>
      </form>
    }
  `,
})
export class ReviewForm implements OnInit, OnDestroy {
  private api = inject(ApiService);
  protected readonly auth = inject(AuthService);
  readonly restaurantSlug = input.required<string>();
  readonly dishes = input<Product[]>([]);
  readonly presetDish = input<number | null>(null);
  readonly posted = output<Review>();

  protected readonly stars = [1, 2, 3, 4, 5];
  protected readonly maxFiles = MAX_FILES;
  protected readonly maxMb = MAX_MB;
  protected readonly rating = signal(0);
  protected readonly dishId = signal<number | null>(null);
  protected branch = '';
  protected text = '';
  protected readonly picked = signal<Picked[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly done = signal(false);
  protected readonly canSubmit = computed(() => this.rating() > 0);

  ngOnInit(): void {
    this.dishId.set(this.presetDish());
  }

  pick(e: Event): void {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    this.error.set(null);
    const next = [...this.picked()];
    for (const file of files) {
      if (next.length >= MAX_FILES) break;
      if (file.size > MAX_MB * 1024 * 1024) {
        this.error.set(`${file.name} is over ${MAX_MB} MB.`);
        continue;
      }
      const type = file.type.startsWith('video/') ? 'video' : file.type.startsWith('image/') ? 'photo' : null;
      if (!type) {
        this.error.set(`${file.name} isn't a photo or video.`);
        continue;
      }
      next.push({ file, type, url: URL.createObjectURL(file) });
    }
    this.picked.set(next);
  }

  remove(i: number): void {
    const p = this.picked()[i];
    URL.revokeObjectURL(p.url);
    this.picked.update((list) => list.filter((_, j) => j !== i));
  }

  submit(): void {
    if (!this.canSubmit() || this.busy()) return;
    if (!this.text.trim() && !this.picked().length) {
      this.error.set('Write a few words or add a photo or video.');
      return;
    }
    const form = new FormData();
    form.set('rating', String(this.rating()));
    if (this.text.trim()) form.set('text', this.text.trim());
    if (this.branch.trim()) form.set('visited_branch', this.branch.trim());
    if (this.dishId()) form.set('product_id', String(this.dishId()));
    for (const p of this.picked()) form.append('files', p.file, p.file.name);
    this.busy.set(true);
    this.error.set(null);
    this.api.postReview(this.restaurantSlug(), form).subscribe({
      next: (review) => {
        this.busy.set(false);
        this.done.set(true);
        this.posted.emit(review);
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        this.error.set(
          err.status === 401
            ? 'Please sign in again.'
            : err.status === 0 || err.status >= 500
              ? "We couldn't save your review right now. Please try again later."
              : (err.error?.detail ?? err.error?.message ?? 'Please check your review and try again.'),
        );
      },
    });
  }

  reset(): void {
    this.picked().forEach((p) => URL.revokeObjectURL(p.url));
    this.picked.set([]);
    this.rating.set(0);
    this.text = '';
    this.branch = '';
    this.done.set(false);
  }

  ngOnDestroy(): void {
    this.picked().forEach((p) => URL.revokeObjectURL(p.url));
  }
}
