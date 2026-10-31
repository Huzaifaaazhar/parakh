import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';

import { AuthService } from './core/auth.service';
import { CompareTrayService } from './core/compare-tray.service';
import { PkrPipe } from './shared/format';
import { ProductImage } from './shared/product-image';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ProductImage, PkrPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a href="#main" class="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-paper-raised focus:px-3 focus:py-2">Skip to content</a>

    <header class="sticky top-0 z-30 border-b border-line bg-paper">
      <div class="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
        <a routerLink="/" class="pk-wordmark" aria-label="Parakh home">
          <span class="pk-wordmark__latin">Parakh</span>
          <span class="pk-wordmark__urdu" lang="ur" dir="rtl">پرکھ</span>
        </a>
        <nav class="ml-auto hidden items-center gap-6 sm:flex" aria-label="Main">
          @for (link of links; track link.path) {
            <a [routerLink]="link.path" routerLinkActive #rla="routerLinkActive" [routerLinkActiveOptions]="{ exact: link.path === '/' }" [attr.aria-current]="rla.isActive ? 'page' : null" class="pk-navlink">{{ link.label }}</a>
          }
          <a routerLink="/account" routerLinkActive #rlaAcc="routerLinkActive" [attr.aria-current]="rlaAcc.isActive ? 'page' : null" class="pk-navlink">
            {{ auth.isLoggedIn() ? 'My list' : 'Sign in' }}
          </a>
        </nav>
        <a routerLink="/products" class="ml-auto grid h-10 w-10 place-items-center text-blue sm:hidden" aria-label="Search products">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="square" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
        </a>
      </div>
    </header>

    <main id="main" class="min-h-[70vh] pb-20 sm:pb-0">
      <router-outlet />
    </main>

    @if (tray.count() > 0 && !onComparePage()) {
      <div class="fixed inset-x-0 bottom-[60px] z-40 sm:bottom-0" role="region" aria-label="Compare tray">
        <div class="pk-tray mx-auto max-w-3xl">
          <div class="pk-tray__thumbs">
            @for (p of tray.items(); track p.id) {
              <button type="button" class="pk-tray__thumb" (click)="tray.remove(p.id)" [attr.aria-label]="'Remove ' + p.product_name">
                <app-product-image [src]="p.image_url" [label]="p.store_name || p.brand_name" />
              </button>
            }
          </div>
          <p class="t-small min-w-0 flex-1 text-charcoal">
            <span class="pk-tray__count">{{ tray.count() }}</span>
            selected<span class="hidden sm:inline"> · from <b class="font-mono text-blue">{{ cheapest() | pkr }}</b></span>
          </p>
          <button type="button" class="pk-link hidden sm:block" (click)="tray.clear()">Clear</button>
          @if (tray.count() >= 2) {
            <a routerLink="/compare" class="pk-btn pk-btn--primary pk-btn--sm">Compare {{ tray.count() }} items</a>
          } @else {
            <span class="pk-btn pk-btn--primary pk-btn--sm" aria-disabled="true">Add 1 more to compare</span>
          }
        </div>
      </div>
    }

    <footer class="border-t border-line bg-paper pb-20 sm:pb-0">
      <div class="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-8 sm:flex-row sm:items-center sm:justify-between">
        <p class="t-small">
          <span class="pk-wordmark__urdu" lang="ur" dir="rtl">پرکھ</span>
          <span class="ml-2">Parakh checks prices across Pakistani stores every few hours.</span>
        </p>
        <p class="t-small">Always confirm the price on the store's site before you buy.</p>
      </div>
    </footer>

    <nav class="pk-tabbar fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-paper pb-[env(safe-area-inset-bottom)] sm:hidden" aria-label="Tabs">
      @for (tab of tabs; track tab.path) {
        <a [routerLink]="tab.path" routerLinkActive #t="routerLinkActive" [routerLinkActiveOptions]="{ exact: tab.path === '/' }" [attr.aria-current]="t.isActive ? 'page' : null">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">
            <path [attr.d]="tab.icon" />
          </svg>
          {{ tab.path === '/account' && !auth.isLoggedIn() ? 'Sign in' : tab.label }}
        </a>
      }
    </nav>
  `,
})
export class App {
  protected readonly auth = inject(AuthService);
  protected readonly tray = inject(CompareTrayService);
  private readonly router = inject(Router);
  protected readonly onComparePage = signal(false);
  protected readonly links = [
    { path: '/', label: 'Home' },
    { path: '/products', label: 'Browse' },
    { path: '/sales', label: 'Sales' },
    { path: '/assistant', label: 'Assistant' },
  ];
  // Phosphor-style outline glyphs: 24px grid, 1.75 stroke, square caps.
  protected readonly tabs = [
    { path: '/', label: 'Home', icon: 'M4 11l8-7 8 7v9h-5v-6H9v6H4z' },
    { path: '/products', label: 'Browse', icon: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' },
    { path: '/sales', label: 'Sales', icon: 'M3 12V4h8l10 10-8 8L3 12zM7.5 7.5h.01' },
    { path: '/account', label: 'My list', icon: 'M6 3h12v18l-6-4-6 4z' },
  ];

  protected cheapest = () => Math.min(...this.tray.items().map((p) => p.price));

  constructor() {
    this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd)).subscribe((e) => {
      this.onComparePage.set(e.urlAfterRedirects.startsWith('/compare'));
    });
  }
}
