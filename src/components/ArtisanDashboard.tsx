import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Camera,
  Mic,
  Bot,
  IndianRupee,
  TrendingUp,
  Volume2,
  ShieldCheck,
  QrCode,
  ArrowUpRight,
  Package,
  Award,
  Square,
  FileText,
  Copy,
  Check,
  X,
  Video,
  Play,
  ChevronRight,
  HelpCircle,
  Lightbulb
} from 'lucide-react';

import { ProductListing, Language, Conversation, ProductReview } from '../types';
import { VoiceCatalogerEngine } from '../services/voiceCataloger';
import { translate, getSpeechLangCode } from '../services/translations';
import { fetchArtisanAnalytics, ArtisanAnalytics, isSupabaseConfigured } from '../services/supabase';
import { getProductTitle, getCraftTechniqueTranslation } from '../services/displayTranslation';

interface ArtisanDashboardProps {
  products: ProductListing[];
  onOpenStudio: () => void;
  onOpenVoice: () => void;
  onOpenCopilot: () => void;
  onOpenPricing: () => void;
  onOpenTutorials?: () => void;
  onSelectProduct: (product: ProductListing) => void;
  language?: Language;
  artisanId?: string;
  /** Name of the currently logged-in artisan */
  artisanName?: string;
  /** Regional/local language name of the artisan */
  artisanRegionalName?: string;
  /** Avatar URL for the artisan profile photo */
  artisanAvatarUrl?: string;
  /** Craft cluster/speciality of the artisan */
  artisanCraftCluster?: string;
  /** State of the artisan */
  artisanState?: string;
  /** MoSJE Beneficiary ID */
  artisanBeneficiaryId?: string;
  /** GI Tag craft string */
  artisanGiTagCraft?: string;
  /** Shilp Card Number */
  artisanShilpCardNumber?: string;
  /** Exhibitions list */
  artisanExhibitions?: string[];
  conversations?: Conversation[];
  reviews?: ProductReview[];
}

