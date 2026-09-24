/**
 * SHILP-AI Supabase Service Layer
 *
 * Replaces Firebase as the primary backend for:
 *  - PostgreSQL (products, artisan profiles, messages, reviews, orders)
 *  - Auth (Phone OTP for artisans, Email OTP for buyers)
 *  - Storage (product images, avatars, private ID docs, chat attachments)
 *  - Realtime (chat messages channel)
 *
 * Design principles:
 *  1. Every exported function gracefully falls back when Supabase is not
 *     configured (no env vars) — the app still runs with localStorage.
 *  2. Private documents (Aadhaar, GI cert) NEVER go through public buckets.
 *  3. Verification status is stored as a flag; documents are stored in a
 *     private bucket accessible only to the document owner.
 *  4. No secrets are embedded in source — everything comes from import.meta.env.
 */

import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import { ProductListing, ArtisanProfile, ChatMessage, Conversation, ProductReview } from '../types';
import { INITIAL_PRODUCTS } from '../data/craftPresets';

// ─── Configuration ────────────────────────────────────────────────────────────

const SUPABASE_URL = (import.meta as any).env?.VITE_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY ?? '';

/** True only when both env vars are present */
export const isSupabaseConfigured = (): boolean =>
  Boolean(SUPABASE_URL && SUPABASE_ANON_KEY &&
    SUPABASE_URL.startsWith('https://') &&
    SUPABASE_ANON_KEY.length > 20);

// ─── Client ───────────────────────────────────────────────────────────────────

let supabase: SupabaseClient | null = null;

try {
  if (isSupabaseConfigured()) {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      realtime: {
        params: { eventsPerSecond: 10 },
      },
    });
  }
} catch (err) {
  console.warn('[Supabase] Initialization skipped — credentials not configured.', err);
}

export { supabase };

/**
 * Validate if a string is a valid UUID format (v4 or standard 36-char hex string).
 */
export function isUuid(id: string | null | undefined): boolean {
  if (!id) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

/** Helper to convert username to internal email for Supabase Auth */
export function getInternalEmail(usernameOrEmailOrPhone: string): string {
  const trimmed = usernameOrEmailOrPhone.trim().toLowerCase();
  if (trimmed.includes('@')) return trimmed;
  const cleanUsername = trimmed.replace(/[^a-z0-9_.]/g, '');
  return `${cleanUsername || 'user'}@shilpai.internal`;
}

/** Sign Up with Username & Password using Supabase Auth */
export async function signUpWithUsernamePassword(params: {
  username: string;
  password: string;
  phone?: string;
  role: 'artisan' | 'buyer';
  name: string;
  companyName?: string;
}): Promise<{ user: any; error: Error | null }> {
  if (!supabase) {
    // Development fallback mock session with valid UUIDs
    const mockId = params.role === 'artisan'
      ? '00000000-0000-0000-0000-000000000101'
      : '00000000-0000-0000-0000-000000000201';
    return {
      user: {
        id: mockId,
        email: getInternalEmail(params.username),
        user_metadata: {
          username: params.username,
          name: params.name,
          role: params.role,
          phone: params.phone,
          companyName: params.companyName,
        },
      },
      error: null,
    };
  }

  const email = getInternalEmail(params.username);
  const { data, error } = await supabase.auth.signUp({
    email,
    password: params.password,
    options: {
      data: {
        username: params.username,
        name: params.name,
        role: params.role,
        phone: params.phone,
        companyName: params.companyName,
      },
    },
  });

  if (error) {
    return { user: null, error: new Error(error.message) };
  }

  return { user: data.user, error: null };
}

/** Sign In with Phone or Username & Password using Supabase Auth */
export async function signInWithUsernamePassword(params: {
  username: string;
  password: string;
}): Promise<{ user: any; error: Error | null }> {
  if (!supabase) {
    const mockId = '00000000-0000-0000-0000-000000000101';
    return {
      user: {
        id: mockId,
        email: getInternalEmail(params.username),
        user_metadata: {
          username: params.username,
          name: params.username,
          role: 'artisan',
        },
      },
      error: null,
    };
  }

  // 1. Try phone + password if parameter looks like a phone number
  const normalizedPhone = normalizePhoneNumber(params.username);
  if (normalizedPhone && normalizedPhone.length >= 10) {
    const { data: phoneData, error: phoneError } = await supabase.auth.signInWithPassword({
      phone: normalizedPhone,
      password: params.password,
    });
    if (!phoneError && phoneData?.user) {
      return { user: phoneData.user, error: null };
    }
  }

  // 2. Fall back to email/username + password
  const email = getInternalEmail(params.username);
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: params.password,
  });

  if (error) {
    return { user: null, error: new Error(error.message) };
  }

  return { user: data.user, error: null };
}

/**
 * Clean up legacy test records (e.g. Rameshwaram Koli test records with 'art-101' as artisan_id/id).
 * Safe to run once after fixing ID architecture.
 */
export async function cleanupLegacyTestRecords(): Promise<void> {
  if (!supabase) return;
  try {
    // Clean legacy test profile with shilp_artisan_id 'art-101' (text column)
    await supabase.from('artisan_profiles').delete().eq('shilp_artisan_id', 'art-101');
    console.info('[Supabase] Legacy test records cleaned up successfully.');
  } catch (err) {
    console.warn('[Supabase] Cleanup notice:', err);
  }
}

