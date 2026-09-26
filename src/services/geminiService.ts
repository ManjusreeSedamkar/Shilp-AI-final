import { Language, CraftCategory } from '../types';
import { getSpeechLangCode } from './translations';
import { supabase } from './supabase';

/**
 * SHILP-AI Gemini API Service
 * 
 * Uses Google Gemini API for the Copilot chatbot and bio generation.
 * API key is read from environment variable VITE_GEMINI_API_KEY.
 * Automatically falls back to Supabase Edge Function (OpenRouter) if Gemini returns 503/429.
 */

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent';
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Get API key from environment variable (Vite) or localStorage
export function getGeminiApiKey(): string {
  const envKey = (import.meta as any).env?.VITE_GEMINI_API_KEY || '';
  if (envKey && envKey.startsWith('AIzaSy')) return envKey;
  
  const localKey = localStorage.getItem('gemini_api_key') || '';
  if (localKey && localKey.startsWith('AIzaSy')) return localKey;

  return '';
}

export function hasGeminiApiKey(): boolean {
  return getGeminiApiKey().length > 0 || Boolean(supabase);
}

export function getOpenRouterApiKey(): string {
  const envKey = (import.meta as any).env?.VITE_OPENROUTER_API_KEY || '';
  if (envKey) return envKey;
  
  return localStorage.getItem('openrouter_api_key') || '';
}

export function hasOpenRouterApiKey(): boolean {
  return getOpenRouterApiKey().length > 0;
}

export function deduplicateKeywords(keywords?: string[]): string[] {
  if (!keywords || !Array.isArray(keywords)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const kw of keywords) {
    if (!kw || typeof kw !== 'string') continue;
    const trimmed = kw.trim();
    const lower = trimmed.toLowerCase();
    if (trimmed && !seen.has(lower)) {
      seen.add(lower);
      result.push(trimmed);
    }
  }
  return result;
}

interface GeminiRequest {
  contents: {
    parts: { text: string }[];
  }[];
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
    topP?: number;
  };
}

interface GeminiResponse {
  candidates?: {
    content?: {
      parts?: { text?: string }[];
    };
  }[];
  error?: {
    message?: string;
  };
}

/**
 * Send a prompt to Gemini and get a response.
 * Falls back to OpenRouter Edge Function if direct Gemini returns 503/429/error.
 */
export async function askGemini(
  prompt: string,
  language: Language = 'en',
  systemContext?: string
): Promise<string> {
  const langName = getLanguageNameForPrompt(language);
  const systemPrompt = systemContext || 
    `You are SHILP-AI Copilot, a helpful assistant for Indian artisans and buyers on the MoSJE (Ministry of Social Justice and Empowerment) handicraft marketplace. ` +
    `You help with: app usage, Smart Catalog, publishing products, explaining features, translating content, pricing advice, government schemes (PM Vishwakarma, Shilp Samagam), GST rules, packaging, and business growth. ` +
    `IMPORTANT: Always respond in ${langName} language. Keep responses clear, simple, and friendly for low-literacy users. Use emojis where helpful.`;

  const fullPrompt = `${systemPrompt}\n\nUser question: ${prompt}`;

  // 1. Primary secure path: Supabase Edge Function (ai-services) using OPENROUTER_API_KEY secret
  if (supabase) {
    try {
      const { data, error: edgeErr } = await supabase.functions.invoke('ai-services', {
        body: { task: 'shilpsaathi', prompt: fullPrompt, language },
      });
      if (!edgeErr && data?.result) {
        return data.result.trim();
      }
      if (edgeErr) console.warn('ai-services Edge Function notice:', edgeErr.message);
    } catch (fallbackErr) {
      console.warn('ai-services Edge Function fallback exception:', fallbackErr);
    }
  }

  // 2. Secondary fallback path: Direct Gemini API key (if provided)
  const apiKey = getGeminiApiKey();
  if (apiKey) {
    const requestBody: GeminiRequest = {
      contents: [
        {
          parts: [{ text: fullPrompt }]
        }
      ],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1024,
        topP: 0.9
      }
    };

    try {
      const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (response.ok) {
        const data: GeminiResponse = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) return text.trim();
      } else {
        const errorData = await response.json().catch(() => null);
        console.warn(`Direct Gemini API returned status ${response.status}:`, errorData?.error?.message);
      }
    } catch (error) {
      console.warn('Direct Gemini API fetch error:', error);
    }
  }

  throw new Error('Gemini & OpenRouter services are currently unavailable. You can enter your bio manually.');
}

