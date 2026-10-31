import { Injectable, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, of, tap } from 'rxjs';

import { ApiService } from './api.service';
import { AuthService } from './auth.service';

/** Which products the signed-in shopper has saved, so every card can show its save state. */
@Injectable({ providedIn: 'root' })
export class WishlistService {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private router = inject(Router);
  readonly ids = signal<Set<number>>(new Set());

  constructor() {
    effect(() => {
      if (!this.auth.isLoggedIn()) {
        this.ids.set(new Set());
        return;
      }
      this.api
        .wishlist()
        .pipe(catchError(() => of([])))
        .subscribe((items) => this.ids.set(new Set(items.map((w) => w.product.id))));
    });
  }

  has(id: number): boolean {
    return this.ids().has(id);
  }

  /** Save or unsave; sends signed-out shoppers to sign in first. */
  toggle(id: number): Observable<unknown> {
    if (!this.auth.isLoggedIn()) {
      this.router.navigate(['/account'], { queryParams: { next: this.router.url } });
      return of(null);
    }
    const saved = this.has(id);
    const req: Observable<unknown> = saved ? this.api.removeFromWishlist(id) : this.api.addToWishlist(id);
    return req.pipe(
      tap(() =>
        this.ids.update((set) => {
          const next = new Set(set);
          if (saved) next.delete(id);
          else next.add(id);
          return next;
        }),
      ),
    );
  }
}