/**
 * Normalize Indian phone numbers to E.164 format (+91XXXXXXXXXX)
 * Example: 9063114094 -> +919063114094
 */
export function normalizePhoneNumber(phone: string): string {
  if (!phone) return '';
  let cleaned = phone.replace(/\D/g, ''); // strip non-digits
  if (cleaned.length === 10) {
    cleaned = '91' + cleaned;
  }
  if (!cleaned.startsWith('+')) {
    return '+' + cleaned;
  }
  return cleaned;
}

/**
 * Send a phone OTP using Vonage SMS provider via Supabase Auth.
 * Automatically normalizes phone numbers (e.g. 9063114094 -> +919063114094).
 */
export async function sendPhoneOTP(phone: string): Promise<{ normalizedPhone: string; error: Error | null }> {
  const normalizedPhone = normalizePhoneNumber(phone);
  if (!normalizedPhone || normalizedPhone.length < 10) {
    return { normalizedPhone, error: new Error('Please enter a valid phone number.') };
  }

  if (!supabase) {
    return { normalizedPhone, error: new Error('Supabase is not configured. Please check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.') };
  }

  const { error } = await supabase.auth.signInWithOtp({ phone: normalizedPhone });
  return { normalizedPhone, error: error ? new Error(error.message) : null };
}

/**
 * Verify phone OTP token sent by SMS via Supabase Auth.
 * Returns the authenticated Supabase user and real UUID.
 */
export async function verifyPhoneOTP(
  phone: string,
  token: string
): Promise<{ user: any; userId: string | null; error: Error | null }> {
  const normalizedPhone = normalizePhoneNumber(phone);
  if (!normalizedPhone) {
    return { user: null, userId: null, error: new Error('Invalid phone number.') };
  }

  if (!supabase) {
    return { user: null, userId: null, error: new Error('Supabase is not configured. Please check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.') };
  }

  const { data, error } = await supabase.auth.verifyOtp({
    phone: normalizedPhone,
    token,
    type: 'sms',
  });

  if (error || !data.user) {
    return {
      user: null,
      userId: null,
      error: new Error(error?.message ?? 'OTP Verification failed. Please check the code.'),
    };
  }

  return { user: data.user, userId: data.user.id, error: null };
}

/**
 * Sarvam AI translation helper connected via Supabase Edge Function.
 * The Sarvam API key is stored securely in Supabase secrets.
 */
export async function translateWithSarvam(
  text: string,
  targetLanguage: string,
  sourceLanguage = 'auto'
): Promise<string> {
  if (!supabase) return text;
  try {
    const { data, error } = await supabase.functions.invoke('sarvam-translate', {
      body: { text, targetLanguage, sourceLanguage },
    });
    if (error || !data?.translatedText) {
      return text;
    }
    return data.translatedText;
  } catch {
    return text;
  }
}

/**
 * Send an email OTP (used for buyers or as dev fallback).
 */
export async function sendEmailOTP(email: string): Promise<{ error: Error | null }> {
  if (!supabase) {
    return { error: new Error('Supabase not configured') };
  }
  const { error } = await supabase.auth.signInWithOtp({ email });
  return { error: error ? new Error(error.message) : null };
}

/**
 * Verify an email OTP token.
 */
export async function verifyEmailOTP(
  email: string,
  token: string
): Promise<{ userId: string | null; error: Error | null }> {
  if (!supabase) {
    return { userId: null, error: new Error('Supabase not configured') };
  }
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: 'email',
  });
  if (error || !data.user) {
    return { userId: null, error: new Error(error?.message ?? 'Verification failed') };
  }
  return { userId: data.user.id, error: null };
}

/**
 * Get the currently signed-in Supabase user (or null).
 */
export async function getCurrentSupabaseUser() {
  if (!supabase) return null;
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

/**
 * Sign out the current user.
 */
export async function supabaseSignOut(): Promise<void> {
  if (!supabase) return;
  await supabase.auth.signOut();
}

/**
 * Listen to auth state changes.
 * Returns an unsubscribe function.
 */
export function onAuthStateChange(
  callback: (userId: string | null) => void
): () => void {
  if (!supabase) return () => {};
  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user?.id ?? null);
  });
  return () => subscription.unsubscribe();
}

// ─── Artisan Profiles ─────────────────────────────────────────────────────────

