import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';

import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { AppNotification, WishlistItem } from '../core/models';
import { PkrPipe, TimeAgoPipe } from '../shared/format';
import { ProductImage } from '../shared/product-image';
import { EmptyState } from '../shared/states';

@Component({
  selector: 'app-account',
  imports: [FormsModule, RouterLink, PkrPipe, TimeAgoPipe, ProductImage, EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto max-w-5xl px-4 py-8">
      @if (!auth.isLoggedIn()) {
        <div class="mx-auto max-w-md">
          <h1 class="text-3xl font-semibold">{{ mode() === 'login' ? 'Welcome back' : 'Create your account' }}</h1>
          <p class="mt-1 text-sm text-muted">Save products and get notified when their prices drop.</p>
          <form (ngSubmit)="submit()" class="card mt-6 space-y-4 p-6">
            @if (mode() === 'register') {
              <label class="block text-sm">
                <span class="mb-1 block font-medium">Name</span>
                <input class="input" [(ngModel)]="name" name="name" autocomplete="name" />
              </label>
            }
            <label class="block text-sm">
              <span class="mb-1 block font-medium">Email</span>
              <input class="input" type="email" [(ngModel)]="email" name="email" required autocomplete="email" />
            </label>
            <label class="block text-sm">
              <span class="mb-1 block font-medium">Password</span>
              <input
                class="input"
                type="password"
                [(ngModel)]="password"
                name="password"
                required
                minlength="8"
                [attr.autocomplete]="mode() === 'login' ? 'current-password' : 'new-password'"
              />
              @if (mode() === 'register') {
                <span class="mt-1 block text-xs text-muted">At least 8 characters.</span>
              }
            </label>
            @if (error()) {
              <p class="text-sm text-sale" role="alert">{{ error() }}</p>
            }
            <button class="btn-primary w-full" [disabled]="busy()">{{ mode() === 'login' ? 'Sign in' : 'Create account' }}</button>
            <p class="text-center text-sm text-muted">
              {{ mode() === 'login' ? 'New here?' : 'Already have an account?' }}
              <button type="button" class="font-medium text-teal hover:underline" (click)="mode.set(mode() === 'login' ? 'register' : 'login'); error.set('')">
                {{ mode() === 'login' ? 'Create an account' : 'Sign in' }}
              </button>
            </p>
          </form>
        </div>
      } @else {
        <header class="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 class="text-3xl font-semibold">Hi{{ auth.user()?.name ? ', ' + auth.user()!.name : '' }}</h1>
            <p class="text-sm text-muted">{{ auth.user()?.email }}</p>
          </div>
          <button type="button" class="btn-ghost" (click)="auth.logout()">Sign out</button>
        </header>

        <div class="grid gap-8 lg:grid-cols-[1fr_320px]">
          <section aria-labelledby="saved">
            <h2 id="saved" class="section-title mb-4">Saved items</h2>
            @if (wishlist().length) {
              <ul class="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-card">
                @for (w of wishlist(); track w.id) {
                  <li class="flex items-center gap-4 p-3">
                    <a [routerLink]="['/products', w.product.id]" class="h-20 w-16 shrink-0 overflow-hidden rounded-lg bg-paper">
                      <app-product-image [src]="w.product.image_url" [vertical]="w.product.vertical" />
                    </a>
                    <div class="min-w-0 flex-1">
                      <p class="text-xs font-semibold uppercase tracking-wider text-muted">{{ w.product.store_name }}</p>
                      <a [routerLink]="['/products', w.product.id]" class="line-clamp-1 font-medium hover:underline">{{ w.product.product_name }}</a>
                      <p class="text-sm">
                        <b [class.text-sale]="w.product.discount_percentage > 0">{{ w.product.price | pkr }}</b>
                        @if (w.target_price) {
                          <span class="text-xs text-muted"> · alert below {{ w.target_price | pkr }}</span>
                        }
                      </p>
                    </div>
                    <button type="button" class="text-sm text-muted hover:text-sale" (click)="remove(w)">Remove</button>
                  </li>
                }
              </ul>
            } @else {
              <app-empty-state title="Nothing saved yet" message="Tap “Save & alert me” on any product to track its price." />
            }
          </section>

          <section aria-labelledby="alerts">
            <div class="mb-4 flex items-center justify-between">
              <h2 id="alerts" class="section-title">Price alerts</h2>
              @if (hasUnread()) {
                <button type="button" class="text-xs font-medium text-teal hover:underline" (click)="markRead()">Mark all read</button>
              }
            </div>
            @if (notifications().length) {
              <ul class="space-y-2">
                @for (n of notifications(); track n.id) {
                  <li class="card p-3 text-sm" [class.border-saffron]="!n.is_read">
                    @if (n.product_id) {
                      <a [routerLink]="['/products', n.product_id]" class="hover:underline">{{ n.message }}</a>
                    } @else {
                      {{ n.message }}
                    }
                    <p class="mt-1 text-xs text-muted">{{ n.created_at | timeAgo }}</p>
                  </li>
                }
              </ul>
            } @else {
              <p class="card p-4 text-sm text-muted">No alerts yet. We check prices every few hours and notify you here when a saved item gets cheaper.</p>
            }
          </section>
        </div>
      }
    </div>
  `,
})
export class AccountPage {
  readonly next = input<string | undefined>();
  protected readonly auth = inject(AuthService);
  private api = inject(ApiService);
  private router = inject(Router);

  protected readonly mode = signal<'login' | 'register'>('login');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly wishlist = signal<WishlistItem[]>([]);
  protected readonly notifications = signal<AppNotification[]>([]);
  protected email = '';
  protected password = '';
  protected name = '';

  protected hasUnread = () => this.notifications().some((n) => !n.is_read);

  constructor() {
    effect(() => {
      if (!this.auth.isLoggedIn()) return;
      this.api
        .wishlist()
        .pipe(catchError((e: HttpErrorResponse) => this.onAuthError(e)))
        .subscribe((w) => this.wishlist.set(w));
      this.api
        .notifications()
        .pipe(catchError((e: HttpErrorResponse) => this.onAuthError(e)))
        .subscribe((n) => this.notifications.set(n));
    });
  }

  submit(): void {
    this.error.set('');
    if (!this.email || this.password.length < 8) {
      this.error.set('Enter your email and a password of at least 8 characters.');
      return;
    }
    this.busy.set(true);
    const req = this.mode() === 'login' ? this.auth.login(this.email, this.password) : this.auth.register(this.email, this.password, this.name || undefined);
    req.subscribe({
      next: () => {
        this.busy.set(false);
        this.password = '';
        const next = this.next();
        if (next?.startsWith('/')) this.router.navigateByUrl(next);
      },
      error: (e: HttpErrorResponse) => {
        this.busy.set(false);
        this.error.set(
          e.status === 401
            ? 'Wrong email or password.'
            : e.status === 409
              ? 'That email is already registered — sign in instead.'
              : 'Something went wrong. Please try again.',
        );
      },
    });
  }

  remove(item: WishlistItem): void {
    this.api.removeFromWishlist(item.product.id).subscribe(() => this.wishlist.update((list) => list.filter((w) => w.id !== item.id)));
  }

  markRead(): void {
    this.api.markNotificationsRead().subscribe(() => this.notifications.update((list) => list.map((n) => ({ ...n, is_read: true }))));
  }

  private onAuthError(e: HttpErrorResponse) {
    if (e.status === 401) this.auth.logout();
    return of([]);
  }
}