/**
 * Get language name for prompt
 */
function getLanguageNameForPrompt(lang: Language): string {
  const names: Partial<Record<Language, string>> = {
    en: 'English',
    hi: 'Hindi (हिन्दी)',
    te: 'Telugu (తెలుగు)',
    ta: 'Tamil (தமிழ்)',
    bn: 'Bengali (বাংলা)',
    mr: 'Marathi (मराठी)',
    gu: 'Gujarati (ગુજરાતી)',
  };
  return names[lang] || 'English';
}

/**
 * Translate text to the selected language using Gemini
 */
export async function translateWithGemini(text: string, targetLang: Language): Promise<string> {
  const langName = getLanguageNameForPrompt(targetLang);
  const prompt = `Translate the following text to ${langName}. Only return the translated text, nothing else:\n\n${text}`;
  return askGemini(prompt, targetLang);
}

export interface CulturallyGroundedDescriptionResponse {
  titleEn?: string;
  titleHi?: string;
  descriptionEn: string;
  descriptionHi: string;
  culturalContext?: string;
  seoKeywords?: string[];
  searchTags?: string[];
  metaDescription?: string;
}

/**
 * Helper to convert a Data URL or HTTP/relative image URL into base64 object for Gemini inlineData
 */
export async function urlOrDataUrlToBase64(imageUrl: string): Promise<{ mimeType: string; data: string } | null> {
  if (!imageUrl) return null;
  
  try {
    // Already a base64 Data URL (e.g. data:image/jpeg;base64,/9j/4AAQSk...)
    if (imageUrl.startsWith('data:image/')) {
      const match = imageUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
      if (match) {
        if ((import.meta as any).env?.DEV) {
          console.log('[Shilp-AI] Vision image conversion:', { type: 'Data URL', mimeType: match[1] });
        }
        return {
          mimeType: match[1],
          data: match[2]
        };
      }
    }

    // Resolve relative or HTTP URL against window.location.origin
    let fetchUrl = imageUrl;
    const isHttp = imageUrl.startsWith('http://') || imageUrl.startsWith('https://');
    if (!isHttp && !imageUrl.startsWith('data:')) {
      const origin = typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'http://localhost:3000';
      fetchUrl = new URL(imageUrl, origin).toString();
    }

    if ((import.meta as any).env?.DEV) {
      console.log('[Shilp-AI] Vision image conversion:', {
        type: isHttp ? 'Absolute HTTP URL' : 'Relative URL resolved against origin',
        resolvedUrl: fetchUrl
      });
    }

    const response = await fetch(fetchUrl);
    if (!response.ok) {
      console.warn('[Shilp-AI] Vision image fetch failed:', response.status, fetchUrl);
      return null;
    }
    const blob = await response.blob();
    
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const resultStr = reader.result as string;
        const match = resultStr.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
        if (match) {
          resolve({
            mimeType: match[1],
            data: match[2]
          });
        } else {
          resolve(null);
        }
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    console.warn('[Shilp-AI] Failed to convert image for vision input:', err);
    return null;
  }
}

/**
 * Internal: Gemini fetch with exponential backoff retry for transient errors (503, 429)
 * Retries up to maxAttempts times; delays are 1s, 2s, 4s with ±200ms jitter.
 */