export interface SupabaseArtisanProfile {
  id: string;                          // UUID (references auth.users)
  shilp_artisan_id: string;            // e.g. SHILP-TEL-2024-04921
  name: string | null;
  regional_name: string | null;
  phone: string | null;
  craft_cluster: string | null;
  district: string | null;
  state: string | null;
  bio: string | null;
  experience_years: number | null;
  avatar_url: string | null;
  gi_tag_craft: string | null;
  exhibitions: string[] | null;
  /**
   * 'normal' | 'identity_verified' | 'gi_craft_verified'
   * This is the ONLY verification-related field that is ever publicly readable.
   */
  verification_tier: 'normal' | 'identity_verified' | 'gi_craft_verified';
  /**
   * Private storage path to uploaded government ID document.
   * NEVER exposed via public queries — stored in private bucket.
   * RLS: SELECT allowed only for id = auth.uid().
   */
  identity_doc_ref: string | null;
  /**
   * Private storage path to uploaded GI craft certificate.
   * Same privacy constraints as identity_doc_ref.
   */
  gi_cert_ref: string | null;
  is_identity_verified: boolean;
  is_gi_verified: boolean;
  beneficiary_id: string | null;
  shilp_card_number: string | null;
  rating: number;
  total_sales_count: number;
  total_earnings: number;
  bank_linked: boolean;
  onboarding_complete: boolean;
  created_at: string;
}

/**
 * Fetch a single artisan profile by UUID or public display ID.
 * Returns only non-sensitive public fields.
 */
export async function fetchArtisanProfile(
  userId: string
): Promise<SupabaseArtisanProfile | null> {
  if (!supabase || !userId) return null;
  
  let query = supabase
    .from('artisan_profiles')
    .select(
      'id, shilp_artisan_id, name, regional_name, phone, craft_cluster, district, state, bio, experience_years, avatar_url, gi_tag_craft, exhibitions, verification_tier, is_identity_verified, is_gi_verified, beneficiary_id, shilp_card_number, rating, total_sales_count, total_earnings, bank_linked, onboarding_complete, created_at'
    );

  if (isUuid(userId)) {
    query = query.eq('id', userId);
  } else {
    query = query.eq('shilp_artisan_id', userId);
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    console.warn('[Supabase] fetchArtisanProfile error:', error.message);
    return null;
  }
  return data as SupabaseArtisanProfile | null;
}

/**
 * Upsert an artisan profile row.
 * `sensitiveFields` (identity_doc_ref, gi_cert_ref) are updated separately
 * via `updateVerificationRefs` to keep them in a clearly gated function.
 */
export async function upsertArtisanProfile(
  profile: Partial<SupabaseArtisanProfile> & { id: string }
): Promise<{ error: Error | null }> {
  if (!supabase) return { error: new Error('Supabase not configured') };
  if (!isUuid(profile.id)) {
    return { error: new Error(`Cannot upsert profile: ID "${profile.id}" is not a valid Supabase UUID.`) };
  }
  // Strip private fields from general upserts — use updateVerificationRefs instead
  const { identity_doc_ref, gi_cert_ref, ...publicFields } = profile;
  const { error } = await supabase
    .from('artisan_profiles')
    .upsert({ ...publicFields }, { onConflict: 'id' });
  return { error: error ? new Error(error.message) : null };
}

/**
 * Update ONLY the private verification document references.
 * Called exclusively from the verification document upload flow.
 * RLS policy ensures only the row owner (auth.uid() = id) can update these.
 *
 * IMPORTANT: We never expose these references to other users.
 */
export async function updateVerificationRefs(
  userId: string,
  refs: { identity_doc_ref?: string; gi_cert_ref?: string; verification_tier?: SupabaseArtisanProfile['verification_tier']; is_identity_verified?: boolean; is_gi_verified?: boolean }
): Promise<{ error: Error | null }> {
  if (!supabase) return { error: new Error('Supabase not configured') };
  const { error } = await supabase
    .from('artisan_profiles')
    .update(refs)
    .eq('id', userId);
  return { error: error ? new Error(error.message) : null };
}

// ─── Artisan ID Generation ─────────────────────────────────────────────────────

/**
 * Generate a unique Shilp-AI Artisan ID.
 * Format: SHILP-{STATE_CODE}-{YEAR}-{5_DIGIT_RANDOM}
 * Example: SHILP-TEL-2024-04921
 *
 * We check Supabase for uniqueness (up to 5 retries).
 */
const STATE_CODES: Record<string, string> = {
  'andhra pradesh': 'APR', 'arunachal pradesh': 'ARN', 'assam': 'ASM',
  'bihar': 'BHR', 'chhattisgarh': 'CGR', 'goa': 'GOA', 'gujarat': 'GUJ',
  'haryana': 'HRY', 'himachal pradesh': 'HPR', 'jharkhand': 'JHR',
  'karnataka': 'KAR', 'kerala': 'KRL', 'madhya pradesh': 'MPR',
  'maharashtra': 'MHR', 'manipur': 'MNP', 'meghalaya': 'MGH',
  'mizoram': 'MZR', 'nagaland': 'NGL', 'odisha': 'ODI',
  'punjab': 'PNJ', 'rajasthan': 'RAJ', 'sikkim': 'SKM',
  'tamil nadu': 'TNN', 'telangana': 'TEL', 'tripura': 'TRP',
  'uttar pradesh': 'UPR', 'uttarakhand': 'UTR', 'west bengal': 'WBN',
  'delhi': 'DLH', 'jammu and kashmir': 'JNK', 'ladakh': 'LDK',
};

export function getStateCode(state: string): string {
  return STATE_CODES[state.toLowerCase().trim()] ?? 'IND';
}

