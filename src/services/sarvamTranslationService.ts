import { Language } from '../types';

/**
 * SHILP-AI Sarvam AI Frontend Translation Client (Supabase Edge Function)
 *
 * Connects the frontend translation system to the secure Supabase Edge Function
 * located at `${VITE_SUPABASE_URL}/functions/v1/translate`.
 *
 * Security:
 * - SARVAM_API_KEY is NEVER exposed to or stored in frontend code.
 * - All translation requests are forwarded to the Supabase Edge Function, which
 *   retrieves the key from Supabase Secrets.
 *
 * Features:
 * - Supports all 21 Shilp-AI language IDs.
 * - Splits long text into chunks within Sarvam's 2,000-character limit and joins them.
 * - Graceful fallback to original English text on network or server error.
 */

export interface SupabaseTranslateRequestBody {
  input: string;
  source_language_code: string;
  target_language_code: string;
}

export interface SupabaseTranslateSuccessResponse {
  translated_text: string;
  source_language_code?: string;
  target_language_code?: string;
  request_id?: string;
  error?: string;
}

// Backwards-compatible interface definitions for existing callers
export interface FirebaseTranslateRequestBody {
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
}

export interface FirebaseTranslateSuccessResponse {
  success: boolean;
  text: string;
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
  sourceLanguageCode?: string;
  targetLanguageCode?: string;
  requestId?: string;
}

/**
 * Read VITE_SUPABASE_URL and return the Supabase Edge Function translation endpoint.
 */
export function getSupabaseTranslateUrl(): string {
  const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL;
  if (supabaseUrl && typeof supabaseUrl === 'string' && supabaseUrl.trim().length > 0) {
    return `${supabaseUrl.trim().replace(/\/+$/, '')}/functions/v1/translate`;
  }
  return 'http://127.0.0.1:54321/functions/v1/translate';
}

/**
 * Backwards compatible alias for getSupabaseTranslateUrl
 */
export const getFirebaseTranslateUrl = getSupabaseTranslateUrl;

/**
 * Read VITE_SUPABASE_ANON_KEY from environment variables.
 */
export function getSupabaseAnonKey(): string {
  return (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || '';
}

/**
 * Intelligent text splitter that splits long text into chunks of at most maxChunkSize characters,
 * respecting paragraph breaks (\n\n), line breaks (\n), sentence endings, or word boundaries.
 * Enforces Sarvam's 2,000-character limit.
 */
export function splitTextIntoChunks(text: string, maxChunkSize = 1800): string[] {
  if (!text || text.length <= maxChunkSize) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text.trim();

  while (remaining.length > 0) {
    if (remaining.length <= maxChunkSize) {
      chunks.push(remaining);
      break;
    }

    let splitIndex = -1;

    // 1. Paragraph boundary
    const paragraphBreak = remaining.lastIndexOf('\n\n', maxChunkSize);
    if (paragraphBreak > maxChunkSize * 0.4) {
      splitIndex = paragraphBreak + 2;
    } else {
      // 2. Single line boundary
      const lineBreak = remaining.lastIndexOf('\n', maxChunkSize);
      if (lineBreak > maxChunkSize * 0.4) {
        splitIndex = lineBreak + 1;
      } else {
        // 3. Sentence boundary (. ! ? ।)
        const sentenceMatch = remaining.slice(0, maxChunkSize).match(/.*[.!?।]\s+/s);
        if (sentenceMatch && sentenceMatch[0].length > maxChunkSize * 0.3) {
          splitIndex = sentenceMatch[0].length;
        } else {
          // 4. Word boundary (space)
          const spaceBreak = remaining.lastIndexOf(' ', maxChunkSize);
          if (spaceBreak > maxChunkSize * 0.3) {
            splitIndex = spaceBreak + 1;
          } else {
            // Hard cut if no delimiters exist
            splitIndex = maxChunkSize;
          }
        }
      }
    }

    const chunk = remaining.slice(0, splitIndex).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
    remaining = remaining.slice(splitIndex).trim();
  }

  return chunks.length > 0 ? chunks : [text];
}

export function toSarvamLanguageCode(lang: string): string {
  if (!lang) return 'hi-IN';
  const l = lang.trim().toLowerCase();
  const map: Record<string, string> = {
    en: 'en-IN',
    hi: 'hi-IN',
    te: 'te-IN',
    ta: 'ta-IN',
    bn: 'bn-IN',
    mr: 'mr-IN',
    gu: 'gu-IN',
    kn: 'kn-IN',
    ml: 'ml-IN',
    pa: 'pa-IN',
    or: 'od-IN',
    as: 'as-IN',
    ur: 'ur-IN',
    sa: 'sa-IN',
    mai: 'mai-IN',
    kok: 'kok-IN',
    ne: 'ne-IN',
    sd: 'sd-IN',
    doi: 'doi-IN',
    brx: 'brx-IN',
    sat: 'sat-IN',
  };
  return map[l] || (l.includes('-') ? l : `${l}-IN`);
}

/**
 * Call the Supabase Edge Function to translate a single chunk of text with retries on 503/429/502 errors.
 */
async function callSupabaseTranslateFunction(
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
  maxRetries = 3
): Promise<string> {
  const url = getSupabaseTranslateUrl();
  const anonKey = getSupabaseAnonKey();

  const payload: SupabaseTranslateRequestBody = {
    input: text,
    source_language_code: toSarvamLanguageCode(sourceLanguage),
    target_language_code: toSarvamLanguageCode(targetLanguage)
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };

  if (anonKey) {
    headers['apikey'] = anonKey;
    headers['Authorization'] = `Bearer ${anonKey}`;
  }

  let attempt = 0;
  let lastError: Error | null = null;

  while (attempt < maxRetries) {
    attempt++;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 18000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorJson = await response.json().catch(() => null);
        const errMsg = errorJson?.error || errorJson?.message || `HTTP ${response.status}`;
        
        if (response.status === 429 || response.status === 502 || response.status === 503) {
          lastError = new Error(`Supabase translate function error: ${errMsg}`);
          if (attempt < maxRetries) {
            const delay = Math.pow(2, attempt - 1) * 1000;
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }
        }
        throw new Error(`Supabase translate function error: ${errMsg}`);
      }

      const result = (await response.json()) as SupabaseTranslateSuccessResponse;

      if (result && typeof result.translated_text === 'string') {
        return result.translated_text;
      }

      if (result && result.error) {
        throw new Error(`Supabase translate function error: ${result.error}`);
      }

      throw new Error('Missing translated_text in response from Supabase function.');
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      const isHttpError = err instanceof Error && err.message.startsWith('Supabase translate function error:');
      if (isHttpError) {
        throw err;
      }

      const isAbort = err instanceof Error && err.name === 'AbortError';
      lastError = isAbort ? new Error('Supabase translate function request timed out.') : (err instanceof Error ? err : new Error(String(err)));
      
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt - 1) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error('Translation failed after retries.');
}