async function geminiRetryFetch(
  url: string,
  body: object,
  maxAttempts: number = 3
): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      // Retry on 503 (Service Unavailable) and 429 (Rate Limit)
      if ((resp.status === 503 || resp.status === 429) && attempt < maxAttempts) {
        const delay = (Math.pow(2, attempt - 1) * 1000) + (Math.random() * 400 - 200);
        console.warn(`[Shilp-AI] Gemini ${resp.status} on attempt ${attempt}/${maxAttempts}. Retrying in ${Math.round(delay)}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      return resp;
    } catch (networkErr) {
      lastError = networkErr as Error;
      if (attempt < maxAttempts) {
        const delay = (Math.pow(2, attempt - 1) * 1000) + (Math.random() * 400 - 200);
        console.warn(`[Shilp-AI] Gemini network error on attempt ${attempt}/${maxAttempts}. Retrying in ${Math.round(delay)}ms...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError || new Error('Gemini request failed after all retry attempts');
}

/**
 * Send a multimodal prompt (text + optional image) to Gemini REST API
 */
export async function askGeminiMultimodal(
  prompt: string,
  imageData?: { mimeType: string; data: string } | null
): Promise<string> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error('Gemini API key not configured.');
  }

  const parts: any[] = [];
  if (imageData && imageData.data) {
    parts.push({
      inlineData: {
        mimeType: imageData.mimeType || 'image/jpeg',
        data: imageData.data
      }
    });
  }
  parts.push({ text: prompt });

  const requestBody = {
    contents: [{ parts }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 1024,
      topP: 0.9
    }
  };

  const response = await geminiRetryFetch(`${GEMINI_API_URL}?key=${apiKey}`, requestBody);

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(errorData?.error?.message || `Gemini API error: ${response.status}`);
  }

  const data: GeminiResponse = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('No response from Gemini API');
  }
  return text.trim();
}

export interface VisualAnalysisResult {
  visualObjectType: string;
  craftCategorySuggestion: CraftCategory;
  apparentMaterial: string;
  visibleColors: string;
  visiblePatternsMotifs: string;
  visibleBorderColor?: string;  // supplement if not stated by artisan
  confidence: 'high' | 'medium' | 'low';
  keywords: string[];
}

/**
 * Generate artisan bio using Gemini API or Supabase Edge Function fallback (task: "artisan_bio")
 */
export async function generateArtisanBio(
  name: string,
  state: string,
  craftCluster: string,
  language: Language = 'en'
): Promise<string> {
  const prompt =
    `Write a short, warm 2-sentence artisan bio (max 60 words) for an Indian craftsperson named "${name || 'the artisan'}" ` +
    `from ${state || 'India'}, specialising in "${craftCluster || 'traditional handloom & craft'}". ` +
    `Write in first person. Highlight authentic craftsmanship, heritage preservation, and dedication to quality. Keep it suitable for a government handicraft marketplace profile.`;

  const apiKey = getGeminiApiKey();
  if (apiKey) {
    try {
      const bio = await askGeminiMultimodal(prompt);
      if (bio) return bio.trim();
    } catch (e) {
      console.warn('Direct Gemini API bio generation notice:', e);
    }
  }

  if (supabase) {
    try {
      const { data, error: edgeErr } = await supabase.functions.invoke('ai-services', {
        body: {
          task: 'artisan_bio',
          prompt,
          language,
          data: { name, state, craftCluster },
        },
      });
      if (!edgeErr && data?.result) {
        return data.result.trim();
      }
      if (edgeErr) console.warn('ai-services Edge Function bio notice:', edgeErr.message);
    } catch (fallbackErr) {
      console.warn('ai-services Edge Function bio fallback exception:', fallbackErr);
    }
  }

  throw new Error('Bio generation service is currently unavailable. You can enter your bio manually.');
}

export function createFallbackVisualAnalysis(): VisualAnalysisResult {
  return {
    visualObjectType: 'Handicraft Product',
    craftCategorySuggestion: 'Other Heritage Craft',
    apparentMaterial: 'Authentic Artisan Material',
    visibleColors: 'Natural Finish',
    visiblePatternsMotifs: 'Traditional Motifs',
    visibleBorderColor: undefined,
    confidence: 'low',
    keywords: ['Handmade in India', 'Heritage Craft']
  };
}

/**
 * Perform visual product understanding using Gemini Vision, with Supabase Edge Function fallback
 */