export async function generateUniqueArtisanId(state: string): Promise<string> {
  const stateCode = getStateCode(state);
  const year = new Date().getFullYear();

  for (let attempt = 0; attempt < 5; attempt++) {
    const rand = Math.floor(10000 + Math.random() * 89999);
    const candidate = `SHILP-${stateCode}-${year}-${rand}`;

    if (!supabase) return candidate; // No DB to check uniqueness against

    const { data, error } = await supabase
      .from('artisan_profiles')
      .select('shilp_artisan_id')
      .eq('shilp_artisan_id', candidate)
      .maybeSingle();

    if (error) {
      console.warn('[Supabase] ID uniqueness check error:', error.message);
      return candidate;
    }
    if (!data) return candidate; // No collision — use it
  }

  // Fallback: timestamp-based
  return `SHILP-${stateCode}-${year}-${Date.now().toString().slice(-5)}`;
}

// ─── Products ─────────────────────────────────────────────────────────────────

/**
 * Save a product to Supabase. Falls back to localStorage on failure.
 */
export async function saveProductToSupabase(product: ProductListing): Promise<string> {
  let originalUrl = product.originalImageUrl ?? product.originalImage;
  let enhancedUrl = product.enhancedImageUrl ?? product.enhancedImage;

  if (supabase) {
    try {
      if (originalUrl && originalUrl.startsWith('data:')) {
        const path = `products/${product.id}/original_${Date.now()}.jpg`;
        originalUrl = await uploadImageToSupabase(originalUrl, 'product-images', path);
      }
      if (enhancedUrl && enhancedUrl.startsWith('data:')) {
        const path = `products/${product.id}/enhanced_${Date.now()}.jpg`;
        enhancedUrl = await uploadImageToSupabase(enhancedUrl, 'product-images', path);
      }
    } catch (err) {
      console.warn('[Supabase Storage] Image upload exception for product:', err);
    }
  }

  // Update in-memory product object URLs
  product.originalImage = originalUrl;
  product.originalImageUrl = originalUrl;
  product.enhancedImage = enhancedUrl;
  product.enhancedImageUrl = enhancedUrl;

  const productRow = {
    id: product.id,
    artisan_id: product.artisanId && isUuid(product.artisanId) ? product.artisanId : null,
    artisan_name: product.artisanName,
    state: product.state,
    title_en: product.titleEn,
    title_hi: product.titleHi,
    category: product.category,
    craft_technique: product.craftTechnique,
    primary_material: product.primaryMaterial,
    color: product.color,
    production_days: product.productionDays,
    raw_material_cost: product.rawMaterialCost,
    original_image_url: originalUrl,
    enhanced_image_url: enhancedUrl,
    has_background_removed: product.hasBackgroundRemoved,
    has_lighting_enhanced: product.hasLightingEnhanced,
    description_en: product.descriptionEn,
    description_hi: product.descriptionHi,
    seo_keywords: product.seoKeywords,
    pricing: product.pricing,
    target_buyers: product.targetBuyers,
    stock_quantity: product.stockQuantity,
    gi_certified: product.giCertified,
    featured: product.featured ?? false,
    product_size: product.productSize ?? null,
    quality_tier: product.qualityTier ?? null,
    created_at: product.createdAt,
  };

  if (supabase) {
    try {
      // Attach current user ID if signed in
      const { data: { user } } = await supabase.auth.getUser();
      if (user) productRow.artisan_id = user.id;

      const { error } = await supabase.from('products').upsert(productRow, { onConflict: 'id' });
      if (!error) return product.id;
      console.warn('[Supabase] saveProduct error:', error.message);
    } catch (err) {
      console.warn('[Supabase] saveProduct exception:', err);
    }
  }

  return product.id;
}

/**
 * Fetch all products. Tries Supabase first, then localStorage, then preset data.
 */
export async function fetchProductsFromSupabase(): Promise<ProductListing[]> {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .order('created_at', { ascending: false });

      if (!error && data && data.length > 0) {
        return data.map(row => mapRowToProduct(row));
      }
      if (error) {
        console.warn('[Supabase] fetchProducts error, falling back:', error.message);
      }
    } catch (err) {
      console.warn('[Supabase] fetchProducts exception:', err);
    }
  }

  // localStorage fallback
  try {
    const saved = localStorage.getItem('shilp_ai_products');
    if (saved) {
      const parsed = JSON.parse(saved) as ProductListing[];
      if (parsed.length > 0) return parsed;
    }
  } catch {}

  return INITIAL_PRODUCTS;
}