/**
 * Translate arbitrary text to the target language via the Supabase Edge Function.
 * Automatically chunks text if it exceeds 1,800 characters to comply with Sarvam's limit.
 */
export async function translateWithSarvam(
  text: string,
  targetLang: Language,
  sourceLang: string = 'en'
): Promise<string> {
  if (!text || !text.trim() || targetLang === 'en' || (sourceLang !== 'auto' && sourceLang === targetLang)) {
    return text;
  }

  const trimmed = text.trim();

  // If text is within Sarvam's limit, translate directly
  if (trimmed.length <= 1800) {
    try {
      return await callSupabaseTranslateFunction(trimmed, sourceLang, targetLang);
    } catch (err) {
      console.warn(`Sarvam translation failed for "${trimmed.slice(0, 30)}...":`, err);
      return text; // Graceful English fallback
    }
  }

  // Text exceeds limit: split into chunks and translate each
  const chunks = splitTextIntoChunks(trimmed, 1800);
  const translatedChunks: string[] = [];

  for (const chunk of chunks) {
    try {
      const translatedChunk = await callSupabaseTranslateFunction(chunk, sourceLang, targetLang);
      translatedChunks.push(translatedChunk);
    } catch (err) {
      console.warn(`Sarvam chunk translation failed for "${chunk.slice(0, 30)}...":`, err);
      translatedChunks.push(chunk); // Graceful English fallback for this chunk
    }
  }

  // Preserve paragraph spacing if present
  const separator = text.includes('\n\n') ? '\n\n' : text.includes('\n') ? '\n' : ' ';
  return translatedChunks.join(separator);
}

/**
 * Translate a batch of phrases concurrently with controlled concurrency.
 * Returns a map of { [originalEnglish]: translatedText }.
 */
export async function translateBatchWithSarvam(
  phrases: string[],
  targetLang: Language,
  sourceLang: string = 'en'
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  if (!phrases || !phrases.length || targetLang === 'en') {
    for (const p of phrases) result[p] = p;
    return result;
  }

  // Concurrency limit of 2 parallel requests to prevent network throttling
  const CONCURRENCY = 2;
  for (let i = 0; i < phrases.length; i += CONCURRENCY) {
    const slice = phrases.slice(i, i + CONCURRENCY);
    const promises = slice.map(async (phrase) => {
      try {
        const translated = await translateWithSarvam(phrase, targetLang, sourceLang);
        return { phrase, translated };
      } catch {
        return { phrase, translated: phrase };
      }
    });

    const settled = await Promise.all(promises);
    for (const item of settled) {
      result[item.phrase] = item.translated;
    }
  }

  return result;
}
