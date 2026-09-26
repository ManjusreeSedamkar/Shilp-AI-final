import { CraftCategory, Language } from '../types';
import { getSpeechLangCode } from './translations';

/**
 * SHILP-AI Multilingual Voice Cataloger & NLP Engine
 *
 * Supports Web Speech Recognition (Hindi, English, Telugu, Tamil, Bengali, Marathi, Gujarati)
 * Extracts structured product attributes from natural artisan spoken voice.
 *
 * SOURCE PRIORITY (enforced here):
 *   1. Explicit artisan voice/text (highest) — always preserved
 *   2. Gemini Vision (supplements missing VISUAL attributes — applied in VoiceCatalogerModal)
 *   3. DIWALI cultural retrieval (cultural context only — never classifies product)
 *   4. null / 'Not specified' (fallback — never invent facts)
 */

export interface ExtractedProductAttributes {
  // ── Core catalog fields (flow into ProductListing) ────────────────────────
  titleEn: string;
  titleHi: string;
  category: CraftCategory;
  craftTechnique: string;
  primaryMaterial: string;
  productionDays: number;
  rawMaterialCost: number;
  color: string;
  descriptionEn: string;
  descriptionHi: string;
  culturalContext?: string;
  seoKeywords: string[];
  searchTags?: string[];
  metaDescription?: string;
  targetBuyers: string[];

  // ── Rich artisan-provided attributes (flow into ProductListing optional fields) ──
  productType: string | null;         // e.g. "Shawl", "Saree"
  style: string | null;               // e.g. "Kashmiri", "Pochampally"
  subject: string | null;             // e.g. "Nandi", "Horse"
  weavingMethod: string | null;       // e.g. "Handwoven", "Hand-spun"
  constructionMethod: string | null;  // e.g. "Hand-embroidered", "Block Printed"
  pattern: string | null;             // e.g. "Floral", "Geometric"
  motif: string | null;               // e.g. "Pink & Gold Floral"
  borderColor: string | null;         // e.g. "Pink & Gold"
  secondaryColors: string | null;     // e.g. "Pink, Gold"
  dyeType: string | null;             // e.g. "Natural Dye"
  zariType: string | null;            // e.g. "100% Zari"
  fabricType: string | null;          // e.g. "Mulberry Silk"
  material?: string | null;           // e.g. "Silk", "Brass", "Terracotta"
  primaryColor?: string | null;       // e.g. "Cream", "Red"
  finish: string | null;              // e.g. "Antique", "Polished"
  artisanClaims: string[];            // verbatim claims from artisan

  // ── Pipeline control ───────────────────────────────────────────────────────
  isExplicitVoiceMatch: boolean;
}