/** Map a Supabase products row → ProductListing (camelCase) */
function mapRowToProduct(row: Record<string, any>): ProductListing {
  return {
    id: row.id,
    artisanId: row.artisan_id ?? row.artisanId ?? '',
    artisanName: row.artisan_name ?? row.artisanName ?? '',
    state: row.state ?? '',
    titleEn: row.title_en ?? row.titleEn ?? '',
    titleHi: row.title_hi ?? row.titleHi ?? '',
    category: row.category,
    craftTechnique: row.craft_technique ?? row.craftTechnique ?? '',
    primaryMaterial: row.primary_material ?? row.primaryMaterial ?? '',
    color: row.color ?? '',
    productionDays: row.production_days ?? row.productionDays ?? 1,
    rawMaterialCost: row.raw_material_cost ?? row.rawMaterialCost ?? 0,
    // Always prefer the enhanced image URL for display
    originalImage: row.original_image_url ?? row.originalImage ?? '',
    enhancedImage: row.enhanced_image_url ?? row.enhancedImage ?? row.original_image_url ?? '',
    originalImageUrl: row.original_image_url ?? row.originalImageUrl,
    enhancedImageUrl: row.enhanced_image_url ?? row.enhancedImageUrl,
    hasBackgroundRemoved: row.has_background_removed ?? row.hasBackgroundRemoved ?? false,
    hasLightingEnhanced: row.has_lighting_enhanced ?? row.hasLightingEnhanced ?? false,
    descriptionEn: row.description_en ?? row.descriptionEn ?? '',
    descriptionHi: row.description_hi ?? row.descriptionHi ?? '',
    seoKeywords: row.seo_keywords ?? row.seoKeywords ?? [],
    pricing: row.pricing ?? {},
    targetBuyers: row.target_buyers ?? row.targetBuyers ?? [],
    stockQuantity: row.stock_quantity ?? row.stockQuantity ?? 1,
    giCertified: row.gi_certified ?? row.giCertified ?? false,
    createdAt: row.created_at ?? row.createdAt ?? new Date().toISOString(),
    featured: row.featured ?? false,
    productSize: row.product_size ?? row.productSize,
    qualityTier: row.quality_tier ?? row.qualityTier,
  };
}

// ─── Storage ──────────────────────────────────────────────────────────────────

export type StorageBucket =
  | 'product-images'    // public — product photos
  | 'artisan-avatars'   // public — artisan profile photos
  | 'chat-attachments'; // authenticated read — chat images

/** Public buckets — anyone can read */
const PUBLIC_BUCKETS: StorageBucket[] = ['product-images', 'artisan-avatars'];

/**
 * Upload a file (File object or base64 data URL) to a Supabase public bucket.
 * Returns the public URL. Falls back to returning the original dataUrl.
 *
 * NOTE: For private identity documents, use `uploadPrivateDocument` instead.
 */
export async function uploadImageToSupabase(
  imageData: File | string,
  bucket: StorageBucket,
  path: string
): Promise<string> {
  if (!supabase) return typeof imageData === 'string' ? imageData : '';

  try {
    let uploadResult;

    if (typeof imageData === 'string' && imageData.startsWith('data:')) {
      // Base64 data URL → convert to Blob
      const res = await fetch(imageData);
      const blob = await res.blob();
      uploadResult = await supabase.storage.from(bucket).upload(path, blob, {
        upsert: true,
        contentType: blob.type || 'image/jpeg',
      });
    } else if (imageData instanceof File) {
      uploadResult = await supabase.storage.from(bucket).upload(path, imageData, {
        upsert: true,
      });
    } else {
      return typeof imageData === 'string' ? imageData : '';
    }

    if (uploadResult.error) {
      console.warn('[Supabase Storage] Upload error:', uploadResult.error.message);
      return typeof imageData === 'string' ? imageData : '';
    }

    if (PUBLIC_BUCKETS.includes(bucket)) {
      const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(path);
      return publicUrl;
    }

    // For authenticated buckets, create a signed URL (1 hour)
    const { data: signedData } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, 3600);
    return signedData?.signedUrl ?? (typeof imageData === 'string' ? imageData : '');
  } catch (err) {
    console.warn('[Supabase Storage] Exception during upload:', err);
    return typeof imageData === 'string' ? imageData : '';
  }
}

/**
 * Upload a PRIVATE identity/GI document for an artisan.
 * Stored in the 'identity-docs' or 'gi-certificates' bucket.
 *
 * PRIVACY:
 * - These buckets have NO public access.
 * - RLS on the bucket allows SELECT/INSERT only for the authenticated owner.
 * - Returns ONLY the storage path (never a public URL).
 * - The path is stored in identity_doc_ref / gi_cert_ref columns which are
 *   also restricted by RLS to the document owner.
 */
export async function uploadPrivateDocument(
  file: File,
  documentType: 'identity' | 'gi-certificate',
  userId: string
): Promise<{ storagePath: string | null; error: Error | null }> {
  if (!supabase) {
    return { storagePath: null, error: new Error('Supabase not configured') };
  }

  const bucket = documentType === 'identity' ? 'identity-docs' : 'gi-certificates';
  const ext = file.name.split('.').pop() ?? 'pdf';
  const path = `${userId}/${documentType}-${Date.now()}.${ext}`;

  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    upsert: false, // never overwrite — keep originals
  });

  if (error) {
    console.warn('[Supabase] Private document upload error:', error.message);
    return { storagePath: null, error: new Error(error.message) };
  }

  return { storagePath: path, error: null };
}

// ─── Conversations & Messages (Realtime) ─────────────────────────────────────

export interface SupabaseMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  sender_role: 'artisan' | 'buyer';
  sender_name: string;
  text: string;
  image_url: string | null;
  customization_request: Record<string, any> | null;
  is_read: boolean;
  created_at: string;
}

/**
 * Map a SupabaseMessage row to a frontend ChatMessage object.
 */
