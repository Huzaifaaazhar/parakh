import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/home').then((m) => m.HomePage), title: 'Parakh — compare prices & sales' },
  { path: 'products', loadComponent: () => import('./pages/products').then((m) => m.ProductsPage), title: 'Browse products · Parakh' },
  { path: 'products/:id', loadComponent: () => import('./pages/product-detail').then((m) => m.ProductDetailPage), title: 'Product · Parakh' },
  { path: 'compare', loadComponent: () => import('./pages/compare').then((m) => m.ComparePage), title: 'Compare · Parakh' },
  { path: 'sales', loadComponent: () => import('./pages/sales').then((m) => m.SalesPage), title: 'All sales · Parakh' },
  { path: 'assistant', loadComponent: () => import('./pages/assistant').then((m) => m.AssistantPage), title: 'Shopping assistant · Parakh' },
  { path: 'account', loadComponent: () => import('./pages/account').then((m) => m.AccountPage), title: 'My list · Parakh' },
  { path: '**', redirectTo: '' },
];