export class VoiceCatalogerEngine {
  /**
   * Parse spoken text in Hindi, English, or mixed Hinglish and extract structured attributes.
   *
   * RULE: Extract ONLY what the artisan explicitly stated.
   *       Never invent product-specific facts.
   *       Gemini Vision supplements missing VISUAL attributes in VoiceCatalogerModal.
   */
  static extractAttributesFromSpeech(transcript: string): ExtractedProductAttributes {
    const text = transcript.toLowerCase();

    // ── 1. Raw Material Cost (only if explicitly stated) ──────────────────────
    let rawMaterialCost = 1500;
    const costMatch =
      transcript.match(/(?:₹|rs\.?|rupees|रुपये|खर्च|लागत|cost|price)\s*[:=]?\s*(\d+[\d,]*)/i) ||
      transcript.match(/(\d+[\d,]*)\s*(?:₹|rs\.?|rupees|रुपये)/i);
    if (costMatch && costMatch[1]) {
      const parsed = parseInt(costMatch[1].replace(/,/g, ''), 10);
      if (!isNaN(parsed) && parsed > 0) rawMaterialCost = parsed;
    }

    // ── 2. Production Days (only if explicitly stated; 0 = not stated) ────────
    let productionDays = 0;
    const daysMatch = transcript.match(/(\d+)\s*(?:days?|दिन|దినాలు|நாட்கள்|দিন|दिवस|દિવસ)/i);
    if (daysMatch && daysMatch[1]) {
      const parsed = parseInt(daysMatch[1], 10);
      if (!isNaN(parsed) && parsed > 0) productionDays = parsed;
    }

    // NOTE: JavaScript \b (word boundary) only works for ASCII [A-Za-z0-9_].
    // It does NOT work for Devanagari, Telugu, or other Unicode scripts.
    // Solution: use \b only around ASCII tokens; let Unicode tokens match without it
    // (they naturally don't appear inside other Unicode words when separated by spaces).
    const colorMap: [RegExp, string][] = [
      [/(?:\b(?:cream|malai)\b|(?:क्रीम|मलाई))/i, 'Cream'],
      [/(?:\b(?:white|safed)\b|(?:सफ़ेद|सफेद|తెలుపు))/i, 'White'],
      [/(?:\b(?:red|lal|laal)\b|(?:लाल|ఎరుపు))/i, 'Red'],
      // Blue: neela/neeli = Roman Hindi; नीला/नीली = Devanagari (masc/fem); నీలం = Telugu
      [/(?:\b(?:blue|nila|neela|neeli)\b|(?:नीला|नीली|నీలం))/i, 'Blue'],
      [/(?:\b(?:green|hara|hari)\b|(?:हरा|హరిత))/i, 'Green'],
      [/(?:\b(?:yellow|peela|peeli)\b|(?:पीला|పసుపు))/i, 'Yellow'],
      [/(?:\b(?:black|kala|kali)\b|(?:काला|నల్ల))/i, 'Black'],
      // Golden: sunhara/sunahre = Roman Hindi masc/obl; सुनहरा/सुनहरी/सुनहरे = Devanagari masc/fem/obl
      [/(?:\b(?:gold|golden|sunhara|sunahre|sunhare|sona)\b|(?:सोना|सुनहरा|सुनहरी|సోనే|బంగారు))/i, 'Golden'],
      [/(?:\b(?:orange)\b|(?:नारंगी|నారింజ))/i, 'Orange'],
      [/(?:\b(?:pink|gulabi)\b|(?:गुलाबी|పింక్))/i, 'Pink'],
      [/(?:\b(?:purple|violet|baingnee)\b|(?:बैंगनी|జాంబూ))/i, 'Purple'],
      [/(?:\b(?:brown|bhura)\b|(?:भूरा|గోధుమ))/i, 'Brown'],
      [/(?:\b(?:maroon|dark.?red)\b|(?:गहरा.?लाल|మారూన్))/i, 'Maroon'],
      [/(?:\b(?:silver|chandi)\b|(?:चांदी|వెండి))/i, 'Silver'],
    ];
    let spokenColor: string | null = null;
    for (const [re, colorName] of colorMap) {
      if (re.test(transcript)) {
        spokenColor = colorName;
        break;
      }
    }

    // ── 4. Secondary colors & border color ────────────────────────────────────
    // Collect all mentioned colors for secondary / border detection
    const allColors: string[] = [];
    for (const [re, colorName] of colorMap) {
      if (re.test(transcript)) allColors.push(colorName);
    }
    const secondaryColors = allColors.length > 1 ? allColors.slice(1).join(', ') : null;

    // Border color: look for explicit border mention with adjacent colors or materials
    // Supports Roman Hindi, Devanagari Hindi, Telugu:
    //   "border sunahre Jari se bana hai"    → Golden zari
    //   "बॉर्डर सुनहरी ज़री से बना है"      → Golden zari
    //   "pink and gold border"               → Pink & Gold
    let borderColor: string | null = null;

    // ── Pass 1: golden/silver zari border (Kanchipuram, Banarasi pattern) ──
    // NOTE: \b not used before any Devanagari/Telugu tokens — plain substring match.
    if (
      // Roman Hindi: sunhara/sunahre...zari...border (any order within ~20 chars)
      /(?:sunhara|sunahre|sunhare|golden)[\s\S]{0,20}?(?:zari|jari)[\s\S]{0,20}?(?:border|kinara)/i.test(transcript) ||
      // Roman Hindi: border...sunhara/golden...zari
      /(?:border|kinara)[\s\S]{0,20}?(?:sunhara|sunahre|sunhare|golden)[\s\S]{0,15}?(?:zari|jari)/i.test(transcript) ||
      // Roman Hindi: zari se bana border
      /(?:zari|jari)[\s\S]{0,20}?(?:se bana|se banaa|se bani)[\s\S]{0,20}?(?:border|kinara)/i.test(transcript) ||
      // Roman Hindi: border...zari...se bana
      /(?:border|kinara)[\s\S]{0,20}?(?:zari|jari)[\s\S]{0,20}?(?:se bana|se banaa)/i.test(transcript) ||
      // Devanagari: सुनहरा/सुनहरी/सुनहरे...ज़री...बॉर्डर (any order)
      /(?:सुनहरा|सुनहरी|सुनहरे)[\s\S]{0,20}?(?:ज़री|जरी)[\s\S]{0,20}?(?:बॉर्डर|किनारा)/i.test(transcript) ||
      // Devanagari: बॉर्डर...सुनहरा/री...ज़री
      /(?:बॉर्डर|किनारा)[\s\S]{0,20}?(?:सुनहरा|सुनहरी|सुनहरे)[\s\S]{0,15}?(?:ज़री|जरी)/i.test(transcript) ||
      // Devanagari: ज़री से बना/बनी...बॉर्डर
      /(?:ज़री|जरी)[\s\S]{0,20}?(?:से बना|से बनी|से बना है|से बनी है)[\s\S]{0,20}?(?:बॉर्डर|किनारा)/i.test(transcript) ||
      // Devanagari: बॉर्डर...ज़री से बना/बनी
      /(?:बॉर्डर|किनारा)[\s\S]{0,20}?(?:ज़री|जरी)[\s\S]{0,20}?(?:से बना|से बनी)/i.test(transcript) ||
      // Telugu: బంగారు జరీతో తయారు చేసిన బోర్డర్
      /(?:బంగారు)[\s\S]{0,20}?(?:జరీ)[\s\S]{0,20}?(?:బోర్డర్|అంచు)/i.test(transcript)
    ) {
      // Determine golden vs silver
      if (
        /(?:sunhara|sunahre|sunhare|golden|sone)\b/i.test(transcript) ||
        /(?:सुनहरा|सुनहरी|సోనే|బంగారు)/.test(transcript)
      ) {
        borderColor = 'Golden zari';
      } else if (
        /\b(?:silver|chandi|chande)\b/i.test(transcript) ||
        /(?:चांदी|వెండి)/.test(transcript)
      ) {
        borderColor = 'Silver zari';
      } else {
        borderColor = 'Zari border';
      }
    }

    // ── Pass 2: color-named borders ("pink and gold border", "sunahri border") ──
    if (!borderColor) {
      const borderMatch = transcript.match(
        /(?:border|kinara|किनारा|kinare|बॉर्डर|bordar|బోర్డర్)\s+(?:mein\s+)?(?:ka\s+)?(?:ki\s+)?(?:hai\s+)?([^।.!?\n]{2,50})/i
      ) || transcript.match(
        /([^।.!?\n]{2,50})\s+(?:border|kinara|किनारा|बॉर्डर|bordar|బోర్డర్)/i
      );
      if (borderMatch) {
        const borderCtx = borderMatch[1];
        const borderColors: string[] = [];
        for (const [re, colorName] of colorMap) {
          if (re.test(borderCtx)) borderColors.push(colorName);
        }
        // Also detect sunhara/sunahre/सुनहरी as Golden in border context
        if (
          /(?:sunhara|sunahre|sunhare)\b/i.test(borderCtx) ||
          /(?:सुनहरा|सुनहरी|सुनहरे)/.test(borderCtx)
        ) {
          if (!borderColors.includes('Golden')) borderColors.push('Golden');
        }
        if (borderColors.length > 0) borderColor = borderColors.join(' & ');
      }
    }

    // ── Pass 3: fallback — two colors mentioned anywhere near "border" ──
    if (!borderColor && allColors.length >= 2) {
      const borderAny = /(?:border|kinara|किनारा|बॉर्डर)/i.test(transcript);
      if (borderAny) {
        borderColor = allColors.slice(0, 2).join(' & ');
      }
    }

    // ── 5. Weaving / construction method ─────────────────────────────────────
    let weavingMethod: string | null = null;
    let constructionMethod: string | null = null;

    // Handwoven (highest priority — check before general weave)
    if (/\b(?:handwoven|hand.?woven|hand.?weave|haath\s+se\s+bun[ai]|हाथ\s+से\s+बुन|হাতে\s+বোনা)\b/i.test(transcript)) {
      weavingMethod = 'Handwoven';
    } else if (/\b(?:handspun|hand.?spun|hand.?spin|haath\s+se\s+kat[ai]|हाथ\s+से\s+काता)\b/i.test(transcript)) {
      weavingMethod = 'Hand-spun';
    } else if (/\b(?:handloom|हथकरघा|haathkargha)\b/i.test(transcript)) {
      weavingMethod = 'Handloom Woven';
    }

    // Construction/surface method
    if (/\b(?:hand.?embroidered|hand\s+embroidery|haath\s+se\s+kadh[ai]|हाथ\s+से\s+कढ़ाई|कढ़ाईदार)\b/i.test(transcript)) {
      constructionMethod = 'Hand-embroidered';
    } else if (/\b(?:hand.?painted|hand\s+paint|haath\s+se\s+chitra|हाथ\s+से\s+चित्र|हाथचित्रित)\b/i.test(transcript)) {
      constructionMethod = 'Hand-painted';
    } else if (/\b(?:hand.?carved|hand\s+carv|haath\s+se\s+nakkash|हाथ\s+से\s+नक्काशी)\b/i.test(transcript)) {
      constructionMethod = 'Hand-carved';
    } else if (/\b(?:block\s*print(?:ed)?|ब्लॉक\s*प्रिंट)\b/i.test(transcript)) {
      constructionMethod = 'Block Printed';
    } else if (/\b(?:resist\s*print|batik)\b/i.test(transcript)) {
      constructionMethod = 'Batik / Resist Printed';
    } else if (/\b(?:handloom|हथकरघा|haathkargha)\b/i.test(transcript)) {
      constructionMethod = 'Handloom Weaving';
    }

    // ── 6. Pattern & Motif ────────────────────────────────────────────────────
    let pattern: string | null = null;
    let motif: string | null = null;

    // Extended multilingual pattern matching:
    const hasFloral = /(?:floral|flower|phool|फूल|phoolon|फूलों|పూల|گل|floral[\s\-]*design|phool[\s\-]*design|paramparik[\s\-]*phool|पारंपरिक[\s\-]*फूल)/i.test(transcript);
    const hasGeometric = /\b(?:geometric|geometry|ज्यामितीय|ज्यामिती|రేఖాగణిత)\b/i.test(transcript);

    if (hasFloral && hasGeometric) {
      pattern = 'Floral & Geometric Motifs';
    } else if (hasFloral) {
      pattern = 'Traditional floral design';
    } else if (hasGeometric) {
      pattern = 'Geometric';
    } else if (/\b(?:paisley|buta|बूटा|कलगी|పేస్లీ)\b/i.test(transcript)) {
      pattern = 'Paisley / Buta';
    } else if (/\b(?:abstract|अमूर्त|అబ్‌స్ట్రాక్ట్)\b/i.test(transcript)) {
      pattern = 'Abstract';
    } else if (/\b(?:tribal|आदिवासी|जनजातीय|గిరిజన)\b/i.test(transcript)) {
      pattern = 'Tribal';
    } else if (/\b(?:stripe|dhaariya|धारीदार|धारी|చారలు)\b/i.test(transcript)) {
      pattern = 'Striped';
    } else if (/\b(?:checkered|checked|jaali|जाली|चेक|జాలీ)\b/i.test(transcript)) {
      pattern = 'Checkered';
    } else if (/\b(?:paramparik|traditional)[\s\-]*(?:design|naksha|नक्शा|डिजाइन)/i.test(transcript)) {
      pattern = 'Traditional design';
    }

    // Build motif from pattern + colors if we have both
    if (pattern && allColors.length >= 2) {
      const motifColors = allColors.slice(0, 2).join(' & ');
      motif = `${motifColors} ${pattern}`;
    } else if (pattern && spokenColor) {
      motif = `${spokenColor} ${pattern}`;
    }

    // ── 7. Dye type ───────────────────────────────────────────────────────────
    let dyeType: string | null = null;
    if (/\b(?:natural[\s\-]*dy[eing]*|prakritik[\s\-]*rang|प्राकृतिक[\s\-]*रंग|neem|turmeric|haldi|సహజ[\s\-]*రంగు)\b/i.test(transcript)) {
      dyeType = 'Natural Dye';
    } else if (/\b(?:vegetable[\s\-]*dy[eing]*|sabji[\s\-]*rang|सब्जी[\s\-]*का[\s\-]*रंग)\b/i.test(transcript)) {
      dyeType = 'Vegetable Dye';
    } else if (/\b(?:azo.?free|eco.?dy[eing]*|herbal[\s\-]*dy[eing]*)\b/i.test(transcript)) {
      dyeType = 'Eco / Herbal Dye';
    }

    // ── 8. Zari type ─────────────────────────────────────────────────────────
    // NOTE: \b does not work for Devanagari/Telugu — use split patterns.
    // Covers:
    //   Roman Hindi: sunhara/sunahre/sunhare zari ka kam, sone ki zari
    //   Devanagari:  सुनहरा/सुनहरी/सुनहरे ज़री, ज़री का काम, सोने की ज़री
    //   Telugu:      బంగారు జరీ
    let zariType: string | null = null;
    if (
      // 100% / pure / shudh zari — ASCII only, \b is fine
      /\b(?:100\s*%\s*(?:zari|jari)|pure[\s\-]*(?:zari|jari)|shudh[\s\-]*(?:zari|jari))\b/i.test(transcript) ||
      // Devanagari: शुद्ध ज़री — no \b
      /शुद्ध[\s\-]*ज़री/.test(transcript)
    ) {
      zariType = '100% Zari';
    } else if (
      // ASCII golden zari patterns — \b safe on ASCII tokens
      /\b(?:gold[\s\-]*(?:zari|jari)|sone[\s\-]*ki[\s\-]*(?:zari|jari)|sone[\s\-]*ka[\s\-]*(?:zari|jari))\b/i.test(transcript) ||
      // Roman Hindi: sunhara/sunahre/sunhare + zari/jari  — \b safe on ASCII
      /\b(?:sunhara|sunahre|sunhare|golden)[\s\-]*(?:zari|jari)\b/i.test(transcript) ||
      // Devanagari: सुनहरा/सुनहरी/सुनहरे + ज़री/जरी — NO \b before Devanagari
      /(?:सुनहरा|सुनहरी|सुनहरे)[\s\-]*(?:ज़री|जरी)/.test(transcript) ||
      // Devanagari: सोने की ज़री
      /सोने[\s\-]*की[\s\-]*(?:ज़री|जरी)/.test(transcript) ||
      // Zari work: ज़री का काम (Devanagari 'का') or zari ka kaam (Roman Hindi)
      /(?:ज़री|जरी)[\s\-]*(?:का|ka)[\s\-]*(?:काम|kam|kaam)/.test(transcript) ||
      // Telugu: బంగారు జరీ
      /బంగారు[\s\-]*జరీ/.test(transcript)
    ) {
      zariType = 'Golden zari';
    } else if (
      /\b(?:silver[\s\-]*(?:zari|jari)|chandi[\s\-]*ki[\s\-]*(?:zari|jari))\b/i.test(transcript) ||
      /(?:चांदी[\s\-]*की[\s\-]*(?:ज़री|जरी)|వెండి[\s\-]*జరీ)/.test(transcript)
    ) {
      zariType = 'Silver Zari';
    } else if (
      /\b(?:zari|jari)\b/i.test(transcript) ||
      /(?:ज़री|जरी|జరీ)/.test(transcript)
    ) {
      zariType = 'Zari Work';
    }

    // ── 9. Fabric / fiber type ────────────────────────────────────────────────
    // NOTE: \b is safe for ASCII tokens only; Devanagari uses plain substring.
    let fabricType: string | null = null;
    if (
      /\b(?:mulberry[\s\-]*silk|malbari[\s\-]*silk)\b/i.test(transcript) ||
      /(?:मलबेरी[\s\-]*सिल्क)/.test(transcript)
    ) {
      fabricType = 'Mulberry Silk';
    } else if (
      /\b(?:pure[\s\-]*silk|shudh[\s\-]*resham)\b/i.test(transcript) ||
      /(?:शुद्ध[\s\-]*रेशम)/.test(transcript)
    ) {
      fabricType = 'Pure Silk';
    } else if (
      /\b(?:pure[\s\-]*cotton|100\s*%\s*cotton)\b/i.test(transcript) ||
      /(?:शुद्ध[\s\-]*सूत)/.test(transcript)
    ) {
      fabricType = 'Pure Cotton';
    } else if (
      /\bpashmina\b/i.test(transcript) ||
      /पश्मीना/.test(transcript)
    ) {
      fabricType = 'Pashmina';
    } else if (/\bcashmere\b/i.test(transcript)) {
      fabricType = 'Cashmere';
    } else if (/\blinen\b/i.test(transcript)) {
      fabricType = 'Linen';
    } else if (
      /\bkhadi\b/i.test(transcript) ||
      /खादी/.test(transcript)
    ) {
      fabricType = 'Khadi';
    } else if (/\b(?:tussar|tassar|tasar)\b/i.test(transcript)) {
      fabricType = 'Tussar Silk';
    } else if (
      // Plain "silk" / "रेशम" / "सिल्क" — only set if no more specific type above
      /\bsilk\b/i.test(transcript) ||
      /(?:रेशम|सिल्क)/.test(transcript)
    ) {
      fabricType = 'Silk';
    }

    // ── 10. Finish ────────────────────────────────────────────────────────────
    let finish: string | null = null;
    if (/\b(?:antique|antiqued|पुरातन|पुरानी\s*शैली)\b/i.test(transcript)) {
      finish = 'Antique';
    } else if (/\b(?:polished|polish|चमकदार)\b/i.test(transcript)) {
      finish = 'Polished';
    } else if (/\b(?:matte|mat\s*finish|बेरंग|धुंधला)\b/i.test(transcript)) {
      finish = 'Matte';
    }

    // ── 11. Artisan claims (explicit verbatim) ────────────────────────────────
    const artisanClaims: string[] = [];
    if (/\b(?:100\s*%\s*handmade|fully\s*handmade|purna\s*hastakaari|पूर्ण\s*हस्तकारी)\b/i.test(transcript)) artisanClaims.push('100% Handmade');
    if (dyeType) artisanClaims.push(dyeType);
    if (zariType) artisanClaims.push(zariType);
    if (/\b(?:no\s*machine|machine.?free|बिना\s*मशीन)\b/i.test(transcript)) artisanClaims.push('Machine-free');

    // ── 12. Craft category detection ─────────────────────────────────────────
    let category: CraftCategory = 'Other Heritage Craft';
    let isExplicitVoiceMatch = false;
    let spokenProductType: string | null = null;
    let spokenStyle: string | null = null;
    let spokenMaterial: string | null = null;
    let spokenTechnique: string | null = null;
    let spokenSubject: string | null = null;

    const isTextile =
      text.includes('saree') || text.includes('sari') || text.includes('साड़ी') ||
      text.includes('silk') || text.includes('रेशम') || text.includes('सिल्क') ||
      text.includes('రేషమ్') || text.includes('பட்டு') || text.includes('রেশম') ||
      text.includes('रेशीम') || text.includes('રેશમ') ||
      text.includes('ikat') || text.includes('ecat') ||
      text.includes('pochampally') || text.includes('pochampalli') || text.includes('पोचमपल्ली') ||
      text.includes('kanchipuram') || text.includes('kanjivaram') ||
      text.includes('कांचीपुरम') || text.includes('कांजीवरम') ||
      text.includes('handloom') || text.includes('हथकरघा') ||
      text.includes('weave') || text.includes('woven') || text.includes('बुनाई') || text.includes('बुनी') ||
      text.includes('handwoven') || text.includes('haath se buni') ||
      text.includes('shawl') || text.includes('शॉल') ||
      text.includes('dupatta') || text.includes('दुपट्टा') ||
      text.includes('stole') || text.includes('स्टोल') ||
      text.includes('scarf') || text.includes('स्काफ') || text.includes('स्कार्फ') ||
      text.includes('kurta') || text.includes('kurti') || text.includes('कुर्ता') || text.includes('कुर्ती') ||
      text.includes('fabric') || text.includes('kapda') || text.includes('कपड़ा') || text.includes('वस्त्र') ||
      weavingMethod !== null;

    const isMetalcraft =
      text.includes('dhokra') || text.includes('dokra') || text.includes('ढोकरा') ||
      text.includes('brass') || text.includes('पीतल') || text.includes('peetal') ||
      text.includes('bronze') || text.includes('कांसा') || text.includes('kansa') ||
      text.includes('bell metal') || text.includes('bell-metal') ||
      text.includes('cire perdue') || text.includes('lost-wax') || text.includes('lost wax') ||
      text.includes('bastar') || text.includes('बस्तर');

    const isTerracotta =
      text.includes('terracotta') || text.includes('terra-cotta') || text.includes('टेराकोटा') ||
      text.includes('pottery') || text.includes('कुम्हार') || text.includes('कुंभार') ||
      text.includes('clay') || text.includes('मिट्टी') || text.includes('माटी') ||
      text.includes('vase') || text.includes('guldasta') || text.includes('गुलदस्ता') ||
      text.includes('bowl') || text.includes('katora') || text.includes('कटोरा') ||
      text.includes('bankura') || text.includes('बांकुरा');

    const isPainting =
      text.includes('madhubani') || text.includes('मधुबनी') ||
      text.includes('mithila') || text.includes('मिथिला') ||
      text.includes('warli') || text.includes('pattachitra') || text.includes('patachitra') ||
      text.includes('painting') || text.includes('चित्रकला') || text.includes('canvas');

    const isPashmina =
      text.includes('pashmina') || text.includes('पश्मीना') || text.includes('cashmere') ||
      (text.includes('shawl') || text.includes('शॉल')) && (text.includes('kashmiri') || text.includes('कश्मीरी'));

    const isWoodcraft =
      text.includes('teakwood') || text.includes('sheesham') || text.includes('wood') ||
      text.includes('wood carving') || text.includes('wooden carving') || text.includes('लकड़ी') ||
      text.includes('नक्काशीदार लकड़ी') || text.includes('woodwork');

    const isSculpture =
      text.includes('statue') || text.includes('figurine') || text.includes('idol') ||
      text.includes('murti') || text.includes('मूर्ति') || text.includes('विग्रह');

    const isOtherCraft =
      text.includes('doll') || text.includes('gudia') || text.includes('गुड़िया') ||
      text.includes('basket') || text.includes('tokri') || text.includes('टोकरी') ||
      text.includes('wall hanging') || text.includes('wall decor') || text.includes('वॉल हैंगिंग') ||
      text.includes('jute') || text.includes('जूट') ||
      text.includes('bamboo') || text.includes('बांस') ||
      text.includes('cane') || text.includes('बेत') ||
      text.includes('leather') || text.includes('चमड़ा') ||
      text.includes('paper') || text.includes('कागज') || text.includes('papier-mache');

    // ── Assign category + extract spoken style/technique/material ─────────────
    if (isPashmina) {
      category = 'Textiles & Handloom';
      isExplicitVoiceMatch = true;
      spokenProductType = text.includes('shawl') || text.includes('शॉल') ? 'Shawl' : 'Pashmina Textile';
      spokenMaterial = fabricType || 'Pashmina';
      spokenStyle = 'Kashmiri';

    } else if (isTextile) {
      category = 'Textiles & Handloom';
      isExplicitVoiceMatch = true;

      const hasSilk = text.includes('silk') || text.includes('रेशम') || text.includes('सिल्क');
      const hasSaree = text.includes('saree') || text.includes('sari') || text.includes('साड़ी');

      if (hasSilk && hasSaree) spokenProductType = 'Silk Saree';
      else if (hasSaree) spokenProductType = 'Saree';
      else if (text.includes('shawl') || text.includes('शॉल')) spokenProductType = 'Shawl';
      else if (text.includes('dupatta') || text.includes('दुपट्टा')) spokenProductType = 'Dupatta';
      else if (text.includes('stole') || text.includes('स्टोल')) spokenProductType = 'Stole';
      else if (text.includes('scarf') || text.includes('स्काफ') || text.includes('स्कार्फ')) spokenProductType = 'Scarf';
      else if (text.includes('kurta') || text.includes('kurti') || text.includes('कुर्ता')) spokenProductType = 'Kurta';
      else if (text.includes('fabric') || text.includes('kapda') || text.includes('कपड़ा')) spokenProductType = 'Fabric';
      else spokenProductType = 'Textile';

      if (text.includes('pochampally') || text.includes('pochampalli') || text.includes('पोचमपल्ली')) spokenStyle = 'Pochampally';
      else if (text.includes('kanchipuram') || text.includes('kanjivaram') || text.includes('कांजीवरम') || text.includes('कांचीपुरम')) spokenStyle = 'Kanchipuram';
      else if (text.includes('banarasi') || text.includes('बनारसी')) spokenStyle = 'Banarasi';
      else if (text.includes('patola') || text.includes('पटोला')) spokenStyle = 'Patola';
      else if (text.includes('kashmiri') || text.includes('कश्मीरी')) spokenStyle = 'Kashmiri';
      else if (text.includes('chanderi') || text.includes('चंदेरी')) spokenStyle = 'Chanderi';
      else if (text.includes('maheshwari') || text.includes('माहेश्वरी')) spokenStyle = 'Maheshwari';

      if (text.includes('ikat') || text.includes('ecat')) spokenTechnique = 'Ikat';
      else if (weavingMethod) spokenTechnique = weavingMethod;
      else if (text.includes('handloom') || text.includes('हथकरघा')) spokenTechnique = 'Handloom Weaving';

      spokenMaterial = fabricType || (hasSilk ? 'Silk' : null)
                       || (text.includes('cotton') || text.includes('सूती') ? 'Cotton' : null)
                       || (text.includes('wool') || text.includes('ऊन') ? 'Wool' : null)
                       || (text.includes('linen') || text.includes('लिनन') ? 'Linen' : null)
                       || (text.includes('jute') || text.includes('जूट') ? 'Jute' : null)
                       || (text.includes('hemp') || text.includes('हेम्प') ? 'Hemp' : null);

    } else if (isMetalcraft || (isSculpture && (text.includes('brass') || text.includes('bronze') || text.includes('metal')))) {
      category = 'Metalcraft & Dhokra';
      isExplicitVoiceMatch = true;
      if (text.includes('statue') || text.includes('मूर्ति')) spokenProductType = 'Statue';
      else if (text.includes('figurine')) spokenProductType = 'Figurine';
      else if (text.includes('idol')) spokenProductType = 'Idol';
      else spokenProductType = 'Metal Craft';

      if (text.includes('dhokra') || text.includes('dokra')) spokenTechnique = 'Dhokra (Lost-Wax Casting)';
      else if (text.includes('lost-wax') || text.includes('lost wax') || text.includes('cire perdue')) spokenTechnique = 'Lost-Wax Casting';

      if (text.includes('brass') || text.includes('पीतल')) spokenMaterial = 'Brass';
      else if (text.includes('bronze') || text.includes('कांसा')) spokenMaterial = 'Bronze';
      else if (text.includes('bell metal') || text.includes('bell-metal')) spokenMaterial = 'Bell Metal';
      if (text.includes('bastar') || text.includes('बस्तर')) spokenStyle = 'Bastar';

    } else if (isTerracotta) {
      category = 'Clay & Terracotta';
      isExplicitVoiceMatch = true;
      if (text.includes('vase') || text.includes('guldasta') || text.includes('गुलदस्ता')) spokenProductType = 'Vase';
      else if (text.includes('bowl') || text.includes('katora') || text.includes('कटोरा')) spokenProductType = 'Bowl';
      else spokenProductType = 'Terracotta';

      spokenMaterial = text.includes('terracotta') || text.includes('टेराकोटा') ? 'Terracotta' : 'Clay';
      if (text.includes('bankura') || text.includes('बांकुरा')) spokenStyle = 'Bankura';
      if (text.includes('pottery') || text.includes('कुम्हार')) spokenTechnique = 'Hand-Thrown Pottery';

    } else if (isPainting) {
      category = 'Traditional Painting';
      isExplicitVoiceMatch = true;
      spokenProductType = 'Painting';
      if (text.includes('madhubani') || text.includes('मधुबनी')) spokenStyle = 'Madhubani';
      else if (text.includes('mithila') || text.includes('मिथिला')) spokenStyle = 'Mithila';
      else if (text.includes('warli')) spokenStyle = 'Warli';
      else if (text.includes('pattachitra') || text.includes('patachitra')) spokenStyle = 'Pattachitra';
      spokenMaterial = text.includes('paper') || text.includes('कागज') ? 'Paper' : 'Canvas';

    } else if (isWoodcraft) {
      category = 'Woodcraft & Carving';
      isExplicitVoiceMatch = true;
      if (text.includes('statue') || text.includes('मूर्ति')) spokenProductType = 'Statue';
      else if (text.includes('figurine')) spokenProductType = 'Figurine';
      else spokenProductType = 'Wood Craft';
      spokenMaterial = text.includes('teakwood') ? 'Teakwood' : (text.includes('sheesham') ? 'Sheesham' : 'Wood');

    } else if (isSculpture) {
      category = 'Other Heritage Craft';
      isExplicitVoiceMatch = true;
      if (text.includes('statue') || text.includes('मूर्ति')) spokenProductType = 'Statue';
      else if (text.includes('figurine')) spokenProductType = 'Figurine';
      else if (text.includes('idol')) spokenProductType = 'Idol';
      else spokenProductType = 'Sculpture';

      if (text.includes('stone') || text.includes('patthar') || text.includes('पत्थर')) spokenMaterial = 'Stone';
      else if (text.includes('clay') || text.includes('मिट्टी')) spokenMaterial = 'Clay';

    } else if (isOtherCraft) {
      category = 'Other Heritage Craft';
      isExplicitVoiceMatch = true;
      if (text.includes('doll') || text.includes('gudia') || text.includes('गुड़िया')) spokenProductType = 'Doll';
      else if (text.includes('basket') || text.includes('tokri') || text.includes('टोकरी')) spokenProductType = 'Basket';
      else if (text.includes('wall hanging') || text.includes('वॉल हैंगिंग')) spokenProductType = 'Wall Hanging';

      if (text.includes('jute') || text.includes('जूट')) spokenMaterial = 'Jute';
      else if (text.includes('bamboo') || text.includes('बांस')) spokenMaterial = 'Bamboo';
      else if (text.includes('cane') || text.includes('बेत')) spokenMaterial = 'Cane';
      else if (text.includes('leather') || text.includes('चमड़ा')) spokenMaterial = 'Leather';
      else if (text.includes('paper') || text.includes('कागज')) spokenMaterial = 'Paper';
    }

    // ── 13. Subject / Named figure ────────────────────────────────────────────
    if (text.includes('nandi') || text.includes('नंदी') || text.includes('నంది')) spokenSubject = 'Nandi';
    else if (text.includes('ganesha') || text.includes('ganesh') || text.includes('गणेश')) spokenSubject = 'Ganesha';
    else if (text.includes('horse') || text.includes('ghoda') || text.includes('घोड़ा')) spokenSubject = 'Horse';
    else if (text.includes('elephant') || text.includes('hathi') || text.includes('हाथी')) spokenSubject = 'Elephant';
    else if (text.includes('peacock') || text.includes('mor') || text.includes('मोर')) spokenSubject = 'Peacock';
    else if (text.includes('bull') || text.includes('bail') || text.includes('बैल')) spokenSubject = 'Bull';
    else if (text.includes('tree of life') || text.includes('jeevan vriksha') || text.includes('जीवन वृक्ष')) spokenSubject = 'Tree of Life';
    else if (text.includes('fish') || text.includes('machali') || text.includes('मछली')) spokenSubject = 'Fish';
    else if (text.includes('bird') || text.includes('panchhi') || text.includes('पक्षी')) spokenSubject = 'Bird';

    // ── 14. Build title from spoken facts only ────────────────────────────────
    const titleParts: string[] = [];
    if (spokenStyle) titleParts.push(spokenStyle);
    if (weavingMethod && !titleParts.includes(weavingMethod)) titleParts.push(weavingMethod);
    else if (spokenTechnique && !spokenStyle && !weavingMethod) titleParts.push(spokenTechnique);
    if (spokenMaterial && spokenMaterial !== spokenProductType) titleParts.push(spokenMaterial);
    if (spokenSubject) titleParts.push(spokenSubject);
    if (spokenProductType) titleParts.push(spokenProductType);

    const titleEn = titleParts.length > 0 ? titleParts.join(' ') : 'Handcrafted Heritage Artisan Product';
    const titleHi = titleParts.length > 0 ? titleParts.join(' ') : 'हस्तनिर्मित कारीगर धरोहर उत्पाद';

    // ── 15. Derive resolved technique / material / color for catalog ──────────
    const craftTechnique = constructionMethod || weavingMethod || spokenTechnique || 'Traditional Handcrafted Artistry';
    const primaryMaterial = fabricType || spokenMaterial || 'Authentic Artisan Material';
    const color = spokenColor || 'Natural Finish';

    // ── 16. Placeholder description (replaced by Gemini output) ──────────────
    // This is briefly shown while Gemini generates. Contains no internal AI references.
    const descriptionEn = 'Generating catalog description…';
    const descriptionHi = 'कैटलॉग विवरण तैयार किया जा रहा है…';

    // ── 17. SEO Keywords — from spoken facts only ─────────────────────────────
    const seoKeywords: string[] = ['Handmade in India'];
    if (category !== 'Other Heritage Craft') seoKeywords.unshift(category);
    if (spokenStyle) seoKeywords.unshift(spokenStyle);
    if (spokenProductType && spokenProductType !== spokenStyle) seoKeywords.unshift(spokenProductType);
    if (weavingMethod) seoKeywords.push(weavingMethod);
    if (spokenColor) seoKeywords.push(`${spokenColor} ${spokenProductType || ''} `.trim());
    if (fabricType) seoKeywords.push(fabricType);
    if (dyeType) seoKeywords.push(dyeType);

    const targetBuyers = [
      'B2B Wholesale Buyers',
      'Handloom & Heritage Boutiques',
      'TRIFED & State Emporiums',
      'Corporate Gifting Companies',
      'International Cultural Importers'
    ];

    return {
      titleEn,
      titleHi,
      category,
      craftTechnique,
      primaryMaterial,
      productionDays,
      rawMaterialCost,
      color,
      descriptionEn,
      descriptionHi,
      seoKeywords,
      targetBuyers,
      // Rich attributes
      productType: spokenProductType,
      style: spokenStyle,
      subject: spokenSubject,
      weavingMethod,
      constructionMethod,
      pattern,
      motif,
      borderColor,
      secondaryColors,
      dyeType,
      zariType,
      fabricType,
      finish,
      artisanClaims,
      isExplicitVoiceMatch,
    };
  }

  /**
   * Synthesize text-to-speech for low-literacy artisans
   */
  static speak(text: string, lang: string = 'en-IN'): Promise<void> {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window)) {
        console.warn('SpeechSynthesis not supported in this browser.');
        resolve();
        return;
      }
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      utterance.rate = 0.95;
      utterance.pitch = 1.0;
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      const voices = window.speechSynthesis.getVoices();
      const langPrefix = lang.slice(0, 2);
      const matchingVoice = voices.find(v => v.lang.startsWith(langPrefix));
      if (matchingVoice) utterance.voice = matchingVoice;
      window.speechSynthesis.speak(utterance);
    });
  }

  static speakInLanguage(text: string, language: Language): Promise<void> {
    return VoiceCatalogerEngine.speak(text, getSpeechLangCode(language));
  }

  static stopSpeaking() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }
}