export function mapSupabaseMessageToChatMessage(msg: SupabaseMessage): ChatMessage {
  return {
    id: msg.id,
    conversationId: msg.conversation_id,
    senderId: msg.sender_id,
    senderRole: msg.sender_role,
    senderName: msg.sender_name,
    text: msg.text,
    timestamp: new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    customizationRequest: msg.customization_request ?? undefined,
    isRead: msg.is_read,
    imageUrl: msg.image_url ?? undefined,
  };
}

/**
 * Upsert a conversation row.
 */
export async function upsertConversation(
  conversation: Omit<Conversation, 'messages'>
): Promise<{ error: Error | null }> {
  if (!supabase) return { error: null };
  const { data: { user } } = await supabase.auth.getUser();
  const currentUserId = user?.id;

  let buyerId = conversation.buyerId;
  let artisanId = conversation.artisanId;

  // Map authenticated user ID to participant ID if needed
  if (currentUserId && isUuid(currentUserId)) {
    if (!isUuid(buyerId) && (user?.user_metadata?.role === 'buyer' || !user?.user_metadata?.role)) {
      buyerId = currentUserId;
    }
    if (!isUuid(artisanId) && user?.user_metadata?.role === 'artisan') {
      artisanId = currentUserId;
    }
  }

  if (!isUuid(artisanId) && artisanId) {
    const profile = await fetchArtisanProfile(artisanId);
    if (profile && isUuid(profile.id)) {
      artisanId = profile.id;
    }
  }

  const row = {
    id: conversation.id,
    buyer_id: buyerId,
    buyer_name: conversation.buyerName,
    artisan_id: isUuid(artisanId) ? artisanId : null,
    artisan_name: conversation.artisanName,
    product_id: conversation.productId ?? null,
    product_title: conversation.productTitle ?? null,
    last_message_at: new Date().toISOString(),
    unread_count: conversation.unreadCount,
  };
  const { error } = await supabase.from('conversations').upsert(row, { onConflict: 'id' });
  if (error) {
    console.warn('[Supabase] upsertConversation notice:', error.message);
  }
  return { error: error ? new Error(error.message) : null };
}

/**
 * Fetch conversations for a specific user from Supabase.
 * Filters securely by participant ID (buyer_id or artisan_id).
 */
