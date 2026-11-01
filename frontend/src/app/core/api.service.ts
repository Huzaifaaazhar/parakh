import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../environments/environment';
import {
  AppNotification,
  Banner,
  OffersResponse,
  Restaurant,
  RestaurantDetail,
  Review,
  ChatResponse,
  CompareResponse,
  Facets,
  Page,
  PriceDrop,
  Product,
  ProductDetail,
  ProductFilters,
  SalesOverview,
  SearchResponse,
  SideBySideResponse,
  StoreSummary,
  User,
  WishlistItem,
} from './models';

function toParams(filters: object): HttpParams {
  let params = new HttpParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === '' || value === false) continue;
    if (Array.isArray(value)) value.forEach((v) => (params = params.append(key, String(v))));
    else params = params.set(key, String(value));
  }
  return params;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  private base = environment.apiBaseUrl;

  products(filters: ProductFilters): Observable<Page<Product>> {
    return this.http.get<Page<Product>>(`${this.base}/products`, { params: toParams(filters) });
  }

  search(q: string, filters: ProductFilters = {}): Observable<SearchResponse> {
    return this.http.get<SearchResponse>(`${this.base}/products/search`, { params: toParams({ ...filters, q }) });
  }

  trending(vertical?: string, limit = 12): Observable<Page<Product>> {
    return this.http.get<Page<Product>>(`${this.base}/products/trending`, { params: toParams({ vertical, limit }) });
  }

  facets(vertical?: string): Observable<Facets> {
    return this.http.get<Facets>(`${this.base}/products/facets`, { params: toParams({ vertical }) });
  }

  product(id: number): Observable<ProductDetail> {
    return this.http.get<ProductDetail>(`${this.base}/products/${id}`);
  }

  alternatives(productId: number, cheaperOnly = false, limit = 12): Observable<CompareResponse> {
    return this.http.post<CompareResponse>(`${this.base}/compare`, { product_id: productId, cheaper_only: cheaperOnly, limit });
  }

  sideBySide(productIds: number[]): Observable<SideBySideResponse> {
    return this.http.post<SideBySideResponse>(`${this.base}/compare`, { product_ids: productIds });
  }

  deals(filters: ProductFilters & { sort?: string } = {}): Observable<Page<Product>> {
    return this.http.get<Page<Product>>(`${this.base}/deals`, { params: toParams(filters) });
  }

  priceDrops(days = 14, limit = 24, vertical?: string): Observable<PriceDrop[]> {
    return this.http.get<PriceDrop[]>(`${this.base}/price-drops`, { params: toParams({ days, limit, vertical }) });
  }

  sales(vertical?: string): Observable<SalesOverview> {
    return this.http.get<SalesOverview>(`${this.base}/sales`, { params: toParams({ vertical }) });
  }

  stores(): Observable<StoreSummary[]> {
    return this.http.get<StoreSummary[]>(`${this.base}/stores`);
  }

  restaurants(params: { city?: string; cuisine?: string; q?: string } = {}): Observable<Restaurant[]> {
    return this.http.get<Restaurant[]>(`${this.base}/restaurants`, { params: toParams(params) });
  }

  restaurant(slug: string): Observable<RestaurantDetail> {
    return this.http.get<RestaurantDetail>(`${this.base}/restaurants/${encodeURIComponent(slug)}`);
  }

  offers(city?: string, limit = 24): Observable<OffersResponse> {
    return this.http.get<OffersResponse>(`${this.base}/offers`, { params: toParams({ city, limit }) });
  }

  reviews(params: { restaurant?: string; product_id?: number; with_media?: boolean; source?: string; limit?: number } = {}): Observable<Review[]> {
    return this.http.get<Review[]>(`${this.base}/reviews`, { params: toParams(params) });
  }

  postReview(slug: string, form: FormData): Observable<Review> {
    return this.http.post<Review>(`${this.base}/restaurants/${encodeURIComponent(slug)}/reviews`, form);
  }

  banners(): Observable<Banner[]> {
    return this.http.get<Banner[]>(`${this.base}/banners`);
  }

  bannerClick(id: number): Observable<void> {
    return this.http.post<void>(`${this.base}/banners/${id}/click`, {});
  }

  mediaUrl(url: string): string {
    // review uploads are served by the API host (relative "/media/..." paths)
    return url.startsWith('/') ? `${this.base.replace(/\/api$/, '')}${url}` : url;
  }

  chat(message: string, sessionId: string | null, productId?: number | null): Observable<ChatResponse> {
    return this.http.post<ChatResponse>(`${this.base}/chat`, { message, session_id: sessionId, product_id: productId ?? null });
  }

  register(email: string, password: string, name?: string) {
    return this.http.post<{ access_token: string; user: User }>(`${this.base}/auth/register`, { email, password, name });
  }

  login(email: string, password: string) {
    return this.http.post<{ access_token: string; user: User }>(`${this.base}/auth/login`, { email, password });
  }

  wishlist(): Observable<WishlistItem[]> {
    return this.http.get<WishlistItem[]>(`${this.base}/wishlist`);
  }

  addToWishlist(productId: number, targetPrice?: number | null): Observable<WishlistItem> {
    return this.http.post<WishlistItem>(`${this.base}/wishlist`, { product_id: productId, target_price: targetPrice || null });
  }

  removeFromWishlist(productId: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/wishlist/${productId}`);
  }

  notifications(): Observable<AppNotification[]> {
    return this.http.get<AppNotification[]>(`${this.base}/notifications`);
  }

  markNotificationsRead(): Observable<void> {
    return this.http.post<void>(`${this.base}/notifications/read`, {});
  }
}
