import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';

import { AuthService } from './core/auth.service';
import { CompareTrayService } from './core/compare-tray.service';
import { PkrPipe } from './shared/format';
import { ProductImage } from './shared/product-image';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, FormsModule, ProductImage, PkrPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a href="#main" class="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-card focus:px-3 focus:py-2"
      >Skip to content</a
    >
    <header class="sticky top-0 z-30 bg-white/90 backdrop-blur">
      <div class="absolute inset-x-0 bottom-0 h-[3px] bg-gradient-to-r from-ink via-blue to-pink" aria-hidden="true"></div>
      <div class="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:gap-6">
        <a routerLink="/" class="flex shrink-0 items-center gap-2" aria-label="Parakh home">
          <img src="favicon.svg" alt="" class="h-8 w-8" />
          <span class="font-display text-xl font-bold">Parakh</span>
        </a>
        <form (ngSubmit)="search()" class="hidden flex-1 md:block" role="search">
          <label class="relative block">
            <span class="sr-only">Search products</span>
            <svg
              class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            <input [(ngModel)]="query" name="q" class="input rounded-full pl-9" placeholder="Try “black kurta under 3000” or “earbuds on sale”" />
          </label>
        </form>
        <nav class="ml-auto flex items-center gap-1 text-sm font-medium" aria-label="Main">
          @for (link of links; track link.path) {
            <a
              [routerLink]="link.path"
              routerLinkActive="bg-gradient-to-r from-ink to-blue text-white shadow-sm"
              [routerLinkActiveOptions]="{ exact: link.path === '/' }"
              class="hidden rounded-full px-3 py-1.5 hover:bg-ink/5 sm:inline-block"
              >{{ link.label }}</a
            >
          }
          <a routerLink="/account" routerLinkActive="bg-gradient-to-r from-ink to-blue text-white shadow-sm" class="rounded-full px-3 py-1.5 hover:bg-ink/5">
            {{ auth.isLoggedIn() ? 'My list' : 'Sign in' }}
          </a>
          <button
            type="button"
            class="rounded-full p-2 hover:bg-ink/5 sm:hidden"
            (click)="menuOpen.set(!menuOpen())"
            [attr.aria-expanded]="menuOpen()"
            aria-label="Menu"
          >
            <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
        </nav>
      </div>
      <form (ngSubmit)="search()" class="px-4 pb-3 md:hidden" role="search">
        <input [(ngModel)]="query" name="qm" class="input rounded-full" placeholder="Search clothes, phones, perfumes…" aria-label="Search products" />
      </form>
      @if (menuOpen()) {
        <nav class="flex flex-col border-t border-line px-4 py-2 sm:hidden" aria-label="Mobile">
          @for (link of links; track link.path) {
            <a [routerLink]="link.path" (click)="menuOpen.set(false)" class="rounded-lg px-2 py-2 text-sm font-medium hover:bg-ink/5">{{ link.label }}</a>
          }
        </nav>
      }
    </header>

    <main id="main" class="min-h-[70vh]">
      <router-outlet />
    </main>

    @if (tray.count() > 0 && !onComparePage()) {
      <div class="fixed inset-x-0 bottom-4 z-40 px-4">
        <div class="bg-brand mx-auto flex max-w-3xl items-center gap-3 rounded-2xl p-3 text-white shadow-2xl shadow-ink/30">
          <div class="flex -space-x-2">
            @for (p of tray.items(); track p.id) {
              <button
                type="button"
                (click)="tray.remove(p.id)"
                class="h-10 w-10 overflow-hidden rounded-lg border-2 border-ink bg-paper"
                [attr.aria-label]="'Remove ' + p.product_name"
              >
                <app-product-image [src]="p.image_url" [vertical]="p.vertical" />
              </button>
            }
          </div>
          <p class="min-w-0 flex-1 text-sm">
            <span class="font-semibold">{{ tray.count() }} selected</span>
            <span class="hidden text-white/70 sm:inline"> · from {{ tray.items()[0].price | pkr }} · add up to 4</span>
          </p>
          <button type="button" class="text-sm text-white/70 hover:text-white" (click)="tray.clear()">Clear</button>
          <a routerLink="/compare" class="btn-accent" [class.pointer-events-none]="tray.count() < 2" [class.opacity-50]="tray.count() < 2"
            >Compare side by side</a
          >
        </div>
      </div>
    }

    <footer class="bg-brand mt-16 text-white/85">
      <div class="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-8 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p><span class="font-display font-semibold text-white">Parakh</span> — one place to compare prices and sales across Pakistani stores.</p>
        <p>Prices are refreshed from each store every few hours. Always confirm on the store's site before buying.</p>
      </div>
    </footer>
  `,
})
export class App {
  protected readonly auth = inject(AuthService);
  protected readonly tray = inject(CompareTrayService);
  private readonly router = inject(Router);
  protected readonly menuOpen = signal(false);
  protected readonly onComparePage = signal(false);
  protected query = '';
  protected readonly links = [
    { path: '/', label: 'Home' },
    { path: '/products', label: 'Browse' },
    { path: '/sales', label: 'Sales' },
    { path: '/assistant', label: 'Assistant' },
  ];

  constructor() {
    this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd)).subscribe((e) => {
      this.onComparePage.set(e.urlAfterRedirects.startsWith('/compare'));
      this.menuOpen.set(false);
      window.scrollTo({ top: 0 });
    });
  }

  search(): void {
    const q = this.query.trim();
    if (q) this.router.navigate(['/products'], { queryParams: { q } });
  }
}