export async function analyzeImageVisuals(
  imageInput: string
): Promise<VisualAnalysisResult | null> {
  if (!imageInput) return null;

  if ((import.meta as any).env?.DEV) {
    console.log('[Shilp-AI] Vision input:', {
      hasImageInput: Boolean(imageInput),
      inputLength: imageInput.length,
      isDataUrl: imageInput.startsWith('data:')
    });
  }

  const imageData = await urlOrDataUrlToBase64(imageInput);

  const prompt = `Analyze this Indian handicraft product image and identify its visual attributes.

Respond ONLY with a valid raw JSON object (no markdown, no backticks):
{
  "visualObjectType": "Specific product type (e.g. Nandi metal sculpture, Pochampally saree, Terracotta urn, Madhubani painting, Wooden carving, Kashmiri shawl)",
  "craftCategorySuggestion": "One of: Textiles & Handloom, Clay & Terracotta, Metalcraft & Dhokra, Traditional Painting, Woodcraft & Carving, Leather & Footwear, Handmade Jewelry, Other Heritage Craft",
  "apparentMaterial": "Apparent surface material (e.g. brass/bell metal, clay, silk, pashmina wool, paper/canvas, teakwood)",
  "visibleColors": "Dominant visible colors (e.g. cream, antique golden bronze, crimson red and mustard, terracotta red)",
  "visiblePatternsMotifs": "Visible patterns and motifs (e.g. tribal lost-wax ornamentations, geometric ikat grid, pink and gold floral motifs)",
  "visibleBorderColor": "Visible border/edge colors if present, otherwise null (e.g. pink and gold, maroon gold, null)",
  "confidence": "high or medium or low",
  "keywords": ["keyword1", "keyword2", "keyword3"]
}`;

  // 1. Primary secure path: Supabase Edge Function (ai-services)
  if (supabase) {
    try {
      const formattedImage = imageData ? `data:${imageData.mimeType};base64,${imageData.data}` : imageInput;
      const edgePromise = supabase.functions.invoke('ai-services', {
        body: { task: 'analyze_image', prompt, imageInput: formattedImage }
      });
      const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Edge function timeout')), 4000));
      const { data, error: edgeErr } = await Promise.race([edgePromise, timeoutPromise]) as any;

      if ((import.meta as any).env?.DEV) {
        console.log('[Shilp-AI] Vision Edge Function response:', {
          hasData: Boolean(data),
          hasResult: Boolean(data?.result),
          success: data?.success,
          error: edgeErr?.message || data?.error
        });
      }

      if (!edgeErr && data?.result) {
        const cleaned = data.result.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
        const parsed = JSON.parse(cleaned);
        if (parsed && parsed.visualObjectType) {
          const result = parseVisualAnalysisResult(parsed);
          if ((import.meta as any).env?.DEV) {
            console.log('[Shilp-AI] Vision parsed result:', {
              visualObjectType: result.visualObjectType,
              confidence: result.confidence,
              category: result.craftCategorySuggestion
            });
          }
          return result;
        }
      }
    } catch (edgeErr) {
      console.warn('[Shilp-AI] ai-services Edge Function analyze_image notice:', edgeErr);
    }
  }

  // 2. Secondary path: Direct Gemini API key
  if (getGeminiApiKey() && imageData) {
    try {
      const rawResult = await askGeminiMultimodal(prompt, imageData);
      const cleaned = rawResult.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(cleaned);

      if (parsed && parsed.visualObjectType) {
        const result = parseVisualAnalysisResult(parsed);
        if ((import.meta as any).env?.DEV) {
          console.log('[Shilp-AI] Vision parsed result:', {
            visualObjectType: result.visualObjectType,
            confidence: result.confidence,
            category: result.craftCategorySuggestion
          });
        }
        return result;
      }
    } catch (err) {
      console.warn('[Shilp-AI] Gemini direct vision analysis notice:', err);
    }
  }

  // 3. Safe low-confidence fallback (never return null when imageInput exists)
  if ((import.meta as any).env?.DEV) {
    console.log('[Shilp-AI] Vision fallback used:', {
      reason: 'AI vision response unparseable or services unavailable'
    });
  }

  return createFallbackVisualAnalysis();
}