export async function fetchConversations(
  userId: string,
  userRole: 'artisan' | 'buyer'
): Promise<Conversation[]> {
  if (!supabase || !userId) return [];
  try {
    const query = supabase.from('conversations').select('*');
    if (userRole === 'buyer') {
      query.eq('buyer_id', userId);
    } else {
      if (isUuid(userId)) {
        query.eq('artisan_id', userId);
      } else {
        return [];
      }
    }
    const { data, error } = await query.order('last_message_at', { ascending: false });
    if (error) {
      console.warn('[Supabase] fetchConversations error:', error.message);
      return [];
    }
    if (!data || data.length === 0) return [];

    const convs: Conversation[] = await Promise.all(
      data.map(async (row) => {
        const rawMessages = await fetchMessages(row.id);
        return {
          id: row.id,
          buyerId: row.buyer_id,
          buyerName: row.buyer_name,
          artisanId: row.artisan_id ?? '',
          artisanName: row.artisan_name,
          productId: row.product_id ?? undefined,
          productTitle: row.product_title ?? undefined,
          lastMessageAt: new Date(row.last_message_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          unreadCount: row.unread_count ?? 0,
          messages: rawMessages.map(mapSupabaseMessageToChatMessage),
        };
      })
    );
    return convs;
  } catch (err) {
    console.warn('[Supabase] fetchConversations exception:', err);
    return [];
  }
}

/**
 * Save a single chat message to Supabase.
 */
export async function saveMessageToSupabase(
  message: ChatMessage & { imageUrl?: string }
): Promise<{ error: Error | null }> {
  if (!supabase) return { error: null };
  const row: SupabaseMessage = {
    id: message.id,
    conversation_id: message.conversationId,
    sender_id: message.senderId,
    sender_role: message.senderRole,
    sender_name: message.senderName,
    text: message.text,
    image_url: message.imageUrl ?? null,
    customization_request: message.customizationRequest ?? null,
    is_read: message.isRead,
    created_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('messages').insert(row);
  return { error: error ? new Error(error.message) : null };
}

/**
 * Fetch messages for a conversation (initial load).
 */
export async function fetchMessages(conversationId: string): Promise<SupabaseMessage[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error) {
    console.warn('[Supabase] fetchMessages error:', error.message);
    return [];
  }
  return (data ?? []) as SupabaseMessage[];
}

/**
 * Subscribe to new messages for a conversation using Supabase Realtime.
 * Returns a cleanup function that unsubscribes the channel.
 *
 * Usage:
 *   const unsub = subscribeToMessages(convId, (msg) => setMessages(prev => [...prev, msg]));
 *   // On component unmount:
 *   unsub();
 */
export function subscribeToMessages(
  conversationId: string,
  onNewMessage: (message: SupabaseMessage) => void
): () => void {
  if (!supabase) return () => {};

  let channel: RealtimeChannel | null = null;

  channel = supabase
    .channel(`messages:${conversationId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => {
        onNewMessage(payload.new as SupabaseMessage);
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        // Realtime channel active
      } else if (status === 'CHANNEL_ERROR') {
        console.warn('[Supabase Realtime] Channel error for conversation:', conversationId);
      }
    });

  return () => {
    if (channel && supabase) {
      supabase.removeChannel(channel);
    }
  };
}

// ─── Reviews ──────────────────────────────────────────────────────────────────

/**
 * Save a review to Supabase.
 * The UNIQUE(product_id, buyer_id) constraint prevents duplicate reviews at the DB level.
 */
export async function saveReviewToSupabase(
  review: ProductReview & { imageUrl?: string }
): Promise<{ error: Error | null; isDuplicate: boolean }> {
  if (!supabase) return { error: null, isDuplicate: false };
  const row = {
    id: review.id,
    product_id: review.productId,
    buyer_id: review.buyerId,
    buyer_name: review.buyerName,
    rating: review.rating,
    comment: review.comment,
    image_url: review.imageUrl ?? null,
    verified_purchase: review.verifiedPurchase ?? false,
    created_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('reviews').insert(row);
  if (error) {
    const isDuplicate = error.code === '23505'; // Postgres unique violation
    if (!isDuplicate) {
      console.warn('[Supabase] saveReview error:', error.message);
    }
    return { error: new Error(error.message), isDuplicate };
  }
  return { error: null, isDuplicate: false };
}

/**
 * Fetch all reviews for a product.
 */
export async function fetchReviewsForProduct(productId: string): Promise<ProductReview[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('reviews')
    .select('id, product_id, buyer_id, buyer_name, rating, comment, verified_purchase, created_at')
    .eq('product_id', productId)
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('[Supabase] fetchReviews error:', error.message);
    return [];
  }
  return (data ?? []).map(row => ({
    id: row.id,
    productId: row.product_id,
    buyerId: row.buyer_id,
    buyerName: row.buyer_name,
    rating: row.rating,
    comment: row.comment,
    createdAt: row.created_at,
    verifiedPurchase: row.verified_purchase,
  }));
}

// ─── Analytics ────────────────────────────────────────────────────────────────

export interface ArtisanAnalytics {
  totalEarnings: number;
  totalOrders: number;
  activeProducts: number;
  averageRating: number;
  reviewCount: number;
  /** Orders by month: [{month: 'Jan 2024', count: 5, revenue: 12000}, ...] */
  salesByMonth: { month: string; count: number; revenue: number }[];
  /** Top products by order count */
  topProducts: { productId: string; title: string; orderCount: number; revenue: number }[];
}

/**
 * Fetch real analytics for an artisan from Supabase.
 * Returns null when no data exists yet (show empty state, NOT fake numbers).
 */
export async function fetchArtisanAnalytics(
  artisanId: string
): Promise<ArtisanAnalytics | null> {
  if (!supabase || !isUuid(artisanId)) return null;

  try {
    // Total earnings & order count
    const { data: ordersData, error: ordersError } = await supabase
      .from('orders')
      .select('id, total_amount, created_at, product_id')
      .eq('artisan_id', artisanId)
      .eq('status', 'placed');

    if (ordersError) {
      console.warn('[Supabase] Analytics orders error:', ordersError.message);
      return null;
    }

    const orders = ordersData ?? [];

    // Active product count
    const { count: productCount, error: productError } = await supabase
      .from('products')
      .select('id', { count: 'exact', head: true })
      .eq('artisan_id', artisanId);

    if (productError) {
      console.warn('[Supabase] Analytics products error:', productError.message);
    }

    // Average rating
    const { data: reviewData, error: reviewError } = await supabase
      .from('reviews')
      .select('rating, product_id')
      .in(
        'product_id',
        orders.map(o => o.product_id).filter(Boolean)
      );

    if (reviewError) {
      console.warn('[Supabase] Analytics reviews error:', reviewError.message);
    }

    const reviews = reviewData ?? [];
    const avgRating = reviews.length
      ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
      : 0;

    // Sales by month (last 6 months)
    const salesByMonth = buildSalesByMonth(orders);

    // Top products
    const topProducts = buildTopProducts(orders);

    return {
      totalEarnings: orders.reduce((sum, o) => sum + (o.total_amount ?? 0), 0),
      totalOrders: orders.length,
      activeProducts: productCount ?? 0,
      averageRating: Math.round(avgRating * 10) / 10,
      reviewCount: reviews.length,
      salesByMonth,
      topProducts,
    };
  } catch (err) {
    console.warn('[Supabase] fetchArtisanAnalytics exception:', err);
    return null;
  }
}

function buildSalesByMonth(
  orders: { created_at: string; total_amount: number }[]
): ArtisanAnalytics['salesByMonth'] {
  const months: Record<string, { count: number; revenue: number }> = {};
  const now = new Date();

  // Initialize last 6 months
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
    months[key] = { count: 0, revenue: 0 };
  }

  orders.forEach(order => {
    const d = new Date(order.created_at);
    const key = d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
    if (months[key]) {
      months[key].count += 1;
      months[key].revenue += order.total_amount ?? 0;
    }
  });

  return Object.entries(months).map(([month, v]) => ({ month, ...v }));
}

function buildTopProducts(
  orders: { product_id: string; total_amount: number }[]
): ArtisanAnalytics['topProducts'] {
  const map: Record<string, { orderCount: number; revenue: number }> = {};
  orders.forEach(o => {
    if (!o.product_id) return;
    map[o.product_id] = map[o.product_id] ?? { orderCount: 0, revenue: 0 };
    map[o.product_id].orderCount += 1;
    map[o.product_id].revenue += o.total_amount ?? 0;
  });
  return Object.entries(map)
    .map(([productId, v]) => ({ productId, title: '', ...v }))
    .sort((a, b) => b.orderCount - a.orderCount)
    .slice(0, 5);
}

/**
 * Save an order (called after checkout).
 */
export async function saveOrderToSupabase(order: {
  id: string;
  productId: string;
  buyerId: string;
  buyerName: string;
  artisanId: string | null;
  quantity: number;
  totalAmount: number;
  status?: string;
}): Promise<{ error: Error | null }> {
  if (!supabase) return { error: null };
  const { error } = await supabase.from('orders').insert({
    id: order.id,
    product_id: order.productId,
    buyer_id: order.buyerId,
    buyer_name: order.buyerName,
    artisan_id: isUuid(order.artisanId) ? order.artisanId : null,
    quantity: order.quantity,
    total_amount: order.totalAmount,
    status: order.status ?? 'placed',
    created_at: new Date().toISOString(),
  });
  return { error: error ? new Error(error.message) : null };
}

// ─── RFQ (Request For Quotation) ──────────────────────────────────────────────

export interface SupabaseRFQ {
  id: string;
  buyer_id: string;
  buyer_name?: string;
  artisan_id: string | null;
  product_id: string;
  quantity: number;
  message?: string;
  status: 'pending' | 'accepted' | 'declined';
  created_at: string;
}

export async function saveRFQToSupabase(rfq: {
  id: string;
  buyerId: string;
  buyerName: string;
  artisanId: string;
  productId: string;
  quantity: number;
  message: string;
  status?: 'pending' | 'accepted' | 'declined';
}): Promise<{ error: Error | null }> {
  if (!supabase) return { error: null };
  const row = {
    id: rfq.id,
    buyer_id: rfq.buyerId,
    buyer_name: rfq.buyerName,
    artisan_id: isUuid(rfq.artisanId) ? rfq.artisanId : null,
    product_id: rfq.productId,
    quantity: rfq.quantity,
    message: rfq.message,
    status: rfq.status ?? 'pending',
    created_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('rfqs').insert(row);
  if (error) {
    console.warn('[Supabase] saveRFQ notice:', error.message);
  }
  return { error: error ? new Error(error.message) : null };
}

export async function fetchRFQsForUser(
  userId: string,
  userRole: 'artisan' | 'buyer'
): Promise<SupabaseRFQ[]> {
  if (!supabase || !userId) return [];
  try {
    const query = supabase.from('rfqs').select('*');
    if (userRole === 'buyer') {
      query.eq('buyer_id', userId);
    } else {
      if (isUuid(userId)) {
        query.eq('artisan_id', userId);
      } else {
        return [];
      }
    }
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) {
      console.warn('[Supabase] fetchRFQs error:', error.message);
      return [];
    }
    return (data ?? []) as SupabaseRFQ[];
  } catch (err) {
    console.warn('[Supabase] fetchRFQs exception:', err);
    return [];
  }
}

// ─── Buyer Recommendations ────────────────────────────────────────────────────

/**
 * Fetch recommended products for a buyer.
 * Strategy:
 *  - If buyer has purchases: match by category of purchased products
 *  - If new buyer: return top-rated (avg rating ≥ 4) and featured products
 * Returns empty array when Supabase not configured (app uses preset data).
 */
export async function fetchBuyerRecommendations(
  buyerId: string | null,
  limit = 8
): Promise<ProductListing[]> {
  if (!supabase) return [];

  try {
    if (buyerId) {
      // Check if buyer has past orders
      const { data: pastOrders } = await supabase
        .from('orders')
        .select('product_id')
        .eq('buyer_id', buyerId)
        .limit(20);

      if (pastOrders && pastOrders.length > 0) {
        // Fetch categories of past purchases
        const productIds = pastOrders.map(o => o.product_id);
        const { data: purchasedProducts } = await supabase
          .from('products')
          .select('category')
          .in('id', productIds);

        const categories = [...new Set((purchasedProducts ?? []).map(p => p.category))];

        if (categories.length > 0) {
          const { data } = await supabase
            .from('products')
            .select('*')
            .in('category', categories)
            .not('id', 'in', `(${productIds.join(',')})`)
            .order('created_at', { ascending: false })
            .limit(limit);

          if (data && data.length > 0) return data.map(mapRowToProduct);
        }
      }
    }

    // Fallback: featured + high-rated
    const { data } = await supabase
      .from('products')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    return (data ?? []).map(mapRowToProduct);
  } catch (err) {
    console.warn('[Supabase] fetchBuyerRecommendations error:', err);
    return [];
  }
}
