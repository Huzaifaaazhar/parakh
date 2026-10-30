import { HttpInterceptorFn } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';

import { ApiService } from './api.service';
import { User } from './models';

const TOKEN_KEY = 'parakh.token';
const USER_KEY = 'parakh.user';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private api = inject(ApiService);
  readonly token = signal<string | null>(read(TOKEN_KEY));
  readonly user = signal<User | null>(JSON.parse(read(USER_KEY) ?? 'null'));
  readonly isLoggedIn = computed(() => !!this.token());

  login(email: string, password: string): Observable<unknown> {
    return this.api.login(email, password).pipe(tap((res) => this.store(res.access_token, res.user)));
  }

  register(email: string, password: string, name?: string): Observable<unknown> {
    return this.api.register(email, password, name).pipe(tap((res) => this.store(res.access_token, res.user)));
  }

  logout(): void {
    this.token.set(null);
    this.user.set(null);
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch {
      /* storage unavailable */
    }
  }

  private store(token: string, user: User): void {
    this.token.set(token);
    this.user.set(user);
    try {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } catch {
      /* storage unavailable */
    }
  }
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = inject(AuthService).token();
  return next(token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req);
};