function parseVisualAnalysisResult(parsed: any): VisualAnalysisResult {
  const validCategories: CraftCategory[] = [
    'Textiles & Handloom',
    'Clay & Terracotta',
    'Metalcraft & Dhokra',
    'Traditional Painting',
    'Woodcraft & Carving',
    'Leather & Footwear',
    'Handmade Jewelry',
    'Other Heritage Craft'
  ];
  const category: CraftCategory = validCategories.includes(parsed.craftCategorySuggestion)
    ? parsed.craftCategorySuggestion
    : 'Other Heritage Craft';

  const rawKeywords = Array.isArray(parsed.keywords) ? parsed.keywords : [];

  return {
    visualObjectType: parsed.visualObjectType || 'Handicraft Product',
    craftCategorySuggestion: category,
    apparentMaterial: parsed.apparentMaterial || 'Authentic Artisan Material',
    visibleColors: parsed.visibleColors || 'Natural Finish',
    visiblePatternsMotifs: parsed.visiblePatternsMotifs || 'Traditional Motifs',
    visibleBorderColor: (parsed.visibleBorderColor && parsed.visibleBorderColor !== 'null') ? parsed.visibleBorderColor : undefined,
    confidence: ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'medium',
    keywords: deduplicateKeywords(rawKeywords)
  };
}

/**
 * Send a prompt to OpenRouter REST API (fallback for description generation)
 */
