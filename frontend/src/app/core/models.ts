export type Vertical = 'fashion' | 'electronics' | 'beauty' | 'home' | 'other';
export type Gender = 'men' | 'women' | 'kids' | 'unisex';
export type SortOption = 'relevance' | 'price_asc' | 'price_desc' | 'discount' | 'newest' | 'value';

export interface Product {
  id: number;
  store_id: number;
  store_name: string | null;
  brand_name: string;
  product_name: string;
  vertical: Vertical;
  category: string;
  gender: Gender | null;
  price: number;
  original_price: number;
  discount_percentage: number;
  currency: string;
  fabric: string | null;
  color: string | null;
  image_url: string | null;
  product_url: string;
  in_stock: boolean;
  is_on_sale: boolean;
  last_updated: string;
  // present on price-drop items from the assistant
  old_price?: number;
  drop_percentage?: number;
}

export interface PricePoint {
  price: number;
  original_price: number;
  in_stock: boolean;
  recorded_at: string;
}

export interface ProductDetail extends Product {
  description: string | null;
  attributes: Record<string, unknown>;
  tags: string[];
  first_seen_at: string;
  last_price_change_at: string | null;
  price_history: PricePoint[];
  lowest_price: number | null;
  highest_price: number | null;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  pages?: number;
}

export interface SearchResponse extends Page<Product> {
  query: string;
  parsed_filters: Record<string, unknown>;
  semantic: boolean;
}

export interface FacetValue {
  value: string;
  count: number;
}

export interface Facets {
  verticals: FacetValue[];
  categories: FacetValue[];
  brands: FacetValue[];
  stores: FacetValue[];
  genders: FacetValue[];
  colors: FacetValue[];
  price_min: number;
  price_max: number;
}

export interface ProductFilters {
  q?: string;
  vertical?: string;
  category?: string;
  gender?: string;
  brand?: string[];
  store?: string[];
  color?: string;
  min_price?: number;
  max_price?: number;
  on_sale?: boolean;
  min_discount?: number;
  sort?: SortOption;
  page?: number;
  page_size?: number;
}

export interface Alternative {
  product: Product;
  similarity: number;
  match_type: 'same_product' | 'similar';
  price_difference: number;
  price_difference_pct: number;
  is_cheaper: boolean;
  shared_features: string[];
  differences: string[];
}

export interface CompareResponse {
  base: Product;
  alternatives: Alternative[];
  cheapest: Product | null;
  best_value: Product | null;
  summary: string;
}

export interface SideBySideResponse {
  products: Product[];
  rows: { attribute: string; values: (string | null)[]; best_index: number | null }[];
  summary: string;
}

export interface PriceDrop {
  product: Product;
  old_price: number;
  new_price: number;
  drop_amount: number;
  drop_percentage: number;
  detected_at: string;
}

export interface StoreSummary {
  id: number;
  slug: string;
  name: string;
  website: string;
  verticals: string[];
  last_scraped_at: string | null;
  total_products: number;
  on_sale: number;
  sale_share: number;
  max_discount: number;
  avg_discount: number;
}

export interface SalesOverview {
  total_products: number;
  total_on_sale: number;
  average_discount: number;
  stores: StoreSummary[];
  by_vertical: Record<string, number>;
  top_deals: Product[];
  recent_price_drops: PriceDrop[];
}

export interface ChatResponse {
  session_id: string;
  answer: string;
  intent: string;
  filters: Record<string, unknown>;
  products: Product[];
  comparison: CompareResponse | null;
  suggestions: string[];
  used_llm: boolean;
  agent_trace: string[];
}

export interface User {
  id: number;
  email: string;
  name: string | null;
  created_at: string;
}

export interface WishlistItem {
  id: number;
  product: Product;
  target_price: number | null;
  notify: boolean;
  created_at: string;
}

export interface AppNotification {
  id: number;
  product_id: number | null;
  kind: string;
  message: string;
  is_read: boolean;
  created_at: string;
}
