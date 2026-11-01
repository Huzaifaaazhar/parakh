import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/home').then((m) => m.HomePage), title: 'Parakh — compare the same dish across restaurants' },
  { path: 'dishes', loadComponent: () => import('./pages/products').then((m) => m.ProductsPage), title: 'Dishes · Parakh' },
  { path: 'dishes/:id', loadComponent: () => import('./pages/product-detail').then((m) => m.ProductDetailPage), title: 'Dish · Parakh' },
  { path: 'restaurants', loadComponent: () => import('./pages/restaurants').then((m) => m.RestaurantsPage), title: 'Restaurants · Parakh' },
  { path: 'restaurants/:slug', loadComponent: () => import('./pages/restaurant').then((m) => m.RestaurantPage), title: 'Restaurant · Parakh' },
  { path: 'deals', loadComponent: () => import('./pages/sales').then((m) => m.SalesPage), title: 'Deals & offers · Parakh' },
  { path: 'compare', loadComponent: () => import('./pages/compare').then((m) => m.ComparePage), title: 'Compare dishes · Parakh' },
  { path: 'assistant', loadComponent: () => import('./pages/assistant').then((m) => m.AssistantPage), title: 'Food assistant · Parakh' },
  { path: 'account', loadComponent: () => import('./pages/account').then((m) => m.AccountPage), title: 'My list · Parakh' },
  // links from the shopping-era site
  { path: 'products', redirectTo: 'dishes' },
  { path: 'products/:id', redirectTo: 'dishes/:id' },
  { path: 'sales', redirectTo: 'deals' },
  { path: '**', redirectTo: '' },
];
