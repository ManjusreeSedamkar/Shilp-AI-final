import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Volume2, Square, Sparkles, Check, Globe, RefreshCw, ArrowRight, Tag, BookOpen, Image as ImageIcon, Camera, Upload, CheckCircle2, Copy, FileText, X, Scissors, SunMedium, Palette, Crop } from 'lucide-react';
import { VoiceCatalogerEngine, ExtractedProductAttributes } from '../services/voiceCataloger';
import { DynamicPricingEngine } from '../services/pricingEngine';
import { CRAFT_PRESETS } from '../data/craftPresets';
import { Language, ProductListing } from '../types';
import { CURRENT_ARTISAN } from '../data/craftPresets';
import { getSpeechLangCode, translate } from '../services/translations';
import { AIImageStudio, DEFAULT_IMAGE_OPTIONS } from '../services/imageStudio';
import { uploadImageToStorage } from '../services/firebase';
import { saveProductToSupabase, supabase } from '../services/supabase';
import { retrieveCulturalContext, DiwaliRetrievalResult } from '../services/diwaliRetriever';
import { generateCulturalDescription, analyzeImageVisuals, hasGeminiApiKey, hasOpenRouterApiKey, buildFallbackDescription } from '../services/geminiService';

interface VoiceCatalogerModalProps {
  language?: Language;
  onListingCreated?: (listing: ProductListing) => void;
  /** Called with the built ProductListing to hand off to final review step */
  onReadyForReview?: (listing: ProductListing) => void;
  selectedPhotoUrl?: string;
  originalPhotoUrl?: string;
}