export async function askOpenRouter(prompt: string): Promise<string> {
  const apiKey = getOpenRouterApiKey();
  if (!apiKey) {
    throw new Error('OpenRouter API key not configured.');
  }

  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'openrouter/free',
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(errorData?.error?.message || `OpenRouter API error: ${response.status}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error('No response content from OpenRouter API');
  }
  return text.trim();
}

/**
 * Generate culturally grounded product descriptions using Gemini multimodal (Image + Voice + DIWALI context),
 * with OpenRouter fallback if Gemini fails after retries.
 */
export async function generateCulturalDescription(
  attributes: {
    category: string;
    craftTechnique: string;
    primaryMaterial: string;
    productionDays: number;
    rawMaterialCost: number;
    color: string;
    titleEn: string;
    titleHi: string;
    // Rich artisan-provided attributes
    productType?: string | null;
    style?: string | null;
    subject?: string | null;
    weavingMethod?: string | null;
    constructionMethod?: string | null;
    pattern?: string | null;
    motif?: string | null;
    borderColor?: string | null;
    dyeType?: string | null;
    zariType?: string | null;
    fabricType?: string | null;
    artisanClaims?: string[];
  },
  diwaliContext: string,
  imageInput?: string
): Promise<CulturallyGroundedDescriptionResponse | null> {
  let imageData = null;
  if (imageInput) {
    try {
      imageData = await Promise.race([
        urlOrDataUrlToBase64(imageInput),
        new Promise<null>(r => setTimeout(() => r(null), 2000))
      ]);
    } catch {
      imageData = null;
    }
  }

  const GENERIC_PLACEHOLDERS = [
    'Traditional Handcrafted Artistry',
    'Authentic Artisan Material',
    'Natural Finish',
    'Handcrafted Heritage Artisan Product',
    'हस्तनिर्मित कारीगर धरोहर उत्पाद',
    'Other Heritage Craft',
    'Generating catalog description…',
    'कैटलॉग विवरण तैयार किया जा रहा है…',
  ];
  const isGeneric = (val: string | null | undefined) => !val || GENERIC_PLACEHOLDERS.includes(val.trim());

  // Build artisan facts, marking generic values for image inference
  const artisanFacts: string[] = [
    `- Product Type: ${attributes.productType || 'Infer from image'}`,
    `- Style: ${attributes.style || 'Infer from image or cultural context'}`,
    `- Category: ${attributes.category}`,
    `- Craft Technique: ${isGeneric(attributes.craftTechnique) ? 'Not stated — infer from image' : attributes.craftTechnique}`,
    `- Primary Material: ${isGeneric(attributes.primaryMaterial) ? 'Not stated — infer from image' : attributes.primaryMaterial}`,
    attributes.fabricType ? `- Fabric / Fiber Type: ${attributes.fabricType} (explicitly stated by artisan)` : '',
    attributes.weavingMethod ? `- Weaving Method: ${attributes.weavingMethod} (explicitly stated by artisan)` : '',
    attributes.constructionMethod ? `- Construction Method: ${attributes.constructionMethod} (explicitly stated by artisan)` : '',
    `- Primary Color: ${isGeneric(attributes.color) ? 'Not stated — describe visually from image' : `${attributes.color} (explicitly stated by artisan)`}`,
    attributes.pattern ? `- Pattern: ${attributes.pattern} (explicitly stated by artisan)` : '',
    attributes.motif ? `- Motif / Design: ${attributes.motif} (explicitly stated by artisan)` : '',
    attributes.borderColor ? `- Border Color: ${attributes.borderColor} (explicitly stated by artisan)` : '',
    attributes.dyeType ? `- Dye Type: ${attributes.dyeType} (explicitly stated by artisan)` : '',
    attributes.zariType ? `- Zari Type: ${attributes.zariType} (explicitly stated by artisan)` : '',
    attributes.productionDays > 0
      ? `- Production Time: ${attributes.productionDays} days (explicitly stated)`
      : `- Production Time: Not stated — do NOT invent or guess a number`,
    attributes.artisanClaims && attributes.artisanClaims.length > 0
      ? `- Artisan Claims: ${attributes.artisanClaims.join(', ')} (explicitly stated)` : '',
    `- Base Title: ${isGeneric(attributes.titleEn) ? 'Not specified — generate from image and context' : attributes.titleEn}`,
  ].filter(Boolean);

  const prompt = `You are an expert cultural handicraft cataloger and visual product analyst for the MoSJE Shilp-AI platform.
Analyze the attached product image alongside artisan-provided facts and cultural heritage context.

SOURCE PRIORITY:
1. ARTISAN-PROVIDED FACTS (trust these absolutely — they override visual inference):
${artisanFacts.join('\n')}

2. VISUAL OBSERVATIONS from image (use to supplement any fact marked "Not stated" or "Infer from image"):
   - Observe colors, pattern layout, motifs, shape, border details, surface texture, material.
   - Where the artisan has stated an attribute (e.g., color = Cream), use that value even if image looks different.
   - Only use image evidence for attributes NOT stated by the artisan.
   - Phrase visual findings carefully: "The piece appears to be…"

3. CULTURAL HERITAGE CONTEXT (use for cultural background and historical significance ONLY — never to classify product or invent attributes):
${diwaliContext}

STRICT RULES — VIOLATIONS WILL DISQUALIFY THE RESPONSE:
- NEVER use any of these phrases: "certified artisan", "fair-wage certified", "eco-conscious", "ethically made", "100% Authentic indigenous method", "master heritage skill", "MoSJE certified", "GI certified", "GI tagged"
- NEVER invent production days, price, stock quantity, or exact geographical origins
- NEVER auto-insert region/state names unless explicitly stated by artisan or present in CULTURAL HERITAGE CONTEXT above
- Descriptions must be specific to this product, not a generic template
- The English title must reflect the actual product (e.g. "Kashmiri Handwoven Pashmina Shawl" — not "Heritage Artisan Product")

Respond ONLY with a valid raw JSON object (no markdown, no backticks):
{
  "titleEn": "Specific, descriptive English title built from artisan facts + image (e.g. Kashmiri Handwoven Pashmina Shawl with Pink & Gold Floral Design)",
  "titleHi": "उत्पाद-विशिष्ट हिंदी शीर्षक",
  "descriptionEn": "2-3 sentences: what is visually observed + artisan-stated facts + relevant cultural heritage. No unsupported claims. Example: This cream-colored handwoven shawl combines the softness of Pashmina with delicate pink and gold floral detailing and a matching decorative border. Pashmina textiles are closely associated with the rich weaving traditions of Kashmir, known for their fine texture and warmth.",
  "descriptionHi": "2-3 वाक्य: दृश्य अवलोकन + कारीगर के बताए तथ्य + सांस्कृतिक संदर्भ। कोई असत्यापित दावा नहीं।",
  "culturalContext": "Verified heritage background and craft traditions from the knowledge base. Do not invent.",
  "seoKeywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "searchTags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "metaDescription": "SEO-friendly summary under 160 characters for buyer discovery."
}`;

  // 1. Primary provider: Supabase Edge Function (ai-services) using OPENROUTER_API_KEY secret
  if (supabase) {
    try {
      const formattedImage = imageData ? `data:${imageData.mimeType};base64,${imageData.data}` : imageInput;
      const edgePromise = supabase.functions.invoke('ai-services', {
        body: { task: 'product_description', prompt, data: attributes, imageInput: formattedImage },
      });
      const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Edge function timeout')), 2500));
      const { data, error: edgeErr } = await Promise.race([edgePromise, timeoutPromise]) as any;

      if (!edgeErr && data?.result) {
        const cleanedJsonStr = data.result.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
        const parsed = JSON.parse(cleanedJsonStr);
        if (parsed && (parsed.descriptionEn || parsed.descriptionHi)) {
          const rawKeywords = Array.isArray(parsed.seoKeywords) ? parsed.seoKeywords : undefined;
          const rawTags = Array.isArray(parsed.searchTags) ? parsed.searchTags : rawKeywords;
          const dedupedKeywords = rawKeywords ? deduplicateKeywords(rawKeywords) : undefined;
          const dedupedTags = rawTags ? deduplicateKeywords(rawTags) : dedupedKeywords;

          return {
            titleEn: parsed.titleEn || attributes.titleEn,
            titleHi: parsed.titleHi || attributes.titleHi,
            descriptionEn: parsed.descriptionEn || '',
            descriptionHi: parsed.descriptionHi || '',
            culturalContext: parsed.culturalContext || undefined,
            seoKeywords: dedupedKeywords,
            searchTags: dedupedTags,
            metaDescription: parsed.metaDescription || parsed.descriptionEn || undefined
          };
        }
      }
    } catch (edgeErr) {
      console.warn('[Shilp-AI] ai-services Edge Function product_description notice:', edgeErr);
    }
  }

  // 2. Secondary fallback provider: Direct Gemini
  if (hasGeminiApiKey()) {
    try {
      const geminiPromise = askGeminiMultimodal(prompt, imageData);
      const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Gemini API timeout')), 2500));
      const rawResult = await Promise.race([geminiPromise, timeoutPromise]);
      const cleanedJsonStr = rawResult.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(cleanedJsonStr);

      if (parsed && (parsed.descriptionEn || parsed.descriptionHi)) {
        const rawKeywords = Array.isArray(parsed.seoKeywords) ? parsed.seoKeywords : undefined;
        const rawTags = Array.isArray(parsed.searchTags) ? parsed.searchTags : rawKeywords;
        const dedupedKeywords = rawKeywords ? deduplicateKeywords(rawKeywords) : undefined;
        const dedupedTags = rawTags ? deduplicateKeywords(rawTags) : dedupedKeywords;

        return {
          titleEn: parsed.titleEn || attributes.titleEn,
          titleHi: parsed.titleHi || attributes.titleHi,
          descriptionEn: parsed.descriptionEn || '',
          descriptionHi: parsed.descriptionHi || '',
          culturalContext: parsed.culturalContext || undefined,
          seoKeywords: dedupedKeywords,
          searchTags: dedupedTags,
          metaDescription: parsed.metaDescription || parsed.descriptionEn || undefined
        };
      }
    } catch (err) {
      console.warn('[Shilp-AI] Gemini description generation failed after retries.');
    }
  }

  // 3. Tertiary fallback provider: Direct OpenRouter
  if (hasOpenRouterApiKey()) {
    try {
      const openRouterPromise = askOpenRouter(prompt);
      const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('OpenRouter API timeout')), 2500));
      const rawResult = await Promise.race([openRouterPromise, timeoutPromise]);
      const cleanedJsonStr = rawResult.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(cleanedJsonStr);

      if (parsed && (parsed.descriptionEn || parsed.descriptionHi)) {
        const rawKeywords = Array.isArray(parsed.seoKeywords) ? parsed.seoKeywords : undefined;
        const rawTags = Array.isArray(parsed.searchTags) ? parsed.searchTags : rawKeywords;
        const dedupedKeywords = rawKeywords ? deduplicateKeywords(rawKeywords) : undefined;
        const dedupedTags = rawTags ? deduplicateKeywords(rawTags) : dedupedKeywords;

        return {
          titleEn: parsed.titleEn || attributes.titleEn,
          titleHi: parsed.titleHi || attributes.titleHi,
          descriptionEn: parsed.descriptionEn || '',
          descriptionHi: parsed.descriptionHi || '',
          culturalContext: parsed.culturalContext || undefined,
          seoKeywords: dedupedKeywords,
          searchTags: dedupedTags,
          metaDescription: parsed.metaDescription || parsed.descriptionEn || undefined
        };
      }
    } catch (err) {
      console.warn('[Shilp-AI] OpenRouter description generation notice:', err);
    }
  }

  // 4. Final fallback: structured deterministic description
  return buildFallbackDescription(attributes, diwaliContext);
}

/**
 * Build a plain-language catalog description from structured artisan attributes and DIWALI cultural context.
 * Used as a graceful fallback when Gemini/OpenRouter is unavailable after retries.
 * Contains ONLY facts explicitly extracted from artisan voice and verified DIWALI context — no inventions.
 */
export function buildFallbackDescription(
  attributes: Parameters<typeof generateCulturalDescription>[0],
  diwaliContext?: string
): CulturallyGroundedDescriptionResponse {
  const parts: string[] = [];

  // Core identity
  const productLabel = [
    attributes.color && attributes.color !== 'Natural Finish' ? attributes.color : null,
    attributes.style,
    attributes.fabricType || (attributes.primaryMaterial !== 'Authentic Artisan Material' ? attributes.primaryMaterial : null),
    attributes.productType,
  ].filter(Boolean).join(' ');

  if (productLabel) parts.push(productLabel + '.');

  // Construction / weaving
  if (attributes.weavingMethod) parts.push(`Crafted using ${attributes.weavingMethod} technique.`);
  if (attributes.constructionMethod) parts.push(`${attributes.constructionMethod}.`);

  // Pattern & motif
  if (attributes.pattern) parts.push(`Features ${attributes.pattern}.`);

  // Border
  if (attributes.borderColor) parts.push(`Border: ${attributes.borderColor}.`);

  // Zari / dye
  if (attributes.zariType) parts.push(`${attributes.zariType}.`);
  if (attributes.dyeType) parts.push(`Coloured using ${attributes.dyeType}.`);

  // Cultural heritage context
  let cleanDiwaliContext: string | undefined = undefined;
  if (diwaliContext && !diwaliContext.startsWith('No specific cultural heritage match')) {
    cleanDiwaliContext = diwaliContext;
    parts.push(diwaliContext);
  }

  // Final fallback if no facts at all
  const descriptionEn = parts.length > 0
    ? parts.join(' ')
    : `A ${attributes.category} product, handcrafted by an Indian artisan.`;

  // Simple Hindi variant incorporating attributes & heritage context
  const descriptionHi = parts.length > 0
    ? `यह ${productLabel || 'उत्पाद'} परम्परागत तकनीक द्वारा निर्मित एक उत्कृष्ट भारतीय हस्तशिल्प है। ${cleanDiwaliContext || ''}`.trim()
    : `यह एक हस्तनिर्मित भारतीय शिल्प है।`;

  return {
    titleEn: attributes.titleEn,
    titleHi: attributes.titleHi,
    descriptionEn,
    descriptionHi,
    culturalContext: cleanDiwaliContext,
    seoKeywords: undefined,
    searchTags: undefined,
    metaDescription: descriptionEn.slice(0, 160),
  };
}

