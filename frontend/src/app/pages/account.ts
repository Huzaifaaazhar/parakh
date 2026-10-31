import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';

import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { AppNotification, WishlistItem } from '../core/models';
import { PkrPipe, TimeAgoPipe } from '../shared/format';
import { Reveal } from '../shared/motion';
import { PageHero } from '../shared/page-hero';
import { ProductCard } from '../shared/product-card';

@Component({
  selector: 'app-account',
  imports: [FormsModule, RouterLink, PkrPipe, TimeAgoPipe, PageHero, ProductCard, Reveal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!auth.isLoggedIn()) {
      <div class="grid min-h-[calc(100dvh-3.5rem)] lg:grid-cols-2">
        <section class="pk-pagehero pk-pagehero--pink relative overflow-hidden px-4 py-10 sm:px-10 sm:py-16" aria-labelledby="why">
          <div class="pk-pagehero__copy relative z-[2] max-w-lg">
            <p class="t-label pk-pagehero__eyebrow">Your list</p>
            <h1 id="why" class="pk-pagehero__title">Save it. We'll watch the price.</h1>
            <ul class="mt-6 space-y-3 text-[16px] text-blue-ink">
              @for (b of benefits; track b) {
                <li class="flex gap-3"><span class="mt-1.5 h-2.5 w-2.5 shrink-0 rotate-[-6deg] rounded-[2px] bg-blue"></span>{{ b }}</li>
              }
            </ul>
          </div>
          <div class="relative mt-8 hidden h-[260px] lg:block" aria-hidden="true">
            @for (src of prints(); track $index; let i = $index) {
              <div class="pk-print-photo" [style]="spot(i)"><img [src]="src" alt="" /></div>
            }
          </div>
        </section>

        <div class="flex items-start justify-center bg-gradient-to-b from-paper to-blue-tint/40 px-4 py-10 sm:py-16">
          <form (ngSubmit)="submit()" class="pk-panel w-full max-w-md space-y-4 p-6 sm:p-8">
            <div class="pk-tabs w-full" role="tablist" aria-label="Sign in or create account">
              <span class="pk-tabs__pill" [style.width]="'calc(50% - 4px)'" [style.transform]="mode() === 'login' ? 'translateX(4px)' : 'translateX(calc(100% + 4px))'" aria-hidden="true"></span>
              <button type="button" role="tab" class="flex-1" [attr.aria-selected]="mode() === 'login'" (click)="mode.set('login'); error.set('')">Sign in</button>
              <button type="button" role="tab" class="flex-1" [attr.aria-selected]="mode() === 'register'" (click)="mode.set('register'); error.set('')">Create account</button>
            </div>
            <h2 class="t-heading pt-2">{{ mode() === 'login' ? 'Welcome back' : 'Create your account' }}</h2>
            @if (mode() === 'register') {
              <label class="block">
                <span class="t-label mb-1 block text-blue">Name</span>
                <input class="pk-input" [(ngModel)]="name" name="name" autocomplete="name" />
              </label>
            }
            <label class="block">
              <span class="t-label mb-1 block text-blue">Email</span>
              <input class="pk-input" type="email" [(ngModel)]="email" name="email" required autocomplete="email" />
            </label>
            <label class="block">
              <span class="t-label mb-1 block text-blue">Password</span>
              <input class="pk-input" type="password" [(ngModel)]="password" name="password" required minlength="8" [attr.autocomplete]="mode() === 'login' ? 'current-password' : 'new-password'" />
              @if (mode() === 'register') {
                <span class="t-small mt-1 block">At least 8 characters.</span>
              }
            </label>
            @if (error()) {
              <p class="text-[15px] font-semibold text-pink-ink" role="alert">{{ error() }}</p>
            }
            <button class="pk-btn pk-btn--primary w-full" [disabled]="busy()">{{ mode() === 'login' ? 'Sign in' : 'Create account' }}</button>
          </form>
        </div>
      </div>
    } @else {
      <app-page-hero variant="paper" eyebrow="My list" [title]="'Hi' + (auth.user()?.name ? ', ' + auth.user()!.name : '')" [subtitle]="auth.user()?.email ?? ''" [images]="savedImages()">
        <button type="button" class="pk-btn pk-btn--quiet pk-btn--sm" (click)="auth.logout()">Sign out</button>
      </app-page-hero>

      <div class="mx-auto grid max-w-7xl gap-10 px-4 pb-16 pt-8 lg:grid-cols-[1fr_340px]">
        <section aria-labelledby="saved">
          <h2 id="saved" class="t-display-lg mb-5">Saved items</h2>
          @if (wishlist().length) {
            <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-6">
              @for (w of wishlist(); track w.id; let i = $index) {
                <div [appReveal]="i">
                  <app-product-card [product]="w.product" />
                  @if (w.target_price) {
                    <p class="t-small mt-2 text-center">Alert below {{ w.target_price | pkr }}</p>
                  }
                </div>
              }
            </div>
          } @else {
            <div class="pk-panel p-6">
              <p class="t-heading">Nothing saved yet</p>
              <p class="t-small mt-2 text-charcoal">Tap the bookmark on any product to track its price. We'll tell you here when it drops.</p>
              <a routerLink="/products" [queryParams]="{ sort: 'value' }" class="pk-btn pk-btn--primary pk-btn--sm mt-4">Find something to save</a>
            </div>
          }
        </section>

        <section class="lg:sticky lg:top-20 lg:self-start" aria-labelledby="alerts">
          <div class="pk-panel pk-panel--blue p-5">
            <div class="mb-3 flex items-center justify-between">
              <h2 id="alerts" class="t-heading">Price alerts</h2>
              @if (hasUnread()) {
                <button type="button" class="pk-link text-xs" (click)="markRead()">Mark all read</button>
              }
            </div>
            @if (notifications().length) {
              <ul class="pk-ledger">
                @for (n of notifications(); track n.id) {
                  <li class="border-b border-line py-3 text-[15px]" [class.bg-bubblegum-soft]="!n.is_read" [class.px-2]="!n.is_read">
                    @if (n.product_id) {
                      <a [routerLink]="['/products', n.product_id]" class="hover:underline">{{ n.message }}</a>
                    } @else {
                      {{ n.message }}
                    }
                    <p class="t-receipt mt-1 text-charcoal-muted">{{ n.created_at | timeAgo }}</p>
                  </li>
                }
              </ul>
            } @else {
              <p class="t-small border-t-2 border-blue pt-3">No alerts yet. We check prices every few hours and tell you here when a saved item gets cheaper.</p>
            }
          </div>
        </section>
      </div>
    }
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

  protected readonly benefits = [
    'Save anything from any store in one list',
    'Get told when a saved price drops',
    'Set a target price and we watch for it',
  ];
  protected readonly prints = signal<string[]>([]);
  protected readonly savedImages = computed(() => this.wishlist().map((w) => w.product.image_url).filter(Boolean).slice(0, 3));

  spot(i: number): string {
    return ['left:4%;top:6%;width:34%;height:88%;transform:rotate(-5deg)', 'left:34%;top:0;width:32%;height:84%;transform:rotate(3deg);z-index:2', 'left:62%;top:10%;width:32%;height:86%;transform:rotate(-2deg);z-index:3'][i];
  }

  protected hasUnread = () => this.notifications().some((n) => !n.is_read);

  constructor() {
    this.api
      .trending(undefined, 6)
      .pipe(catchError(() => of({ items: [] })))
      .subscribe((r) => this.prints.set(r.items.map((p) => p.image_url).filter((x): x is string => !!x).slice(0, 3)));
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