export const VoiceCatalogerModal: React.FC<VoiceCatalogerModalProps> = ({
  language = 'en',
  onListingCreated,
  onReadyForReview,
  selectedPhotoUrl,
  originalPhotoUrl
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [selectedLangCode, setSelectedLangCode] = useState<string>(getSpeechLangCode(language));
  const [extractedData, setExtractedData] = useState<ExtractedProductAttributes | null>(null);
  const [activeTab, setActiveTab] = useState<'hindi' | 'english'>('hindi');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [spokenCatalogTranscript, setSpokenCatalogTranscript] = useState<string | null>(null);
  const [isTranscriptCopied, setIsTranscriptCopied] = useState(false);
  const [recognitionInstance, setRecognitionInstance] = useState<any>(null);
  
  // DIWALI Cultural RAG state
  const [diwaliContextResult, setDiwaliContextResult] = useState<DiwaliRetrievalResult | null>(null);
  const [isEnrichingWithDiwali, setIsEnrichingWithDiwali] = useState<boolean>(false);
  const [isDiwaliGrounded, setIsDiwaliGrounded] = useState<boolean>(false);

  // Staged product photo state - AI enhanced studio photo
  const [currentPhoto, setCurrentPhoto] = useState<string>(selectedPhotoUrl || CRAFT_PRESETS[0].enhancedImage);
  const [originalPhoto, setOriginalPhoto] = useState<string>(originalPhotoUrl || CRAFT_PRESETS[0].rawImage);
  const [isEnhancingUpload, setIsEnhancingUpload] = useState<boolean>(false);
  const [isPublishing, setIsPublishing] = useState<boolean>(false);
  const [publishingStep, setPublishingStep] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const t = (key: string) => translate(language, key);
  const isHindi = language === 'hi';

  const processVoiceExtraction = async (
    sampleText: string,
    baseExtracted: ExtractedProductAttributes,
    imageOverride?: string
  ) => {
    // 1. Reset previous session state
    setIsDiwaliGrounded(false);
    setDiwaliContextResult(null);
    setIsEnrichingWithDiwali(true);

    const imageToPass = imageOverride || currentPhoto || originalPhoto || selectedPhotoUrl;

    try {
      let finalAttributes: ExtractedProductAttributes = { ...baseExtracted };

      // 2. Vision Analysis (Gemini Vision / Edge Function / Fallback)
      let visionResult = null;
      if (imageToPass) {
        visionResult = await analyzeImageVisuals(imageToPass);
      }

      // SOURCE PRIORITY ARCHITECTURE:
      // Priority 1: Explicit Voice Match (artisan stated specific craft terms)
      // Priority 2: Gemini Vision (when voice is generic OR to supplement missing VISUAL attributes)
      // Priority 3: Neutral Fallback
      const isExplicitVoice = baseExtracted.isExplicitVoiceMatch;

      if (!isExplicitVoice && visionResult && visionResult.visualObjectType) {
        // Vision is authoritative for category/technique/material when voice is generic
        finalAttributes.category = visionResult.craftCategorySuggestion;
        finalAttributes.craftTechnique = visionResult.visualObjectType;
        finalAttributes.primaryMaterial = visionResult.apparentMaterial;
        finalAttributes.color = visionResult.visibleColors;
        finalAttributes.primaryColor = visionResult.visibleColors;
        finalAttributes.titleEn = visionResult.visualObjectType;
        finalAttributes.titleHi = visionResult.visualObjectType;
      }

      // Supplement VISUAL attributes from image where voice did not state them
      // (applies even when voice IS explicit — image fills in visual-only gaps)
      if (visionResult) {
        // Pattern & Motif: if artisan didn't state one, use image observation
        if (!finalAttributes.pattern && visionResult.visiblePatternsMotifs &&
            visionResult.visiblePatternsMotifs !== 'Traditional Motifs') {
          finalAttributes.pattern = visionResult.visiblePatternsMotifs;
        }
        if (!finalAttributes.motif && visionResult.visiblePatternsMotifs &&
            visionResult.visiblePatternsMotifs !== 'Traditional Motifs') {
          finalAttributes.motif = visionResult.visiblePatternsMotifs;
        }
        // Border color: supplement from image if artisan didn't state it
        if (!finalAttributes.borderColor && visionResult.visibleBorderColor) {
          finalAttributes.borderColor = visionResult.visibleBorderColor;
        }
        // Color: supplement from image ONLY if voice didn't state a color
        if (!baseExtracted.color || baseExtracted.color === 'Natural Finish') {
          if (visionResult.visibleColors && visionResult.visibleColors !== 'Natural Finish') {
            finalAttributes.color = visionResult.visibleColors;
            finalAttributes.primaryColor = visionResult.visibleColors;
          }
        }
      }

      // Dev diagnostics — console only, never shown in artisan UI
      if ((import.meta as any).env?.DEV) {
        console.group('[Shilp-AI] 🔍 Pipeline Debug');
        console.log('Voice match:', isExplicitVoice ? 'Explicit craft match' : 'Generic/vague (vision primary)');
        console.log('Final category:', finalAttributes.category);
        console.log('Craft technique:', finalAttributes.craftTechnique);
        console.log('weavingMethod:', finalAttributes.weavingMethod);
        console.log('constructionMethod:', finalAttributes.constructionMethod);
        console.log('pattern:', finalAttributes.pattern);
        console.log('borderColor:', finalAttributes.borderColor);
        console.log('dyeType:', finalAttributes.dyeType);
        console.log('zariType:', finalAttributes.zariType);
        console.log('fabricType:', finalAttributes.fabricType);
        console.log('visionResult:', visionResult);
        console.groupEnd();
      }

      setExtractedData(finalAttributes);

      // 3. DIWALI Retrieval (Supporting cultural evidence ONLY — NEVER classifies or overrides attributes)
      const diwaliRes = await retrieveCulturalContext({
        category: finalAttributes.category,
        craftTechnique: finalAttributes.craftTechnique,
        primaryMaterial: finalAttributes.primaryMaterial,
        titleEn: finalAttributes.titleEn,
        titleHi: finalAttributes.titleHi,
        visualObjectType: visionResult?.visualObjectType,
        keywords: visionResult?.keywords
      });

      const diwaliContextStr = diwaliRes
        ? diwaliRes.contextString
        : 'No specific cultural heritage match in dataset for this item.';

      setDiwaliContextResult(diwaliRes);

      // Dev diagnostics for DIWALI
      if ((import.meta as any).env?.DEV) {
        console.log('[Shilp-AI] 🏺 DIWALI match:', diwaliRes
          ? `${diwaliRes.matchedConcept} (score: ${diwaliRes.score})`
          : 'null (no match / below threshold)');
      }

      // 4. Cultural Description Generation (Supabase Edge Function / Gemini / OpenRouter -> Structured Fallback)
      let enhanced: any = null;
      try {
        if (hasGeminiApiKey() || hasOpenRouterApiKey() || Boolean(supabase)) {
          enhanced = await generateCulturalDescription(
            {
              category: finalAttributes.category,
              craftTechnique: finalAttributes.craftTechnique,
              primaryMaterial: finalAttributes.primaryMaterial,
              productionDays: finalAttributes.productionDays,
              rawMaterialCost: finalAttributes.rawMaterialCost,
              color: finalAttributes.color,
              titleEn: finalAttributes.titleEn,
              titleHi: finalAttributes.titleHi,
              // Pass all rich artisan-provided attributes
              productType: finalAttributes.productType,
              style: finalAttributes.style,
              subject: finalAttributes.subject,
              weavingMethod: finalAttributes.weavingMethod,
              constructionMethod: finalAttributes.constructionMethod,
              pattern: finalAttributes.pattern,
              motif: finalAttributes.motif,
              borderColor: finalAttributes.borderColor,
              dyeType: finalAttributes.dyeType,
              zariType: finalAttributes.zariType,
              fabricType: finalAttributes.fabricType,
              artisanClaims: finalAttributes.artisanClaims,
            },
            diwaliContextStr,
            imageToPass
          );
        }
      } catch (err) {
        console.warn('Cultural pipeline error:', err);
      }

      // Guarantee fallback description execution if AI is unavailable or returned placeholder
      if (!enhanced || !enhanced.descriptionEn || enhanced.descriptionEn === 'Generating catalog description…') {
        enhanced = buildFallbackDescription(
          {
            category: finalAttributes.category,
            craftTechnique: finalAttributes.craftTechnique,
            primaryMaterial: finalAttributes.primaryMaterial,
            productionDays: finalAttributes.productionDays,
            rawMaterialCost: finalAttributes.rawMaterialCost,
            color: finalAttributes.color,
            titleEn: finalAttributes.titleEn,
            titleHi: finalAttributes.titleHi,
            productType: finalAttributes.productType,
            style: finalAttributes.style,
            subject: finalAttributes.subject,
            weavingMethod: finalAttributes.weavingMethod,
            constructionMethod: finalAttributes.constructionMethod,
            pattern: finalAttributes.pattern,
            motif: finalAttributes.motif,
            borderColor: finalAttributes.borderColor,
            dyeType: finalAttributes.dyeType,
            zariType: finalAttributes.zariType,
            fabricType: finalAttributes.fabricType,
            artisanClaims: finalAttributes.artisanClaims,
          },
          diwaliContextStr
        );
      }

      if (enhanced) {
        setExtractedData(prev => {
          const base = prev || finalAttributes;
          return {
            ...base,
            titleEn: enhanced.titleEn || base.titleEn,
            titleHi: enhanced.titleHi || base.titleHi,
            descriptionEn: enhanced.descriptionEn,
            descriptionHi: enhanced.descriptionHi,
            culturalContext: enhanced.culturalContext || (diwaliRes ? diwaliRes.contextString : undefined),
            seoKeywords: enhanced.seoKeywords || base.seoKeywords,
            searchTags: enhanced.searchTags || (enhanced.seoKeywords || base.seoKeywords),
            metaDescription: enhanced.metaDescription || enhanced.descriptionEn || base.descriptionEn
          };
        });
        setIsDiwaliGrounded(true);
      }
    } catch (err) {
      console.warn('Cultural pipeline exception:', err);
    } finally {
      setIsEnrichingWithDiwali(false);
    }
  };


  // Sync selected photo prop and reset session attributes
  useEffect(() => {
    if (selectedPhotoUrl) {
      setCurrentPhoto(selectedPhotoUrl);
      setExtractedData(null);
      setDiwaliContextResult(null);
      setIsDiwaliGrounded(false);
      latestTranscriptRef.current = '';
      setTranscript('');
    }
    if (originalPhotoUrl) {
      setOriginalPhoto(originalPhotoUrl);
    }
  }, [selectedPhotoUrl, originalPhotoUrl]);

  // Sync language code when language prop changes
  useEffect(() => {
    setSelectedLangCode(getSpeechLangCode(language));
  }, [language]);

  // Ref to track latest transcript for recognition.onend
  const latestTranscriptRef = useRef('');

  // Initialize Web Speech Recognition
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = selectedLangCode;

      recognition.onresult = (event: any) => {
        let finalTranscript = '';
        let interimTranscript = '';
        for (let i = 0; i < event.results.length; i++) {
          const res = event.results[i];
          if (res.isFinal) {
            finalTranscript += res[0].transcript + ' ';
          } else {
            interimTranscript += res[0].transcript;
          }
        }
        const fullTranscript = (finalTranscript + interimTranscript).trim();
        setTranscript(fullTranscript);
        latestTranscriptRef.current = fullTranscript;
        // Update basic extracted attributes locally during live speech (NO Gemini API calls while speaking)
        const extracted = VoiceCatalogerEngine.extractAttributesFromSpeech(fullTranscript);
        setExtractedData(extracted);
      };

      recognition.onend = () => {
        setIsRecording(false);
        // Execute single final Gemini RAG call only when speech finishes
        const finalText = latestTranscriptRef.current;
        if (finalText && finalText.trim()) {
          const extracted = VoiceCatalogerEngine.extractAttributesFromSpeech(finalText);
          processVoiceExtraction(finalText, extracted);
        }
      };

      recognition.onerror = (event: any) => {
        console.warn('Speech recognition error:', event.error);
        setIsRecording(false);
      };

      setRecognitionInstance(recognition);
    }
  }, [selectedLangCode]);

  const toggleRecording = () => {
    if (isRecording) {
      recognitionInstance?.stop();
      setIsRecording(false);
      const finalText = latestTranscriptRef.current;
      if (finalText && finalText.trim()) {
        const extracted = VoiceCatalogerEngine.extractAttributesFromSpeech(finalText);
        processVoiceExtraction(finalText, extracted);
      }
    } else {
      setTranscript('');
      latestTranscriptRef.current = '';
      try {
        recognitionInstance?.start();
        setIsRecording(true);
      } catch (e) {
        // Fallback simulated recording if browser blocks mic
        setIsRecording(true);
        setTimeout(() => {
          handleSelectSample(CRAFT_PRESETS[0].sampleVoiceHindi);
          setIsRecording(false);
        }, 1500);
      }
    }
  };

  const handleSelectSample = (sampleText: string) => {
    setTranscript(sampleText);
    latestTranscriptRef.current = sampleText;
    const extracted = VoiceCatalogerEngine.extractAttributesFromSpeech(sampleText);
    processVoiceExtraction(sampleText, extracted);
  };

  const handleToggleSpeak = async (text: string, langCode: string) => {
    if (isSpeaking) {
      VoiceCatalogerEngine.stopSpeaking();
      setIsSpeaking(false);
      // Keep spokenCatalogTranscript intact so user can read what was spoken!
      return;
    }

    setSpokenCatalogTranscript(text);
    setIsSpeaking(true);
    try {
      await VoiceCatalogerEngine.speak(text, langCode as any);
    } catch (err) {
      console.warn('Voice speak error:', err);
    } finally {
      setIsSpeaking(false);
    }
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        if (event.target?.result) {
          const rawUrl = event.target.result as string;
          setOriginalPhoto(rawUrl);
          setIsEnhancingUpload(true);
          let newImageToPass = rawUrl;
          try {
            const res = await AIImageStudio.processImage(rawUrl, DEFAULT_IMAGE_OPTIONS);
            newImageToPass = res.enhancedDataUrl;
            setCurrentPhoto(newImageToPass);
          } catch {
            setCurrentPhoto(rawUrl);
          } finally {
            setIsEnhancingUpload(false);
            if (extractedData) {
              processVoiceExtraction(
                latestTranscriptRef.current || CRAFT_PRESETS[0].sampleVoiceHindi,
                extractedData,
                newImageToPass
              );
            }
          }
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleCreateListing = async () => {
    if (!extractedData) return;
    setIsPublishing(true);
    setPublishingStep(isHindi ? 'एआई फोटो संवर्धन जांच रहे हैं...' : 'Verifying AI image enhancement...');

    try {
      const productId = `prod-${Date.now()}`;
      
      // Step 1: AI Enhancement (background removal, lighting correction, 1:1 canvas)
      let enhancedUrl = currentPhoto;
      let rawUrl = originalPhoto || currentPhoto;

      if (!enhancedUrl || enhancedUrl === rawUrl) {
        setPublishingStep(isHindi ? 'एआई पृष्ठभूमि हटाना व लाइटिंग सुधार रहे हैं...' : 'Applying AI background removal & studio lighting...');
        try {
          const res = await AIImageStudio.processImage(rawUrl, DEFAULT_IMAGE_OPTIONS);
          enhancedUrl = res.enhancedDataUrl;
          setCurrentPhoto(enhancedUrl);
        } catch (e) {
          console.warn('AI enhancement fallback:', e);
        }
      }

      // Step 2: Upload to Firebase Storage
      setPublishingStep(isHindi ? 'फायरबेस स्टोरेज में मूल फोटो अपलोड हो रही है...' : 'Uploading original image to Firebase Storage...');
      const originalStorageUrl = await uploadImageToStorage(
        rawUrl,
        `products/original/${productId}.jpg`
      );

      setPublishingStep(isHindi ? 'फायरबेस स्टोरेज में एआई फोटो अपलोड हो रही है...' : 'Uploading enhanced image to Firebase Storage...');
      const enhancedStorageUrl = await uploadImageToStorage(
        enhancedUrl,
        `products/enhanced/${productId}.jpg`
      );

      // Step 3: XGBoost Fair Pricing Calculation
      setPublishingStep(isHindi ? 'XGBoost मॉडल द्वारा उचित मूल्य तय किया जा रहा है...' : 'Calculating fair pricing via XGBoost Regressor...');
      const pricing = DynamicPricingEngine.calculatePricing({
        category: extractedData.category,
        craftTechnique: extractedData.craftTechnique,
        primaryMaterial: extractedData.primaryMaterial,
        rawMaterialCost: extractedData.rawMaterialCost,
        productionDays: extractedData.productionDays,
        isGICertified: true
      });

      const listing: ProductListing = {
        id: productId,
        artisanId: CURRENT_ARTISAN.id, // UUID: '00000000-0000-0000-0000-000000000101' (demo) or currentUser.id
        artisanName: CURRENT_ARTISAN.name,
        state: CURRENT_ARTISAN.state,
        titleEn: extractedData.titleEn,
        titleHi: extractedData.titleHi,
        category: extractedData.category,
        craftTechnique: extractedData.craftTechnique,
        primaryMaterial: extractedData.primaryMaterial,
        color: extractedData.color,
        productionDays: extractedData.productionDays,
        rawMaterialCost: extractedData.rawMaterialCost,
        // Store both original and enhanced image URLs
        originalImage: originalStorageUrl,
        originalImageUrl: originalStorageUrl,
        enhancedImage: enhancedStorageUrl,
        enhancedImageUrl: enhancedStorageUrl,
        hasBackgroundRemoved: true,
        hasLightingEnhanced: true,
        descriptionEn: extractedData.descriptionEn,
        descriptionHi: extractedData.descriptionHi,
        culturalContext: extractedData.culturalContext || diwaliContextResult?.contextString,
        seoKeywords: extractedData.seoKeywords,
        searchTags: extractedData.searchTags || extractedData.seoKeywords,
        metaDescription: extractedData.metaDescription || extractedData.descriptionEn,
        pricing: pricing,
        targetBuyers: extractedData.targetBuyers,
        stockQuantity: 15,
        giCertified: true,
        createdAt: new Date().toISOString().split('T')[0],
        // Rich structured artisan attributes persistence
        productType: extractedData.productType || undefined,
        style: extractedData.style || undefined,
        subject: extractedData.subject || undefined,
        weavingMethod: extractedData.weavingMethod || undefined,
        constructionMethod: extractedData.constructionMethod || undefined,
        pattern: extractedData.pattern || undefined,
        motif: extractedData.motif || undefined,
        borderColor: extractedData.borderColor || undefined,
        dyeType: extractedData.dyeType || undefined,
        zariType: extractedData.zariType || undefined,
        fabricType: extractedData.fabricType || undefined,
        artisanClaims: extractedData.artisanClaims?.length ? extractedData.artisanClaims : undefined
      };

      // Step 4: Hand off to ProductSubmitReview (preferred) or save directly (fallback)
      if (onReadyForReview) {
        // Smart Catalog flow: pass to final review step
        onReadyForReview(listing);
      } else {
        // Standalone mode: save to Supabase directly
        setPublishingStep(isHindi ? 'सुपाबेस में कैटलॉग सहेजा जा रहा है...' : 'Saving listing to Supabase...');
        await saveProductToSupabase(listing);
        // Step 5: Update Local App & State
        onListingCreated?.(listing);
      }
    } catch (err) {
      console.error('Failed to create listing:', err);
      alert(isHindi ? 'कैटलॉग प्रकाशित करने में समस्या आई। पुनः प्रयास करें।' : 'Error publishing product. Please try again.');
    } finally {
      setIsPublishing(false);
      setPublishingStep('');
    }
  };

  return (
    <div className="space-y-5">
      {/* Banner */}
      <div className="bg-stone-900 rounded-2xl p-5 text-white border border-stone-800 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-0.5 rounded-full bg-white/10 backdrop-blur text-amber-300">
              <Sparkles className="w-3.5 h-3.5" />
              {isHindi ? 'बहुभाषी वॉयस एनएलपी इंजन' : 'Multilingual Voice & NLP Auto-Cataloger'}
            </span>
            <h2 className="text-xl sm:text-2xl font-black">
              {isHindi ? 'बोलकर कैटलॉग बनाएं (Voice to Catalog)' : 'Speak to Generate Smart Catalog'}
            </h2>
            <p className="text-xs sm:text-sm text-stone-300 max-w-xl">
              {isHindi
                ? 'अपनी क्षेत्रीय भाषा में बोलें। एआई उत्पाद का नाम, सामग्री, दिन व लागत पहचानकर अंग्रेजी व हिंदी विवरण तैयार करेगा।'
                : 'Describe your craft in your mother tongue. AI extracts attributes, translates, and generates SEO-ready Hindi & English catalogs while keeping your original photo untouched.'}
            </p>
          </div>
          <div className="hidden sm:block">
            <div className="w-16 h-16 rounded-2xl bg-white/10 backdrop-blur border border-white/20 flex items-center justify-center text-3xl">
              🎙️
            </div>
          </div>
        </div>
      </div>

      {/* Product Photo Confirmation Card: AI Enhanced Studio Photo vs Original Raw Photo with 5 Feature Badges */}
      <div className="bg-white rounded-3xl p-4 sm:p-5 shadow-sm border border-stone-200 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-xl bg-emerald-100 text-emerald-800">
              <Sparkles className="w-4 h-4 text-emerald-600" />
            </span>
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="text-xs sm:text-sm font-bold text-stone-900">
                  {isHindi ? 'एआई स्टूडियो: पहले और बाद की तुलना (Before & After)' : 'AI Image Studio: Before & After Comparison'}
                </h3>
                <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full flex items-center gap-0.5">
                  <Sparkles className="w-2.5 h-2.5 text-emerald-600" />
                  {isHindi ? 'स्टूडियो ग्रेड' : 'Studio-Grade'}
                </span>
              </div>
              <p className="text-[11px] text-stone-500 leading-tight">
                {isHindi 
                  ? 'स्वच्छ पृष्ठभूमि और स्टूडियो लाइटिंग वाली फोटो कैटलॉग और खरीदार पोर्टल पर दिखाई देगी।'
                  : 'Studio-enhanced photo will be published to the catalog while preserving authentic craft textures.'}
              </p>
            </div>
          </div>

          {/* Change / Upload Photo Button */}
          <div className="flex items-center space-x-2 shrink-0">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handlePhotoUpload}
              accept="image/*"
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isEnhancingUpload}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border border-stone-200 hover:bg-stone-50 text-stone-700 text-xs font-semibold transition-colors disabled:opacity-50 shadow-2xs"
            >
              {isEnhancingUpload ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 text-stone-500 animate-spin" />
                  <span>{isHindi ? 'संवर्धन हो रहा है...' : 'Enhancing...'}</span>
                </>
              ) : (
                <>
                  <Upload className="w-3.5 h-3.5 text-stone-500" />
                  <span>{isHindi ? 'फोटो बदलें' : 'Change Photo'}</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Dual Images Showcase Card */}
        <div className="rounded-2xl overflow-hidden border border-stone-200 bg-[#FAF7F2] shadow-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-0 border-b border-stone-200">
            {/* Before (Original) */}
            <div className="relative aspect-[4/3] sm:aspect-[3/4] max-h-64 sm:max-h-72 bg-stone-100 overflow-hidden sm:border-r border-stone-200 flex items-center justify-center">
              <img
                src={originalPhoto || currentPhoto}
                alt="Before (Original Raw Craft)"
                className="w-full h-full object-cover"
              />
              <div className="absolute top-2.5 left-2.5 bg-[#2D3338]/90 backdrop-blur text-white text-[10px] sm:text-[11px] font-medium px-2.5 py-0.5 rounded-full shadow-sm">
                {isHindi ? 'पहले (मूल फोटो)' : 'Before (Original)'}
              </div>
            </div>

            {/* After (Enhanced) */}
            <div className="relative aspect-[4/3] sm:aspect-[3/4] max-h-64 sm:max-h-72 bg-[#FAF7F2] overflow-hidden flex items-center justify-center">
              <img
                src={currentPhoto}
                alt="After (Enhanced Studio Photo)"
                className="w-full h-full object-cover"
              />
              <div className="absolute top-2.5 left-2.5 bg-[#2D5A43]/90 backdrop-blur text-white text-[10px] sm:text-[11px] font-medium px-2.5 py-0.5 rounded-full shadow-sm flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-amber-300" />
                <span>{isHindi ? 'बाद में (एआई संवर्धित)' : 'After (Enhanced)'}</span>
              </div>
            </div>
          </div>

          {/* 5 Feature Badges Row matching User Reference */}
          <div className="bg-[#FAF7F2] px-2 sm:px-4 py-3 grid grid-cols-5 gap-1 sm:gap-2 items-center justify-between text-center">
            {/* 1. Background Removal */}
            <div className="flex flex-col items-center justify-center space-y-1">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-white border border-stone-200/80 flex items-center justify-center text-stone-700 shadow-2xs">
                <Scissors className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-stone-700" />
              </div>
              <span className="text-[9px] sm:text-[10px] font-medium text-stone-700 leading-tight">
                {isHindi ? <>बैकग्राउंड<br />हटाना</> : <>Background<br />Removal</>}
              </span>
            </div>

            {/* 2. Better Lighting */}
            <div className="flex flex-col items-center justify-center space-y-1">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-white border border-stone-200/80 flex items-center justify-center text-stone-700 shadow-2xs">
                <SunMedium className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-stone-700" />
              </div>
              <span className="text-[9px] sm:text-[10px] font-medium text-stone-700 leading-tight">
                {isHindi ? <>बेहतर<br />लाइटिंग</> : <>Better<br />Lighting</>}
              </span>
            </div>

            {/* 3. Natural Color Correction */}
            <div className="flex flex-col items-center justify-center space-y-1">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-white border border-stone-200/80 flex items-center justify-center text-stone-700 shadow-2xs">
                <Palette className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-stone-700" />
              </div>
              <span className="text-[9px] sm:text-[10px] font-medium text-stone-700 leading-tight">
                {isHindi ? <>प्राकृतिक रंग<br />सुधार</> : <>Natural Color<br />Correction</>}
              </span>
            </div>

            {/* 4. Proper Positioning & Cropping */}
            <div className="flex flex-col items-center justify-center space-y-1">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-white border border-stone-200/80 flex items-center justify-center text-stone-700 shadow-2xs">
                <Crop className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-stone-700" />
              </div>
              <span className="text-[9px] sm:text-[10px] font-medium text-stone-700 leading-tight">
                {isHindi ? <>उचित स्थिति<br />व क्रॉपिंग</> : <>Proper Positioning<br />& Cropping</>}
              </span>
            </div>

            {/* 5. Enhanced Quality */}
            <div className="flex flex-col items-center justify-center space-y-1">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-white border border-stone-200/80 flex items-center justify-center text-stone-700 shadow-2xs">
                <Sparkles className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-emerald-600" />
              </div>
              <span className="text-[9px] sm:text-[10px] font-medium text-stone-700 leading-tight">
                {isHindi ? <>संवर्धित<br />गुणवत्ता</> : <>Enhanced<br />Quality</>}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Voice Recording Stage */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-stone-200 text-center space-y-4">
        {/* Language Pill Selector */}
        <div className="flex items-center justify-center space-x-2 flex-wrap gap-1">
          <span className="text-xs text-stone-500 font-medium flex items-center gap-1">
            <Globe className="w-3.5 h-3.5" />
            {isHindi ? 'बोलने की भाषा:' : 'Spoken Language:'}
          </span>
          {[
            { code: 'hi-IN', label: 'हिन्दी (Hindi)' },
            { code: 'en-IN', label: 'English' },
            { code: 'te-IN', label: 'తెలుగు (Telugu)' },
            { code: 'ta-IN', label: 'தமிழ் (Tamil)' },
            { code: 'bn-IN', label: 'বাংলা (Bengali)' },
            { code: 'mr-IN', label: 'मराठी (Marathi)' },
            { code: 'gu-IN', label: 'ગુજરાતી (Gujarati)' },
          ].map((lang) => (
            <button
              key={lang.code}
              onClick={() => setSelectedLangCode(lang.code)}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                selectedLangCode === lang.code
                  ? 'bg-saffron-600 text-white shadow-sm'
                  : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
              }`}
            >
              {lang.label}
            </button>
          ))}
        </div>

        {/* Big Pulsing Mic Button */}
        <div className="py-3 flex flex-col items-center justify-center">
          <button
            onClick={toggleRecording}
            className={`w-24 h-24 rounded-full flex items-center justify-center text-white shadow-xl transition-all duration-300 transform active:scale-95 ${
              isRecording
                ? 'bg-red-600 ring-8 ring-red-200 animate-pulse scale-105'
                : 'bg-gradient-to-tr from-saffron-600 to-amber-500 hover:from-saffron-700 hover:to-amber-600 shadow-saffron-600/30 hover:scale-105'
            }`}
          >
            {isRecording ? <MicOff className="w-10 h-10" /> : <Mic className="w-10 h-10" />}
          </button>
          <span className="mt-3 text-xs font-bold text-stone-700">
            {isRecording
              ? (isHindi ? '🔴 सुन रहा हूँ... बोलिए' : '🔴 Listening... Speak now!')
              : (isHindi ? 'माइक दबाएं और अपने शिल्प के बारे में बोलें' : 'Tap Microphone to Speak')}
          </span>
        </div>

        {/* Quick Sample Voice Prompts */}
        <div className="space-y-1.5 pt-2 border-t border-stone-100 text-left">
          <span className="text-[11px] font-bold text-stone-600 uppercase tracking-wider">
            {isHindi ? 'या त्वरित नमूना आवाज चुनें (Quick Voice Samples):' : 'Or Try Sample Artisan Voice Note:'}
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              onClick={() => handleSelectSample(CRAFT_PRESETS[0].sampleVoiceHindi)}
              className="p-2 rounded-xl bg-stone-50 hover:bg-saffron-50 border border-stone-200 hover:border-saffron-300 text-left text-xs transition-colors"
            >
              <div className="font-semibold text-stone-800 flex items-center gap-1.5">
                <span>🥻 पोचमपल्ली रेशम साड़ी</span>
                <span className="text-[10px] text-saffron-700 font-normal">(5 दिन, ₹2,500)</span>
              </div>
              <p className="text-[11px] text-stone-500 line-clamp-1 mt-0.5">
                "{CRAFT_PRESETS[0].sampleVoiceHindi}"
              </p>
            </button>

            <button
              onClick={() => handleSelectSample(CRAFT_PRESETS[1].sampleVoiceHindi)}
              className="p-2 rounded-xl bg-stone-50 hover:bg-saffron-50 border border-stone-200 hover:border-saffron-300 text-left text-xs transition-colors"
            >
              <div className="font-semibold text-stone-800 flex items-center gap-1.5">
                <span>🐂 बस्तर ढोकरा नंदी</span>
                <span className="text-[10px] text-saffron-700 font-normal">(4 दिन, ₹1,200)</span>
              </div>
              <p className="text-[11px] text-stone-500 line-clamp-1 mt-0.5">
                "{CRAFT_PRESETS[1].sampleVoiceHindi}"
              </p>
            </button>
          </div>
        </div>

        {/* Live Audio Transcript Box */}
        {transcript && (
          <div className="p-3 bg-amber-50/60 rounded-xl border border-amber-200 text-left space-y-1">
            <span className="text-[10px] font-bold text-amber-800 uppercase tracking-wider">
              {isHindi ? 'सुनी गई वाणी (Transcribed Speech):' : 'Spoken Voice Transcription:'}
            </span>
            <p className="text-xs text-stone-800 italic">"{transcript}"</p>
          </div>
        )}
      </div>

      {/* Extracted Attributes & Smart Catalog Card */}
      {extractedData && (() => {
        const productDetails = [
          { label: isHindi ? 'उत्पाद (Product)' : 'Product', value: extractedData.productType },
          { label: isHindi ? 'शैली (Style)' : 'Style', value: extractedData.style },
          { label: isHindi ? 'विषय / आकृति' : 'Subject', value: extractedData.subject },
          { label: isHindi ? 'रंग (Color)' : 'Color', value: extractedData.color !== 'Natural Finish' ? extractedData.color : null },
          { label: isHindi ? 'सामग्री (Material)' : 'Material', value: extractedData.fabricType || (extractedData.primaryMaterial !== 'Authentic Artisan Material' ? extractedData.primaryMaterial : null) },
          { label: isHindi ? 'बुनाई (Weaving)' : 'Weaving', value: extractedData.weavingMethod },
          { label: isHindi ? 'तकनीक / निर्माण' : 'Crafting Technique', value: extractedData.constructionMethod || (extractedData.craftTechnique !== 'Traditional Handcrafted Artistry' ? extractedData.craftTechnique : null) },
          { label: isHindi ? 'पैटर्न (Pattern)' : 'Pattern', value: extractedData.pattern },
          { label: isHindi ? 'डिज़ाइन (Design)' : 'Design Motif', value: extractedData.motif },
          { label: isHindi ? 'बॉर्डर (Border)' : 'Border', value: extractedData.borderColor },
          { label: isHindi ? 'रंगाई (Dye Type)' : 'Dye Type', value: extractedData.dyeType },
          { label: isHindi ? 'ज़री (Zari)' : 'Zari', value: extractedData.zariType },
          { label: isHindi ? 'फिनिश (Finish)' : 'Finish', value: extractedData.finish },
          { label: isHindi ? 'श्रम समय (Time)' : 'Crafting Time', value: extractedData.productionDays > 0 ? `${extractedData.productionDays} ${isHindi ? 'दिन' : 'Days'}` : null },
          { label: isHindi ? 'कच्चा माल (Raw Cost)' : 'Raw Material Cost', value: extractedData.rawMaterialCost > 0 ? `₹${extractedData.rawMaterialCost.toLocaleString('en-IN')}` : null },
        ].filter((item): item is { label: string; value: string } => Boolean(item.value));

        return (
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-stone-200 space-y-5">
            <div className="flex items-center justify-between border-b border-stone-100 pb-3">
              <div className="flex items-center space-x-2">
                <span className="p-1.5 rounded-lg bg-saffron-100 text-saffron-800">
                  <Sparkles className="w-4 h-4" />
                </span>
                <div>
                  <h3 className="font-bold text-stone-900 text-base">
                    {isHindi ? 'उत्पाद विवरण' : 'PRODUCT DETAILS'}
                  </h3>
                  <p className="text-xs text-stone-500">
                    {isHindi ? 'वाणी व चित्र से निष्कर्षित प्रमाणिक उत्पाद विवरण' : 'Extracted from artisan speech and product image'}
                  </p>
                </div>
              </div>
              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                {extractedData.category !== 'Other Heritage Craft' ? extractedData.category : (isHindi ? 'हस्तशिल्प' : 'Handicraft')}
              </span>
            </div>

            {/* Dynamic Point-wise Product Details Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 text-xs">
              {productDetails.map((item, idx) => (
                <div key={idx} className="bg-stone-50 p-2.5 rounded-xl border border-stone-100 flex flex-col justify-between">
                  <span className="text-stone-400 text-[10px] font-semibold uppercase tracking-wider">{item.label}</span>
                  <p className="font-bold text-stone-900 text-xs mt-0.5">{item.value}</p>
                </div>
              ))}
            </div>

            {/* Heritage Story Section */}
            <div className="space-y-3 pt-2 border-t border-stone-100">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <span className="p-1 rounded bg-amber-100 text-amber-800">
                    <BookOpen className="w-3.5 h-3.5" />
                  </span>
                  <span className="text-xs font-bold text-stone-800 uppercase tracking-wider">
                    {isHindi ? 'सांस्कृतिक विरासत कथा' : 'HERITAGE STORY'}
                  </span>
                </div>
                {isEnrichingWithDiwali ? (
                  <span className="text-[11px] font-medium text-amber-700 flex items-center gap-1.5 animate-pulse">
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    {isHindi ? 'सांस्कृतिक कहानी तैयार हो रही है...' : 'Crafting cultural story...'}
                  </span>
                ) : isDiwaliGrounded ? (
                  <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-emerald-600" />
                    {isHindi ? 'धरोहर सत्यापित' : 'Culturally Grounded'}
                  </span>
                ) : null}
              </div>

              {/* Dual Description Tabs (Hindi / English) */}
              <div className="flex border-b border-stone-200">
                <button
                  onClick={() => setActiveTab('hindi')}
                  className={`pb-2 px-4 text-xs font-bold transition-all border-b-2 flex items-center gap-1.5 ${
                    activeTab === 'hindi'
                      ? 'border-saffron-600 text-saffron-700'
                      : 'border-transparent text-stone-500 hover:text-stone-800'
                  }`}
                >
                  <span>🇮🇳 हिन्दी विवरण</span>
                </button>
                <button
                  onClick={() => setActiveTab('english')}
                  className={`pb-2 px-4 text-xs font-bold transition-all border-b-2 flex items-center gap-1.5 ${
                    activeTab === 'english'
                      ? 'border-saffron-600 text-saffron-700'
                      : 'border-transparent text-stone-500 hover:text-stone-800'
                  }`}
                >
                  <span>🇬🇧 English Catalog</span>
                </button>
              </div>

              {activeTab === 'hindi' ? (
                <div className="p-3.5 bg-saffron-50/40 rounded-xl border border-saffron-200/60 space-y-2">
                  <div className="flex justify-between items-center gap-2">
                    <h4 className="font-bold text-stone-900 text-sm">{extractedData.titleHi}</h4>
                    <button
                      onClick={() => handleToggleSpeak(extractedData.descriptionHi, 'hi-IN')}
                      className={`flex items-center space-x-1.5 px-3 py-1 rounded-lg text-xs font-semibold shadow-xs transition-all ${
                        isSpeaking && spokenCatalogTranscript === extractedData.descriptionHi
                          ? 'bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 ring-2 ring-red-300 animate-pulse'
                          : 'bg-saffron-100/90 text-saffron-900 border border-saffron-300/80 hover:bg-saffron-200'
                      }`}
                    >
                      {isSpeaking && spokenCatalogTranscript === extractedData.descriptionHi ? (
                        <>
                          <Square className="w-3.5 h-3.5 fill-red-600 text-red-600" />
                          <span>रुकें</span>
                        </>
                      ) : (
                        <>
                          <Volume2 className="w-3.5 h-3.5 text-saffron-700" />
                          <span>सुनें</span>
                        </>
                      )}
                    </button>
                  </div>
                  <p className="text-xs text-stone-700 leading-relaxed whitespace-pre-line">
                    {extractedData.descriptionHi}
                  </p>
                </div>
              ) : (
                <div className="p-3.5 bg-blue-50/40 rounded-xl border border-blue-200/60 space-y-2">
                  <div className="flex justify-between items-center gap-2">
                    <h4 className="font-bold text-stone-900 text-sm">{extractedData.titleEn}</h4>
                    <button
                      onClick={() => handleToggleSpeak(extractedData.descriptionEn, 'en-IN')}
                      className={`flex items-center space-x-1.5 px-3 py-1 rounded-lg text-xs font-semibold shadow-xs transition-all ${
                        isSpeaking && spokenCatalogTranscript === extractedData.descriptionEn
                          ? 'bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 ring-2 ring-red-300 animate-pulse'
                          : 'bg-blue-100/90 text-blue-900 border border-blue-300/80 hover:bg-blue-200'
                      }`}
                    >
                      {isSpeaking && spokenCatalogTranscript === extractedData.descriptionEn ? (
                        <>
                          <Square className="w-3.5 h-3.5 fill-red-600 text-red-600" />
                          <span>Stop</span>
                        </>
                      ) : (
                        <>
                          <Volume2 className="w-3.5 h-3.5 text-blue-700" />
                          <span>Listen</span>
                        </>
                      )}
                    </button>
                  </div>
                  <p className="text-xs text-stone-700 leading-relaxed whitespace-pre-line">
                    {extractedData.descriptionEn}
                  </p>
                </div>
              )}
            </div>
              {/* Dedicated Audio Transcription Card when AI is Speaking or Stopped */}
              {spokenCatalogTranscript && (
                <div className="p-3 bg-amber-50/70 rounded-xl border border-amber-200 text-stone-800 space-y-2 animate-in fade-in duration-200 shadow-xs">
                  <div className="flex items-center justify-between text-[11px] font-bold border-b border-amber-200/80 pb-1.5">
                    <span className="flex items-center gap-1.5 text-amber-900">
                      <FileText className="w-3.5 h-3.5 text-amber-700" />
                      {isHindi ? 'AI ऑडियो ट्रांसक्रिप्शन (Live Audio Transcript):' : 'AI Speech Audio Transcription:'}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold flex items-center gap-1 ${
                        isSpeaking ? 'bg-red-100 text-red-700 animate-pulse border border-red-200' : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${isSpeaking ? 'bg-red-500' : 'bg-emerald-500'}`}></span>
                        {isSpeaking ? (isHindi ? 'AI बोल रहा है...' : 'AI Speaking...') : (isHindi ? 'रोका गया / पढ़ने के लिए तैयार' : 'Stopped / Ready to Read')}
                      </span>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(spokenCatalogTranscript);
                          setIsTranscriptCopied(true);
                          setTimeout(() => setIsTranscriptCopied(false), 2000);
                        }}
                        className="text-stone-500 hover:text-stone-800 p-1 rounded hover:bg-amber-100/80 transition-colors"
                        title={isHindi ? 'प्रतिलिपि कॉपी करें' : 'Copy transcript'}
                      >
                        {isTranscriptCopied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        onClick={() => {
                          if (isSpeaking) {
                            VoiceCatalogerEngine.stopSpeaking();
                            setIsSpeaking(false);
                          }
                          setSpokenCatalogTranscript(null);
                        }}
                        className="text-stone-400 hover:text-stone-700 p-1 rounded hover:bg-amber-100/80 transition-colors"
                        title="Dismiss"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-stone-700 font-mono leading-relaxed bg-white/70 p-2.5 rounded-lg border border-amber-200/50 select-text">
                    "{spokenCatalogTranscript}"
                  </p>
                  <div className="flex items-center justify-between text-[10px] text-stone-500 pt-0.5">
                    <span>{isHindi ? '💡 ध्यान से सुनने या पढ़ने के लिए प्ले/स्टॉप का उपयोग करें।' : '💡 Listen carefully or read the exact speech transcript above.'}</span>
                    {isTranscriptCopied && <span className="text-emerald-700 font-semibold">{isHindi ? 'कॉपी कर लिया गया!' : 'Transcript copied!'}</span>}
                  </div>
                </div>
              )}

              {/* Search Keywords & Tags */}
              <div className="space-y-1.5 border-t border-stone-100 pt-3">
                <span className="text-[11px] font-bold text-stone-600 uppercase tracking-wider flex items-center gap-1">
                  <Tag className="w-3 h-3 text-stone-400" />
                  {isHindi ? 'स्वचालित खोज टैग्स (SEO Keywords):' : 'Generated Search Keywords:'}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {extractedData.seoKeywords.map((kw, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 rounded-md bg-stone-100 text-stone-700 text-[11px] font-medium border border-stone-200"
                    >
                      #{kw}
                    </span>
                  ))}
                </div>
              </div>

              {/* Publish / Add to Catalog Button */}
              <div className="pt-3 border-t border-stone-100 flex flex-col sm:flex-row items-center justify-between gap-3">
                {isPublishing ? (
                  <div className="flex items-center gap-2 text-xs text-stone-700 bg-amber-50/80 px-3.5 py-2 rounded-xl border border-amber-200/80 w-full sm:w-auto animate-pulse">
                    <RefreshCw className="w-3.5 h-3.5 text-amber-700 animate-spin shrink-0" />
                    <span className="font-semibold text-[11px] truncate">{publishingStep}</span>
                  </div>
                ) : (
                  <div className="text-[11px] text-stone-500 hidden sm:block">
                    <span>{isHindi ? 'मूल व एआई संवर्धित दोनों फोटो फायरबेस पर सुरक्षित होंगी।' : 'Original & AI enhanced images will be saved to Firebase Storage.'}</span>
                  </div>
                )}

                <button
                  onClick={handleCreateListing}
                  disabled={isPublishing}
                  className="w-full sm:w-auto flex items-center justify-center space-x-2 px-6 py-3 rounded-xl bg-stone-900 hover:bg-stone-800 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-xs shadow-sm transition-all"
                >
                  {isPublishing ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>{isHindi ? 'प्रकाशित हो रहा है...' : 'Saving to Firestore...'}</span>
                    </>
                  ) : (
                    <>
                      <span>{isHindi ? 'कैटलॉग में प्रकाशित करें' : 'Publish to MoSJE Smart Catalog'}</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </div>
          );
        })()}
    </div>
  );
};