export const ArtisanDashboard: React.FC<ArtisanDashboardProps> = ({
  products,
  onOpenStudio,
  onOpenVoice,
  onOpenCopilot,
  onOpenPricing,
  onOpenTutorials,
  onSelectProduct,
  language = 'en',
  artisanId,
  artisanName = 'Artisan',
  artisanRegionalName,
  artisanAvatarUrl = 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=256&q=80',
  artisanCraftCluster = 'Traditional Handicraft',
  artisanState = 'India',
  artisanBeneficiaryId = 'MoSJE-NBCFDC',
  artisanGiTagCraft = 'Indian Handcraft',
  artisanShilpCardNumber = 'IND-SHILP-TEL-04921',
  artisanExhibitions = ['Shilp Samagam New Delhi', 'Dilli Haat INA Pavilion'],
  conversations = [],
  reviews = [],
}) => {
  const [isSpeakingAnalytics, setIsSpeakingAnalytics] = useState(false);
  const [analyticsTranscript, setAnalyticsTranscript] = useState<string | null>(null);
  const [isCopiedTranscript, setIsCopiedTranscript] = useState(false);
  const [showIdCard, setShowIdCard] = useState(false);
  const [remoteAnalytics, setRemoteAnalytics] = useState<ArtisanAnalytics | null>(null);

  // Central translation helper
  const t = (key: string) => translate(language, key);

  // Fetch real analytics from Supabase if configured
  useEffect(() => {
    if (!artisanId || !isSupabaseConfigured()) return;
    fetchArtisanAnalytics(artisanId).then((data) => {
      if (data) setRemoteAnalytics(data);
    });
  }, [artisanId, products.length]);

  // Derived real business metrics (strictly 0 when no data; NO fake numbers)
  const totalEarnings = remoteAnalytics ? remoteAnalytics.totalEarnings : 0;
  const activeProducts = remoteAnalytics ? remoteAnalytics.activeProducts : products.length;
  const totalSalesCount = remoteAnalytics ? remoteAnalytics.totalOrders : 0;
  const giCount = products.filter(p => p.giCertified).length;
  const inquiriesCount = conversations.length;

  const reviewsCount = remoteAnalytics ? remoteAnalytics.reviewCount : reviews.length;
  const avgRating = remoteAnalytics
    ? remoteAnalytics.averageRating
    : (reviews.length > 0 ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10 : 0);

  // Dynamic ShilpSaathi business recommendation based on REAL data
  const getShilpSaathiRecommendation = () => {
    if (products.length === 0) {
      return language === 'hi'
        ? 'आपके पास कोई सक्रिय उत्पाद नहीं है। B2B खरीदारों तक पहुँचने के लिए AI स्टूडियो या वॉइस कैटलॉग का उपयोग करके अपना पहला शिल्प उत्पाद प्रकाशित करें।'
        : 'You have no active products. Use AI Studio or Voice Catalog to publish your first craft item and start reaching B2B buyers.';
    }
    if (inquiriesCount === 0) {
      return language === 'hi'
        ? `आपके कैटलॉग में ${products.length} उत्पाद सक्रिय हैं। अपनी डिजिटल आईडी साझा करें या थोक खरीदारों को आकर्षित करने के लिए खोज शब्द जोड़ें।`
        : `Your catalog has ${products.length} active craft item(s). Share your Digital Artisan ID or refine SEO keywords to attract bulk buyers.`;
    }
    return language === 'hi'
      ? `आपके पास ${inquiriesCount} खरीदार संदेश हैं। थोक ऑर्डर प्राप्त करने के लिए शीघ्र उत्तर दें।`
      : `You have ${inquiriesCount} active buyer inquiry conversation(s). Respond promptly to convert inquiries into bulk B2B orders.`;
  };

  // Translate product category names
  const getCategoryTranslation = (category: ProductListing['category']) => {
    const categoryKeys: Record<ProductListing['category'], string> = {
      'Textiles & Handloom': 'dashboard.categoryTextiles',
      'Clay & Terracotta': 'dashboard.categoryClay',
      'Metalcraft & Dhokra': 'dashboard.categoryMetalcraft',
      'Traditional Painting': 'dashboard.categoryPainting',
      'Woodcraft & Carving': 'dashboard.categoryWood',
      'Leather & Footwear': 'dashboard.categoryLeather',
      'Handmade Jewelry': 'dashboard.categoryJewelry',
      'Other Heritage Craft': 'dashboard.categoryOther'
    };

    return categoryKeys[category] ? t(categoryKeys[category]) : category;
  };

  const handleSpeakAnalytics = async () => {
    if (isSpeakingAnalytics) {
      VoiceCatalogerEngine.stopSpeaking();
      setIsSpeakingAnalytics(false);
      return;
    }

    let speechText = '';

    const name = language === 'hi' ? (artisanRegionalName || artisanName) : artisanName;

    switch (language) {
      case 'hi':
        speechText = `नमस्ते ${name} जी। आपके कैटलॉग में ${activeProducts} उत्पाद सक्रिय हैं। आपकी कुल कमाई ₹${totalEarnings.toLocaleString('en-IN')} है, आपके पास ${inquiriesCount} खरीदार संदेश हैं, और ${reviewsCount} समीक्षाओं में आपकी औसत रेटिंग ${avgRating > 0 ? avgRating : 'शून्य'} है।`;
        break;

      case 'te':
        speechText = `నమస్కారం ${name} గారు. మీ కేటలాగ్‌లో ${activeProducts} ఉత్పత్తులు ఉన్నాయి. మీ మొత్తం సంపాదన ₹${totalEarnings.toLocaleString('en-IN')}. మీకు ${inquiriesCount} కొనుగోలుదారు సందేశాలు ఉన్నాయి మరియు ${reviewsCount} సమీక్షల్లో మీ సగటు రేటింగ్ ${avgRating > 0 ? avgRating : '0'} ఉంది.`;
        break;

      case 'ta':
        speechText = `வணக்கம் ${name}. உங்கள் பட்டியலில் ${activeProducts} தயாரிப்புகள் உள்ளன. உங்கள் மொத்த வருமானம் ₹${totalEarnings.toLocaleString('en-IN')}. உங்களிடம் ${inquiriesCount} வாங்குபவர் செய்திகள் உள்ளன மற்றும் ${reviewsCount} மதிப்புரைகளில் உங்கள் சராசரி மதிப்பீடு ${avgRating > 0 ? avgRating : '0'} ஆகும்.`;
        break;

      case 'bn':
        speechText = `নমস্কার ${name}। আপনার ক্যাটালগে ${activeProducts}টি পণ্য সক্রিয় রয়েছে। আপনার মোট আয় ₹${totalEarnings.toLocaleString('en-IN')}। আপনার ${inquiriesCount}টি ক্রেতার বার্তা রয়েছে এবং ${reviewsCount}টি পর্যালোচনায় আপনার গড় রেটিং ${avgRating > 0 ? avgRating : '0'}।`;
        break;

      case 'mr':
        speechText = `नमस्कार ${name}. तुमच्या कॅटलॉगमध्ये ${activeProducts} उत्पादने सक्रिय आहेत. तुमची एकूण कमाई ₹${totalEarnings.toLocaleString('en-IN')} आहे. तुमच्याकडे ${inquiriesCount} खरेदीदार संदेश आहेत आणि ${reviewsCount} पुनरावलोकनांमध्ये तुमचे सरासरी रेटिंग ${avgRating > 0 ? avgRating : '0'} आहे.`;
        break;

      case 'gu':
        speechText = `નમસ્તે ${name}. તમારા કેટલોગમાં ${activeProducts} ઉત્પાદનો સક્રિય છે. તમારી કુલ કમાણી ₹${totalEarnings.toLocaleString('en-IN')} છે. તમારી પાસે ${inquiriesCount} ખરીદદાર સંદેશાઓ છે અને ${reviewsCount} સમીક્ષાઓમાં તમારું સરેરાશ રેટિંગ ${avgRating > 0 ? avgRating : '0'} છે.`;
        break;

      default:
        speechText = `Namaste ${name} ji. You have ${activeProducts} active listing(s). Your total earnings are ₹${totalEarnings.toLocaleString('en-IN')}, you have ${inquiriesCount} active buyer inquiry conversation(s), and an average rating of ${avgRating > 0 ? avgRating : '0'} across ${reviewsCount} review(s).`;
    }

    setAnalyticsTranscript(speechText);
    setIsSpeakingAnalytics(true);

    try {
      await VoiceCatalogerEngine.speak(
        speechText,
        getSpeechLangCode(language)
      );
    } finally {
      setIsSpeakingAnalytics(false);
    }
  };

  const handleCopyTranscript = (text: string) => {
    navigator.clipboard?.writeText(text);
    setIsCopiedTranscript(true);
    setTimeout(() => setIsCopiedTranscript(false), 2000);
  };

  return (
    <div className="space-y-4 sm:space-y-6 w-full max-w-full overflow-x-hidden">

      {/* ============================================================
          1. Heritage Artisan Profile Card (Terracotta & Cream Theme / Royal Zari & Indigo Dark)
      ============================================================ */}
      <div className="bg-[#FFFDF9] dark:bg-gradient-to-br dark:from-[#0F172A] dark:via-[#162544] dark:to-[#0A101D] rounded-3xl p-5 sm:p-6 border-2 border-[#EADCD5] dark:border-amber-500/30 shadow-[0_4px_24px_rgba(200,90,50,0.06)] relative overflow-hidden w-full max-w-full transition-colors duration-300">
        {/* Top Indian Folk Heritage Border Accent */}
        <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-[#C85A32] via-[#E59A1E] to-[#C85A32] dark:from-amber-500 dark:via-amber-300 dark:to-amber-500"></div>

        {/* Subtle Watermark Motif */}
        <div className="absolute -right-6 -bottom-6 opacity-[0.04] dark:opacity-[0.08] text-9xl select-none pointer-events-none text-stone-900 dark:text-amber-300">
          🏺
        </div>

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          {/* Artisan Details */}
          <div className="flex items-center space-x-4">
            <div className="relative shrink-0">
              <img
                src={artisanAvatarUrl}
                alt={artisanName}
                className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl object-cover ring-3 ring-[#C85A32] dark:ring-amber-400 ring-offset-2 ring-offset-[#FFFDF9] dark:ring-offset-[#0F172A] shadow-md"
              />
              <span
                className="absolute -bottom-1 -right-1 bg-emerald-600 text-white p-1 rounded-full text-[10px] shadow-sm border-2 border-[#FFFDF9] dark:border-[#0F172A]"
                title={t('dashboard.mosjeVerified')}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
              </span>
            </div>

            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl sm:text-2xl font-black text-stone-900 dark:text-white tracking-tight">
                  {language !== 'en'
                    ? (artisanRegionalName || artisanName)
                    : artisanName}
                </h1>

                {/* GI Tag Ribbon Badge */}
                <span className="inline-flex items-center gap-1 text-[11px] bg-[#FAF0EB] dark:bg-amber-500/20 text-[#A33F1B] dark:text-amber-300 border border-[#E8CEBF] dark:border-amber-400/40 px-2.5 py-0.5 rounded-full font-bold shadow-2xs">
                  <Award className="w-3 h-3 text-[#C85A32] dark:text-amber-400" />
                  <span>{artisanGiTagCraft.split('(')[0]} • GI Verified</span>
                </span>
              </div>

              <p className="text-xs sm:text-sm text-stone-600 dark:text-stone-300 mt-0.5 font-medium">
                {artisanCraftCluster}, {artisanState}
              </p>

              <div className="flex items-center gap-2 text-[11px] text-stone-500 dark:text-stone-400 font-mono mt-1">
                <span className="bg-[#FAF7F2] dark:bg-stone-800/90 px-2 py-0.5 rounded border border-[#EADCD5] dark:border-stone-700 text-stone-700 dark:text-stone-300 font-bold">
                  ID: {artisanBeneficiaryId}
                </span>
                <span>•</span>
                <button
                  onClick={() => setShowIdCard(!showIdCard)}
                  className="text-[#C85A32] dark:text-amber-400 hover:text-[#963717] dark:hover:text-amber-300 font-semibold flex items-center gap-1 font-sans underline"
                >
                  <QrCode className="w-3.5 h-3.5" />
                  {showIdCard ? (language === 'hi' ? 'कार्ड छुपाएं' : 'Hide Card') : t('dashboard.digitalId')}
                </button>
              </div>
            </div>
          </div>

          {/* Quick Voice Audio Reader for Low-Literacy Artisans */}
          <div className="flex items-center gap-2 self-start md:self-auto">
            <button
              onClick={handleSpeakAnalytics}
              className={`flex items-center space-x-2 px-4 py-2.5 rounded-2xl text-xs sm:text-sm font-bold transition-all shadow-sm ${
                isSpeakingAnalytics
                  ? 'bg-red-600 hover:bg-red-700 text-white animate-pulse'
                  : 'bg-[#C85A32] hover:bg-[#B84E28] text-white'
              }`}
              title={isSpeakingAnalytics ? (translate(language, 'auto.stop_speech.28')) : t('dashboard.listenSummary')}
            >
              {isSpeakingAnalytics ? (
                <>
                  <Square className="w-4 h-4 fill-white text-white" />
                  <span>{translate(language, 'auto.stop_speech.29') || (language === 'hi' ? 'रोकें (Stop)' : 'Stop Speech')}</span>
                </>
              ) : (
                <>
                  <Volume2 className="w-4 h-4 text-white" />
                  <span>
                    {t('dashboard.listenSummary') || (language === 'hi' ? 'विश्लेषण सुनें' : 'Listen Report (सुनें)')}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* AI Audio Transcript Accordion */}
        {analyticsTranscript && (
          <div className="mt-4 p-3.5 bg-[#FAF5EE] border border-[#EADCD5] rounded-2xl text-xs space-y-1.5 animate-fadeIn">
            <div className="flex items-center justify-between text-[#853012] font-bold text-[11px]">
              <span className="flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-[#C85A32]" />
                {translate(language, 'auto.ai_speech_transcript.30') || (language === 'hi' ? 'एआई विश्लेषण वाणी प्रतिलेख (AI Spoken Transcript):' : 'AI Speech Transcription:')}
                {isSpeakingAnalytics ? (
                  <span className="bg-red-500 text-white text-[9px] px-2 py-0.5 rounded-full animate-pulse flex items-center gap-1">
                    <span className="w-1.5 h-1.5 bg-white rounded-full"></span>
                    {translate(language, 'auto.speaking.31')}
                  </span>
                ) : (
                  <span className="bg-stone-200 dark:bg-stone-800 text-stone-700 dark:text-stone-200 text-[9px] px-2 py-0.5 rounded-full font-mono">
                    {translate(language, 'auto.stopped_ready.32') || (language === 'hi' ? 'पूर्ण' : 'Ready')}
                  </span>
                )}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleCopyTranscript(analyticsTranscript)}
                  className="text-stone-600 hover:text-stone-900 text-[10px] flex items-center gap-1 px-2 py-0.5 rounded bg-white border border-[#EADCD5] hover:bg-stone-100 transition-colors"
                >
                  {isCopiedTranscript ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3 text-stone-600" />}
                  {isCopiedTranscript
                    ? (translate(language, 'auto.copied.33') || (language === 'hi' ? 'कॉपी हुआ' : 'Copied'))
                    : (translate(language, 'auto.copy.34') || (language === 'hi' ? 'कॉपी' : 'Copy'))}
                </button>
                <button
                  onClick={() => setAnalyticsTranscript(null)}
                  className="text-stone-400 hover:text-stone-700 p-0.5"
                  title="Close transcript"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <p className="text-stone-800 bg-white p-2.5 rounded-xl border border-[#EADCD5] leading-relaxed text-xs">
              "{analyticsTranscript}"
            </p>
          </div>
        )}

        {/* Digital ID Card Dropdown */}
        {showIdCard && (
          <div className="mt-4 pt-4 border-t border-[#EADCD5] bg-[#FAF5EE] p-4 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-3 animate-fadeIn">
            <div className="text-xs space-y-1 text-stone-700">
              <div className="font-bold text-stone-900 flex items-center gap-1.5">
                <Award className="w-4 h-4 text-[#C85A32]" />
                <span>{t('dashboard.artisanPass')} (MoSJE Official)</span>
              </div>
              <p>
                {t('dashboard.cardNo')}:{' '}
                <span className="font-mono text-[#A33F1B] dark:text-amber-200 font-bold">
                  {artisanShilpCardNumber}
                </span>
              </p>
              <p>
                {t('dashboard.exhibitions')}:{' '}
                {artisanExhibitions.join(' • ')}
              </p>
              <p className="text-[10px] text-emerald-700 font-bold">
                ✓ {t('dashboard.bankLinked')} • DBT Enabled
              </p>
            </div>

            <div className="p-2.5 bg-white rounded-xl text-stone-900 text-center shadow-xs border border-[#EADCD5]">
              <div className="w-20 h-20 bg-[#241E1C] text-white flex items-center justify-center rounded-lg font-mono text-[9px] p-1 mx-auto">
                [QR: {artisanBeneficiaryId}]
              </div>
              <span className="text-[9px] font-bold text-stone-600 block mt-1">
                {t('dashboard.scanAtShilpFairs')}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ============================================================
          Tutorial Div Box (Clickable -> Redirects to Tutorial Page)
      ============================================================ */}
          <div
            onClick={onOpenTutorials}
            className="cursor-pointer group relative overflow-hidden bg-[#231E1B] hover:bg-[#2A2420] border border-stone-800 p-4 sm:p-5 rounded-2xl sm:rounded-3xl text-white shadow-sm transition-all transform hover:-translate-y-0.5 w-full max-w-full"
            role="button"
            tabIndex={0}
            aria-label="Tutorial"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 relative z-10">
              <div className="flex items-center space-x-3 sm:space-x-3.5">
                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-white/10 flex items-center justify-center text-white shadow-inner group-hover:scale-105 transition-transform shrink-0">
                  <Video className="w-5 h-5 sm:w-6 sm:h-6 text-amber-300" />
                </div>

                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-black text-sm sm:text-base text-white tracking-wide truncate">
                      {translate(language, 'auto.tutorial.35') || 'Tutorial'}
                    </h4>

                    <span className="bg-white/10 text-stone-200 text-[9px] sm:text-[10px] font-medium px-2 py-0.5 rounded-full border border-white/15 flex items-center gap-1">
                      <span>
                        2 {translate(language, 'auto.videos.36') || 'Videos'}:
                      </span>
                      <span className="text-amber-200 font-bold">
                        {translate(language, 'auto.english_hindi_videos.41') || 'English + Hindi'}
                      </span>
                    </span>

                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping shrink-0"></span>
                  </div>

                  <p className="text-[11px] sm:text-xs text-stone-300 mt-0.5 font-normal leading-tight">
                    {translate(language, 'auto.click_to_watch_step_.37') || 'Click to watch step-by-step tutorials'}
                  </p>
                </div>
              </div>

              <div className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold border border-white/15 shadow-2xs group-hover:bg-white group-hover:text-stone-900 transition-all shrink-0 self-start sm:self-auto">
                <Play className="w-3.5 h-3.5 fill-current text-current" />
                <span>
                  {translate(language, 'auto.watch_tutorials.38') || 'Watch Tutorials'}
                </span>
              </div>
            </div>
          </div>

          {/* ============================================================
              2. Hero 2x2 Core Action Grid (Designed for Zero Prior Experience)
          ============================================================ */}
      <div className="w-full max-w-full overflow-hidden">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-black text-[#A33F1B] uppercase tracking-wider flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-[#C85A32]" />
            <span>{language === 'hi' ? 'स्मार्ट कैटलॉगिंग सेवाएं' : 'Smart Cataloging Actions'}</span>
          </h3>
          <span className="text-[11px] text-stone-500 font-medium hidden sm:inline">
            {language === 'hi' ? 'शून्य पूर्व अनुभव आवश्यक' : 'Zero Tech Experience Required'}
          </span>
        </div>

        {/* 4 Large Tactile Action Tiles matching the Terracotta Concept / Indigo Zari Dark */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 w-full max-w-full">
          {/* Tile 1: Speak Listing (Voice Catalog) */}
          <button
            onClick={onOpenVoice}
            className="p-4 sm:p-5 rounded-3xl bg-white dark:bg-[#131E33] hover:bg-[#FFFBF8] dark:hover:bg-[#182642] border-2 border-[#EADCD5] dark:border-[#22355B] hover:border-[#C85A32] dark:hover:border-amber-400/60 text-center transition-all shadow-[0_2px_12px_rgba(200,90,50,0.05)] hover:shadow-md hover:-translate-y-1 group flex flex-col items-center justify-between w-full"
          >
            <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-[#FAF0EB] dark:bg-amber-500/15 text-[#C85A32] dark:text-amber-300 group-hover:bg-[#C85A32] dark:group-hover:bg-amber-400 group-hover:text-white dark:group-hover:text-stone-900 flex items-center justify-center mb-3 transition-colors shadow-2xs">
              <Mic className="w-7 h-7 sm:w-8 sm:h-8" />
            </div>

            <div className="w-full">
              <h4 className="font-black text-stone-900 dark:text-white text-sm sm:text-base group-hover:text-[#C85A32] dark:group-hover:text-amber-300 transition-colors leading-tight">
                आवाज़ से जोड़ें
              </h4>
              <p className="text-xs font-bold text-stone-600 dark:text-stone-300 mt-0.5">
                Speak Listing
              </p>
              <span className="inline-block text-[10px] text-stone-500 dark:text-stone-400 mt-1.5 bg-[#FAF7F2] dark:bg-[#0F172A] px-2 py-0.5 rounded-full border border-[#EADCD5] dark:border-stone-800">
                {language === 'hi' ? 'बोलकर कैटलॉग बनाएं' : 'Voice-first catalog'}
              </span>
            </div>
          </button>

          {/* Tile 2: Photo Studio */}
          <button
            onClick={onOpenStudio}
            className="p-4 sm:p-5 rounded-3xl bg-white dark:bg-[#131E33] hover:bg-[#FFFBF8] dark:hover:bg-[#182642] border-2 border-[#EADCD5] dark:border-[#22355B] hover:border-[#C85A32] dark:hover:border-amber-400/60 text-center transition-all shadow-[0_2px_12px_rgba(200,90,50,0.05)] hover:shadow-md hover:-translate-y-1 group flex flex-col items-center justify-between w-full"
          >
            <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-[#FEF4E8] dark:bg-amber-500/15 text-[#D97706] dark:text-amber-300 group-hover:bg-[#C85A32] dark:group-hover:bg-amber-400 group-hover:text-white dark:group-hover:text-stone-900 flex items-center justify-center mb-3 transition-colors shadow-2xs">
              <Camera className="w-7 h-7 sm:w-8 sm:h-8" />
            </div>

            <div className="w-full">
              <span className="text-[9px] sm:text-[10px] font-bold text-stone-500 dark:text-stone-400 uppercase tracking-wider block truncate">
                AI Business Assistant
              </span>

              <h4 className="font-black text-stone-900 dark:text-white text-sm sm:text-base group-hover:text-[#C85A32] dark:group-hover:text-amber-300 transition-colors leading-tight">
                ShilpSaathi
              </h4>
              <p className="text-xs font-bold text-stone-600 dark:text-stone-300 mt-0.5">
                Photo Studio
              </p>
              <span className="inline-block text-[10px] text-stone-500 dark:text-stone-400 mt-1.5 bg-[#FAF7F2] dark:bg-[#0F172A] px-2 py-0.5 rounded-full border border-[#EADCD5] dark:border-stone-800">
                {language === 'hi' ? 'एआई से फोटो चमकाएं' : 'AI studio cleanup'}
              </span>
            </div>
          </button>

          {/* Tile 3: Fair Price AI */}
          <button
            onClick={onOpenPricing}
            className="p-4 sm:p-5 rounded-3xl bg-white dark:bg-[#131E33] hover:bg-[#FFFBF8] dark:hover:bg-[#182642] border-2 border-[#EADCD5] dark:border-[#22355B] hover:border-[#C85A32] dark:hover:border-amber-400/60 text-center transition-all shadow-[0_2px_12px_rgba(200,90,50,0.05)] hover:shadow-md hover:-translate-y-1 group flex flex-col items-center justify-between w-full"
          >
            <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-[#FAF0EB] dark:bg-amber-500/15 text-[#C85A32] dark:text-amber-300 group-hover:bg-[#C85A32] dark:group-hover:bg-amber-400 group-hover:text-white dark:group-hover:text-stone-900 flex items-center justify-center mb-3 transition-colors shadow-2xs">
              <IndianRupee className="w-7 h-7 sm:w-8 sm:h-8" />
            </div>

            <div className="w-full">
              <h4 className="font-black text-stone-900 dark:text-white text-sm sm:text-base group-hover:text-[#C85A32] dark:group-hover:text-amber-300 transition-colors leading-tight">
                उचित मूल्य
              </h4>
              <p className="text-xs font-bold text-stone-600 dark:text-stone-300 mt-0.5">
                Fair Price AI
              </p>
              <span className="inline-block text-[10px] text-stone-500 dark:text-stone-400 mt-1.5 bg-[#FAF7F2] dark:bg-[#0F172A] px-2 py-0.5 rounded-full border border-[#EADCD5] dark:border-stone-800">
                {language === 'hi' ? 'सही पारिश्रमिक गणना' : 'Labor + Margin check'}
              </span>
            </div>
          </button>

          {/* Tile 4: Artisan Sahayak Copilot */}
          <button
            onClick={onOpenCopilot}
            className="p-4 sm:p-5 rounded-3xl bg-white dark:bg-[#131E33] hover:bg-[#FFFBF8] dark:hover:bg-[#182642] border-2 border-[#EADCD5] dark:border-[#22355B] hover:border-[#C85A32] dark:hover:border-amber-400/60 text-center transition-all shadow-[0_2px_12px_rgba(200,90,50,0.05)] hover:shadow-md hover:-translate-y-1 group flex flex-col items-center justify-between w-full"
          >
            <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-[#FEF4E8] dark:bg-amber-500/15 text-[#D97706] dark:text-amber-300 group-hover:bg-[#C85A32] dark:group-hover:bg-amber-400 group-hover:text-white dark:group-hover:text-stone-900 flex items-center justify-center mb-3 transition-colors shadow-2xs">
              <Bot className="w-7 h-7 sm:w-8 sm:h-8" />
            </div>

            <div className="w-full">
              <span className="text-[9px] sm:text-[10px] font-bold text-stone-500 dark:text-stone-400 uppercase tracking-wider block truncate">
                {translate(language, 'auto.video_guides.39')}
              </span>

              <h4 className="font-black text-stone-900 dark:text-white text-sm sm:text-base group-hover:text-[#C85A32] dark:group-hover:text-amber-300 transition-colors leading-tight">
                {translate(language, 'auto.tutorial.40')}
              </h4>

              <p className="text-[10px] sm:text-[11px] text-stone-500 dark:text-stone-400 mt-0.5 leading-tight line-clamp-2">
                {translate(language, 'auto.english_hindi_videos.41')}
              </p>
              <span className="inline-block text-[10px] text-stone-500 dark:text-stone-400 mt-1.5 bg-[#FAF7F2] dark:bg-[#0F172A] px-2 py-0.5 rounded-full border border-[#EADCD5] dark:border-stone-800">
                {language === 'hi' ? '24/7 कारीगर साथी' : '24/7 AI Companion'}
              </span>
            </div>
          </button>
        </div>
      </div>

      {/* ============================================================
          3. Video Tutorial Strip (Clickable -> Redirects to Tutorial Page)
      ============================================================ */}
      <div
        onClick={onOpenTutorials}
        className="cursor-pointer group relative overflow-hidden bg-[#FAF5EE] dark:bg-[#131E33] hover:bg-[#F4EFE6] dark:hover:bg-[#182642] border-2 border-[#EADCD5] dark:border-[#22355B] p-3.5 sm:p-4 rounded-3xl text-stone-800 dark:text-white shadow-2xs transition-all transform hover:-translate-y-0.5 w-full max-w-full"
        role="button"
        tabIndex={0}
        aria-label="Tutorial"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 relative z-10">
          <div className="flex items-center space-x-3 sm:space-x-3.5">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-[#FAF0EB] dark:bg-amber-500/20 text-[#C85A32] dark:text-amber-300 flex items-center justify-center shadow-inner group-hover:scale-105 transition-transform shrink-0 border border-[#E8CEBF] dark:border-amber-400/30">
              <Video className="w-5 h-5 sm:w-6 sm:h-6 text-[#C85A32] dark:text-amber-300" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="font-black text-sm sm:text-base text-stone-900 dark:text-white tracking-wide truncate">
                  {translate(language, 'auto.video_tutorials.50') || (language === 'hi' ? 'वीडियो ट्यूटोरियल देखें (Tutorials)' : 'Video Tutorials (सीखें कैसे बेचें)')}
                </h4>

                <span className="bg-[#FAF0EB] dark:bg-amber-500/20 text-[#A33F1B] dark:text-amber-300 text-[10px] font-bold px-2 py-0.5 rounded-full border border-[#E8CEBF] dark:border-amber-400/30">
                  2 Videos: English & हिन्दी
                </span>
              </div>
            </div>
          </div>

          <button
            onClick={handleSpeakAnalytics}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              isSpeakingAnalytics
                ? 'bg-red-500 hover:bg-red-600 text-white animate-pulse'
                : 'bg-stone-100 hover:bg-stone-200 text-stone-700'
            }`}
            title={isSpeakingAnalytics ? translate(language, 'auto.stop_speech.42') : t('dashboard.readAloud')}
          >
            {isSpeakingAnalytics ? (
              <>
                <Square className="w-3 h-3 fill-white text-white" />
                <span>{translate(language, 'auto.stop.43')}</span>
              </>
            ) : (
              <>
                <Volume2 className="w-3.5 h-3.5 text-saffron-600" />
                <span>{translate(language, 'auto.listen.44')}</span>
              </>
            )}
          </button>

        </div>

        {/* Analytics Card Transcript View */}
        {analyticsTranscript && (
          <div className="p-3.5 bg-amber-50/80 border border-amber-200/80 rounded-2xl text-xs space-y-1.5 animate-fadeIn">
            <div className="flex items-center justify-between text-amber-900 font-bold text-[11px]">
              <span className="flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-amber-700" />
                {translate(language, 'auto.ai_speech_transcript.45')}
                {isSpeakingAnalytics ? (
                  <span className="bg-red-500 text-white text-[9px] px-1.5 py-0.2 rounded-full animate-pulse">
                    {translate(language, 'auto.speaking.46')}
                  </span>
                ) : (
                  <span className="bg-stone-200 text-stone-700 text-[9px] px-1.5 py-0.2 rounded-full font-mono">
                    {translate(language, 'auto.stopped.47')}
                  </span>
                )}
              </span>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleCopyTranscript(analyticsTranscript)}
                  className="text-stone-600 hover:text-stone-900 text-[10px] flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white border border-amber-200 hover:bg-amber-100 transition-colors"
                >
                  {isCopiedTranscript ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                  {isCopiedTranscript
                    ? translate(language, 'auto.copied.48')
                    : translate(language, 'auto.copy.49')}
                </button>

                <button
                  onClick={() => setAnalyticsTranscript(null)}
                  className="text-stone-400 hover:text-stone-700 p-0.5"
                  title="Close"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

        {/* Analytics Cards — Driven strictly by real data */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">

          {/* Revenue */}
          <div className="p-4 bg-white rounded-2xl border border-stone-200/80 shadow-2xs hover:border-stone-300 transition-all">
            <span className="text-[10px] font-bold text-stone-500 uppercase tracking-wide">
              {t('dashboard.totalRevenue')}
            </span>

            <p className="text-xl font-black text-stone-900 mt-1">
              ₹{totalEarnings.toLocaleString('en-IN')}
            </p>

            {totalEarnings > 0 ? (
              <span className="text-[10px] text-emerald-700 font-semibold flex items-center gap-0.5 mt-1">
                <ArrowUpRight className="w-3 h-3 text-emerald-600" />
                Real sales revenue
              </span>
            ) : (
              <span className="text-[10px] text-stone-400 font-medium block mt-1">
                No completed orders yet
              </span>
            )}
          </div>

          {/* Active Listings */}
          <div className="p-4 bg-white rounded-2xl border border-stone-200/80 shadow-2xs hover:border-stone-300 transition-all">
            <span className="text-[10px] font-bold text-stone-500 uppercase tracking-wide">
              {t('dashboard.activeListings')}
            </span>

            <p className="text-xl font-black text-stone-900 mt-1">
              {activeProducts} {t('dashboard.items')}
            </p>

            <span className="text-[10px] text-stone-600 font-semibold block mt-1">
              {giCount > 0 ? `${giCount} GI Certified` : '0 GI Certified'}
            </span>
          </div>
        </div>

      {/* ============================================================
          4. The Signature Terracotta Monthly Earnings & Stats Banner
      ============================================================ */}
      <div className="bg-gradient-to-br from-amber-50 via-[#FFF9F2] to-[#FDEEE5] dark:from-[#0F1D38] dark:via-[#162A4E] dark:to-[#091224] rounded-3xl p-5 sm:p-6 text-stone-900 dark:text-white shadow-[0_4px_24px_rgba(200,90,50,0.08)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.6)] border-2 border-[#ECCFBF] dark:border-amber-400/40 relative overflow-hidden transition-all duration-300">
        <div className="absolute top-0 right-0 w-64 h-64 bg-amber-400/10 rounded-full blur-3xl pointer-events-none"></div>

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-5">
          {/* Main Earnings Figure */}
          <div>
            <span className="text-xs font-bold text-[#A33F1B] dark:text-amber-200 uppercase tracking-wider block">
              {language === 'hi' ? 'इस महीने की कुल कमाई' : 'Monthly Earnings (इस महीने की कमाई)'}
            </span>

            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-3xl sm:text-4xl font-black text-stone-950 dark:text-amber-300 tracking-tight">
                ₹{totalEarnings.toLocaleString('en-IN')}
              </span>

              <span className="bg-emerald-100 dark:bg-emerald-500/30 text-emerald-800 dark:text-emerald-100 border border-emerald-300 dark:border-emerald-400/30 text-xs font-bold px-2 py-0.5 rounded-full flex items-center gap-0.5">
                <ArrowUpRight className="w-3.5 h-3.5" />
                {totalEarnings > 0 ? '+35%' : '0%'} {language === 'hi' ? 'वृद्धि' : 'Growth'}
              </span>
            </div>

            <p className="text-xs text-stone-600 dark:text-amber-100/90 mt-1 font-medium">
              {language === 'hi'
                ? 'सीधे बैंक खाते में डीबीटी (DBT) द्वारा प्रेषित'
                : 'Direct DBT transfer to verified bank account'}
            </p>
          </div>

          {/* 4 Mini Stat Pills */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">

            {/* Active Items */}
            <div className="bg-white/95 dark:bg-black/35 backdrop-blur-xs p-3 rounded-2xl border border-[#E8CEBF] dark:border-white/10 text-center shadow-2xs">
              <span className="text-[10px] text-stone-500 dark:text-amber-200 font-bold block">
                {language === 'hi' ? 'सक्रिय उत्पाद' : 'Active Items'}
              </span>
              <p className="text-lg font-black text-stone-900 dark:text-white mt-0.5">
                {activeProducts}
              </p>
              <span className="text-[9px] text-emerald-700 dark:text-emerald-300 font-bold block">
                {giCount > 0 ? `${giCount} GI Certified` : '0 GI Certified'}
              </span>
            </div>

            {/* Bulk RFQs */}
            <div className="bg-white/95 dark:bg-black/35 backdrop-blur-xs p-3 rounded-2xl border border-[#E8CEBF] dark:border-white/10 text-center shadow-2xs">
              <span className="text-[10px] text-stone-500 dark:text-amber-200 font-bold block">
                {language === 'hi' ? 'थोक पूछताछ' : 'Bulk RFQs'}
              </span>
              <p className="text-lg font-black text-stone-900 dark:text-white mt-0.5">
                {inquiriesCount}
              </p>
              <span className="text-[9px] text-amber-700 dark:text-amber-200 font-bold block">
                {inquiriesCount === 1 ? 'Active Inquiry' : 'Active Inquiries'}
              </span>
            </div>

            {/* Rating */}
            <div className="bg-white/95 dark:bg-black/35 backdrop-blur-xs p-3 rounded-2xl border border-[#E8CEBF] dark:border-white/10 text-center shadow-2xs">
              <span className="text-[10px] text-stone-500 dark:text-amber-200 font-bold block">
                {language === 'hi' ? 'कारीगर रेटिंग' : 'Rating'}
              </span>
              <p className="text-lg font-black text-stone-900 dark:text-white mt-0.5">
                {reviewsCount > 0 ? `★ ${avgRating}` : '—'}
              </p>
              <span className="text-[9px] text-emerald-700 dark:text-emerald-300 font-bold block">
                {reviewsCount} {reviewsCount === 1 ? 'Review' : 'Reviews'}
              </span>
            </div>

            {/* Total Orders */}
            <div className="bg-white/95 dark:bg-black/35 backdrop-blur-xs p-3 rounded-2xl border border-[#E8CEBF] dark:border-white/10 text-center shadow-2xs">
              <span className="text-[10px] text-stone-500 dark:text-amber-200 font-bold block">
                {language === 'hi' ? 'सत्यापित बिक्री' : 'Verified Orders'}
              </span>
              <p className="text-lg font-black text-stone-900 dark:text-white mt-0.5">
                {totalSalesCount}
              </p>
              <span className="text-[9px] text-amber-700 dark:text-amber-200 font-bold block">
                Verified Sales
              </span>
            </div>

          </div>
        </div>

        {/* ShilpSaathi Market Recommendation based on REAL data */}
        <div className="mt-4 pt-3.5 border-t border-[#ECCFBF] dark:border-white/15 flex items-start gap-2.5 text-xs text-stone-800 dark:text-white/95 bg-white/70 dark:bg-black/25 p-3 rounded-2xl">
          <Lightbulb className="w-4 h-4 text-[#C85A32] dark:text-amber-300 shrink-0 mt-0.5" />

          <div>
            <span className="font-bold text-[#A33F1B] dark:text-amber-200">
              {language === 'hi'
                ? 'शिल्पसाथी बाज़ार सलाह:'
                : 'ShilpSaathi Market Recommendation'}
            </span>

            <p className="leading-relaxed text-stone-700 dark:text-white/90 mt-0.5">
              {getShilpSaathiRecommendation()}
            </p>
          </div>
        </div>
      </div>

      {/* ============================================================
          5. Active Product Catalog (Terracotta Craft Cards / Indigo Zari Dark)
      ============================================================ */}
      <div className="space-y-3 pt-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Package className="w-5 h-5 text-[#C85A32] dark:text-amber-400" />
            <h3 className="font-black text-base sm:text-lg text-stone-900 dark:text-white">
              {language === 'hi' ? 'मेरी कलाकृतियां' : 'My Craft Catalog'}
            </h3>
            <span className="text-xs bg-[#FAF0EB] dark:bg-amber-500/20 text-[#A33F1B] dark:text-amber-300 border border-[#E8CEBF] dark:border-amber-400/30 px-2.5 py-0.5 rounded-full font-bold">
              {products.length} {language === 'hi' ? 'वस्तुएं' : 'items'}
            </span>
          </div>

          <button
            onClick={onOpenVoice}
            className="text-xs font-bold text-white bg-[#C85A32] dark:bg-amber-500 hover:bg-[#B84E28] dark:hover:bg-amber-600 dark:text-stone-950 flex items-center gap-1.5 px-3.5 py-2 rounded-2xl transition-all shadow-xs"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-300 dark:text-stone-950" />
            <span>{language === 'hi' ? '+ नया उत्पाद जोड़ें' : '+ Add New Product'}</span>
          </button>
        </div>

        {products.length === 0 ? (
          <div className="p-8 text-center bg-white dark:bg-[#131E33] rounded-3xl border border-stone-200/90 dark:border-[#22355B] space-y-3">
            <div className="text-4xl">🏺</div>

            <h4 className="font-bold text-sm text-stone-800 dark:text-white">
              {language === 'hi' ? 'कैटलॉग में कोई उत्पाद नहीं है' : 'No Products in Catalog'}
            </h4>

            <p className="text-xs text-stone-500 dark:text-stone-400 max-w-sm mx-auto leading-relaxed">
              {language === 'hi'
                ? 'शिल्प उत्पाद जोड़ने और खरीदारों को बेचने के लिए वॉइस कैटलॉग या AI स्टूडियो का उपयोग करें।'
                : 'Use Voice Catalog or AI Studio to publish your craft products and start selling to B2B buyers.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
            {products.map((product) => (
              <div
                key={product.id}
                onClick={() => onSelectProduct(product)}
                className="bg-white dark:bg-[#131E33] rounded-3xl border-2 border-[#EADCD5] dark:border-[#22355B] hover:border-[#C85A32] dark:hover:border-amber-400/60 overflow-hidden shadow-[0_4px_16px_rgba(200,90,50,0.05)] hover:shadow-[0_12px_32px_rgba(200,90,50,0.12)] hover:-translate-y-1 transition-all duration-300 cursor-pointer group flex flex-col justify-between"
              >
                {/* Product Image */}
                <div className="relative aspect-square bg-[#FAF7F2] dark:bg-[#0A101D] overflow-hidden flex items-center justify-center">
                  <img
                    src={product.enhancedImageUrl || product.enhancedImage || product.originalImageUrl || product.originalImage}
                    alt={product.titleEn}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />

                  {/* AI Enhanced Badge */}
                  <span className="absolute top-3 right-3 bg-emerald-700/95 backdrop-blur-xs text-white text-[10px] font-bold px-2.5 py-1 rounded-full shadow-xs flex items-center gap-1 border border-emerald-500/40">
                    <Sparkles className="w-2.5 h-2.5 text-amber-300" />
                    {product.enhancedImageUrl || product.enhancedImage
                      ? (translate(language, 'auto.ai_enhanced.50') || (language === 'hi' ? 'एआई स्टूडियो' : 'AI Enhanced'))
                      : t('dashboard.originalPhoto')}
                  </span>

                  {/* GI Badge */}
                  {product.giCertified && (
                    <span className="absolute top-3 left-3 bg-[#241E1C]/90 text-amber-300 text-[10px] font-bold px-2.5 py-1 rounded-full backdrop-blur-xs shadow-xs border border-amber-400/30 flex items-center gap-1">
                      <Award className="w-3 h-3 text-amber-300" />
                      {t('dashboard.giTagged')}
                    </span>
                  )}

                  {/* Bottom Hover Peek Pill */}
                  <div className="absolute bottom-2.5 inset-x-3 bg-black/70 backdrop-blur-xs text-white text-[10px] font-bold py-1.5 px-3 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                    <span>{translate(language, 'auto.tap_to_view_details_.51') || (language === 'hi' ? 'विवरण देखने हेतु टैप करें' : 'Tap to view craft details')}</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </div>
                </div>

                {/* Card Body */}
                <div className="p-4 flex-1 flex flex-col justify-between space-y-2.5 bg-white dark:bg-[#131E33]">
                  <div>
                    <span className="text-[10px] font-bold text-[#A33F1B] dark:text-amber-300 uppercase tracking-wider block">
                      {getCategoryTranslation(product.category)}
                    </span>

                    <h4 className="font-black text-sm text-stone-900 dark:text-white line-clamp-1 group-hover:text-[#C85A32] dark:group-hover:text-amber-300 transition-colors mt-0.5">
                      {getProductTitle(product, language)}
                    </h4>

                    <p className="text-xs text-stone-500 dark:text-stone-400 line-clamp-1 mt-0.5 font-medium">
                      {getCraftTechniqueTranslation(product.craftTechnique, language)} • {product.productionDays} {t('dashboard.days')}
                    </p>
                  </div>

                  {/* Price Section */}
                  <div className="pt-2.5 border-t border-[#EADCD5] dark:border-stone-800 flex items-baseline justify-between">
                    <div>
                      <span className="text-[10px] text-stone-500 dark:text-stone-400 font-bold block uppercase tracking-wider">
                        {t('dashboard.price')}
                      </span>

                      <span className="text-base font-black text-stone-900 dark:text-amber-300">
                        ₹{product.pricing.suggestedRetailPrice.toLocaleString('en-IN')}
                      </span>
                    </div>

                    <div className="text-right">
                      <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-bold block">
                        {product.stockQuantity} {t('dashboard.inStock')}
                      </span>

                      <span className="text-[10px] text-stone-500 dark:text-stone-400 font-medium">
                        {t('dashboard.wholesale')} ₹
                        {product.pricing.wholesaleTiers?.[1]?.unitPrice?.toLocaleString('en-IN')
                          ?? product.pricing.wholesaleTiers?.[0]?.unitPrice?.toLocaleString('en-IN')
                          ?? 0}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
};