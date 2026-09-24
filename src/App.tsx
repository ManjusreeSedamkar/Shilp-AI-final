import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { MobileFrame } from './components/MobileFrame';
import { MobileNativeApp } from './components/MobileNativeApp';
import { ArtisanDashboard } from './components/ArtisanDashboard';
import { ArtisanStudio } from './components/ArtisanStudio';
import { VoiceCatalogerModal } from './components/VoiceCatalogerModal';
import { ArtisanCopilot } from './components/ArtisanCopilot';
import { DynamicPricingCard } from './components/DynamicPricingCard';
import { BuyerPortal } from './components/BuyerPortal';
import { ProductDetailModal } from './components/ProductDetailModal';
import { OnboardingTutorial } from './components/OnboardingTutorial';
import { ChatMessaging } from './components/ChatMessaging';
import { ReviewsSection } from './components/ReviewsSection';
import { ArtisanCardModal } from './components/ArtisanCardModal';
import { AuthModal, AuthUser } from './components/AuthModal';
import ArtisanOnboarding from './components/ArtisanOnboarding';
import { CheckoutModal, PlacedOrder } from './components/CheckoutModal';
import { TutorialPage } from './components/TutorialPage';
import { ProductSubmitReview } from './components/ProductSubmitReview';
import { INITIAL_PRODUCTS, CURRENT_ARTISAN } from './data/craftPresets';
import { ProductListing, UserRole, Language, Conversation, ChatMessage, CustomizationRequest, ProductReview } from './types';
import { Home, Camera, Mic, Bot, IndianRupee, Sparkles, CheckCircle2, ShoppingBag, MessageSquare, Star, ShieldCheck, Video } from 'lucide-react';
import { translate, LANGUAGE_METADATA } from './services/translations';
import { getProductTitle, getProductDescription } from './services/displayTranslation';
import { LanguageAutoTranslator } from './components/LanguageAutoTranslator';

// ── Supabase is the primary backend ─────────────────────────────────────────
import {
  fetchProductsFromSupabase,
  saveProductToSupabase,
  isSupabaseConfigured,
  saveReviewToSupabase,
  fetchReviewsForProduct,
  saveMessageToSupabase,
  upsertConversation,
  fetchConversations,
  fetchBuyerRecommendations,
  saveOrderToSupabase,
  cleanupLegacyTestRecords,
  fetchArtisanProfile,
  SupabaseArtisanProfile,
} from './services/supabase';

// Firebase is retained only for compatible legacy/fallback functionality
import {
  fetchProductsFromFirestore,
  saveProductToFirestore,
  safeSetLocalStorage,
} from './services/firebase';


// Sample initial conversations with valid UUID format
const INITIAL_CONVERSATIONS: Conversation[] = [
  {
    id: 'conv-101',
    buyerId: '00000000-0000-0000-0000-000000000201',
    buyerName: 'Vikram Mehta (FabIndia)',
    artisanId: '00000000-0000-0000-0000-000000000101',
    artisanName: CURRENT_ARTISAN.name,
    productId: INITIAL_PRODUCTS[0]?.id,
    productTitle: INITIAL_PRODUCTS[0]?.titleEn,
    lastMessageAt: '10:45 AM',
    unreadCount: 1,
    messages: [
      {
        id: 'msg-1',
        conversationId: 'conv-101',
        senderId: '00000000-0000-0000-0000-000000000201',
        senderRole: 'buyer',
        senderName: 'Vikram Mehta',
        text: 'Namaste! We are procuring 35 Pochampally sarees for the upcoming Shilp Utsav. Can we request a custom indigo colorway?',
        timestamp: '10:30 AM',
        isRead: true,
        customizationRequest: {
          color: 'Deep Natural Indigo with Silver Zari',
          size: 'Standard 6.3m with Blouse Piece',
          material: 'Pure Mulberry Silk (100%)',
          quantity: 35,
          notes: 'Required for Shilp Samagam Delhi exhibition display.'
        }
      },
      {
        id: 'msg-2',
        conversationId: 'conv-101',
        senderId: '00000000-0000-0000-0000-000000000101',
        senderRole: 'artisan',
        senderName: CURRENT_ARTISAN.name,
        text: 'Namaste Vikram ji! Yes, we can weave the deep indigo design using vegetable dye. For 35 pieces, we can complete in 45 days at wholesale rate ₹6,800/pc.',
        timestamp: '10:45 AM',
        isRead: false
      }
    ]
  }
];

// Sample initial reviews with valid UUID format
const INITIAL_REVIEWS: ProductReview[] = [
  {
    id: 'rev-1',
    productId: INITIAL_PRODUCTS[0]?.id || 'prod-1',
    buyerId: '00000000-0000-0000-0000-000000000201',
    buyerName: 'Vikram Mehta',
    rating: 5,
    comment: 'Authentic Pochampally silk with exquisite double ikat precision. Direct purchase from master artisan Narasimha Rao ji ensures authentic craft preservation.',
    createdAt: '24 Aug 2026',
    verifiedPurchase: true
  },
  {
    id: 'rev-2',
    productId: INITIAL_PRODUCTS[0]?.id || 'prod-1',
    buyerId: '00000000-0000-0000-0000-000000000202',
    buyerName: 'Ananya Deshmukh',
    rating: 5,
    comment: 'The colors and texture are stunning. Fast delivery with MoSJE verification seal. Highly recommended!',
    createdAt: '28 Aug 2026',
    verifiedPurchase: true
  }
];

export function App() {
  const [role, setRole] = useState<UserRole>('buyer');
  const [language, setLanguage] = useState<Language>(() => {
    try {
      const saved = localStorage.getItem('shilp_ai_language');
      return (saved as Language) || 'en';
    } catch {
      return 'en';
    }
  });

  useEffect(() => {
    localStorage.setItem('shilp_ai_language', language);

    // Document Language & RTL Support
    const dir = LANGUAGE_METADATA[language]?.direction || 'ltr';
    document.documentElement.dir = dir;
    document.documentElement.lang = language;
  }, [language]);
  const [isMobileFrame, setIsMobileFrame] = useState<boolean>(false);
  const [isMobileScreen, setIsMobileScreen] = useState<boolean>(
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );

  useEffect(() => {
    const handleResize = () => {
      setIsMobileScreen(window.innerWidth < 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const [artisanTab, setArtisanTab] = useState<'dashboard' | 'studio' | 'voice' | 'copilot' | 'pricing' | 'chat' | 'reviews' | 'tutorials'>('dashboard');
  const [buyerTab, setBuyerTab] = useState<'explore' | 'chat'>('explore');

  // Persist language preference whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem('shilp_ai_preferred_language', language);
    } catch {}
  }, [language]);
  
  // Light Mode State (when true -> Light Mode ON; when false -> Dark Mode ON)
  const [isLightOn, setIsLightOn] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('shilp_light_mode');
      if (saved !== null) return saved === 'true';
      return true; // Default to Light Mode ON!
    } catch {
      return true;
    }
  });

  useEffect(() => {
    const root = document.documentElement;
    if (isLightOn) {
      root.classList.remove('dark');
      root.classList.add('light');
    } else {
      root.classList.add('dark');
      root.classList.remove('light');
    }
    try {
      localStorage.setItem('shilp_light_mode', String(isLightOn));
    } catch {
      // ignore
    }
  }, [isLightOn]);

  const toggleLightMode = () => {
    setIsLightOn((prev) => !prev);
  };
  
  // Persistent Products State
  const [products, setProducts] = useState<ProductListing[]>(() => {
    try {
      const saved = localStorage.getItem('shilp_ai_products');
      return saved ? JSON.parse(saved) : INITIAL_PRODUCTS;
    } catch {
      return INITIAL_PRODUCTS;
    }
  });

  // Persistent Conversations State
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    try {
      const saved = localStorage.getItem('shilp_ai_conversations');
      return saved ? JSON.parse(saved) : INITIAL_CONVERSATIONS;
    } catch {
      return INITIAL_CONVERSATIONS;
    }
  });

  // Persistent Reviews State
  const [reviews, setReviews] = useState<ProductReview[]>(() => {
    try {
      const saved = localStorage.getItem('shilp_ai_reviews');
      return saved ? JSON.parse(saved) : INITIAL_REVIEWS;
    } catch {
      return INITIAL_REVIEWS;
    }
  });

  // Persistent Auth User State — null means unauthenticated; user must sign in explicitly
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(() => {
    try {
      const saved = localStorage.getItem('shilp_ai_current_user');
      if (saved) return JSON.parse(saved);
      return null; // No auto-login — show First Launch Flow instead
    } catch {
      return null;
    }
  });

  // Artisan profile from Supabase (loaded after login for artisan role)
  const [artisanProfile, setArtisanProfile] = useState<SupabaseArtisanProfile | null>(null);

  // First Launch Flow: Language Selection Screen -> Login / Sign Up
  const [showLanguageScreen, setShowLanguageScreen] = useState<boolean>(() => currentUser === null);

  // Modals
  const [selectedProduct, setSelectedProduct] = useState<ProductListing | null>(null);
  const [productToCheckout, setProductToCheckout] = useState<ProductListing | null>(null);
  const [stagedPhotoUrl, setStagedPhotoUrl] = useState<string | null>(null);
  const [stagedOriginalPhotoUrl, setStagedOriginalPhotoUrl] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState<boolean>(false);
  const [showCardModal, setShowCardModal] = useState<boolean>(false);
  const [showAuthModal, setShowAuthModal] = useState<boolean>(false);
  const [showArtisanOnboarding, setShowArtisanOnboarding] = useState<boolean>(false);
  // Smart Catalog flow: 'voice' = cataloger step, 'review' = final review step
  const [catalogSubView, setCatalogSubView] = useState<'voice' | 'review'>('voice');
  const [stagedCatalogProduct, setStagedCatalogProduct] = useState<ProductListing | null>(null);
  const [recommendedProducts, setRecommendedProducts] = useState<ProductListing[]>([]);

  const t = (key: string) => translate(language, key);

  // Clean up legacy base64 products from localStorage to prevent quota exceeded error
  useEffect(() => {
    try {
      localStorage.removeItem('shilp_ai_products');
    } catch {}
  }, []);

  // Save conversations to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('shilp_ai_conversations', JSON.stringify(conversations));
    } catch (err) {
      console.warn('Failed to persist conversations:', err);
    }
  }, [conversations]);

  // Save reviews to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('shilp_ai_reviews', JSON.stringify(reviews));
    } catch (err) {
      console.warn('Failed to persist reviews:', err);
    }
  }, [reviews]);

  // Save auth user to localStorage
  useEffect(() => {
    try {
      if (currentUser) {
        localStorage.setItem('shilp_ai_current_user', JSON.stringify(currentUser));
      } else {
        localStorage.removeItem('shilp_ai_current_user');
      }
    } catch (err) {
      console.warn('Failed to persist auth user:', err);
    }
  }, [currentUser]);

  // Check tutorial onboarding status on mount — ONLY after account creation is complete
  useEffect(() => {
    if (!currentUser) return; // Don't show tutorial before login
    if (!currentUser.onboardingComplete) return; // Don't show tutorial during pending account creation!
    const hasSeenOnboarding = localStorage.getItem('shilp_ai_onboarding_seen');
    if (!hasSeenOnboarding) {
      setShowOnboarding(true);
    }
  }, [currentUser]);

  // Synchronize product listings — Supabase first, Firebase second, localStorage last
  useEffect(() => {
    const syncProducts = async () => {
      try {
        if (isSupabaseConfigured()) {
          // Primary: Supabase
          const remoteProducts = await fetchProductsFromSupabase();
          if (remoteProducts && remoteProducts.length > 0) {
            setProducts(remoteProducts);
            return;
          }
        }
        // Secondary: Firebase (legacy)
        const firebaseProducts = await fetchProductsFromFirestore();
        if (firebaseProducts && firebaseProducts.length > 0) {
          setProducts(firebaseProducts);
        }
      } catch (err) {
        console.warn('Product sync notice — using local data:', err);
      }
    };
    syncProducts();
  }, []);

  // Synchronize real reviews for selected product from Supabase
  useEffect(() => {
    if (!selectedProduct || !isSupabaseConfigured()) return;
    fetchReviewsForProduct(selectedProduct.id).then((remoteReviews) => {
      if (remoteReviews && remoteReviews.length > 0) {
        setReviews((prev) => {
          const otherReviews = prev.filter((r) => r.productId !== selectedProduct.id);
          return [...remoteReviews, ...otherReviews];
        });
      }
    });
  }, [selectedProduct]);

  // Synchronize user's conversations from Supabase on login / mount
  useEffect(() => {
    if (!currentUser || !isSupabaseConfigured()) return;
    fetchConversations(currentUser.id, currentUser.role).then((remoteConvs) => {
      if (remoteConvs && remoteConvs.length > 0) {
        setConversations((prev) => {
          const existingIds = new Set(remoteConvs.map((c) => c.id));
          const localOnly = prev.filter((c) => !existingIds.has(c.id));
          return [...remoteConvs, ...localOnly];
        });
      }
    });
  }, [currentUser]);

  // Fetch artisan profile from Supabase when artisan logs in
  useEffect(() => {
    if (!currentUser || currentUser.role !== 'artisan' || !isSupabaseConfigured()) return;
    fetchArtisanProfile(currentUser.id).then((profile) => {
      if (profile) setArtisanProfile(profile);
    });
  }, [currentUser]);

  // Synchronize buyer recommendations from Supabase
  useEffect(() => {
    if (role !== 'buyer' || !isSupabaseConfigured()) return;
    const buyerId = currentUser?.id || '00000000-0000-0000-0000-000000000201';
    fetchBuyerRecommendations(buyerId).then((recs) => {
      if (recs && recs.length > 0) {
        setRecommendedProducts(recs);
      }
    });
  }, [role, currentUser, products.length]);

  // One-time cleanup of legacy test records (runs once per browser, guarded by localStorage flag)
  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const cleaned = localStorage.getItem('shilp_ai_legacy_cleaned');
    if (!cleaned) {
      cleanupLegacyTestRecords().then(() => {
        localStorage.setItem('shilp_ai_legacy_cleaned', 'true');
      }).catch((err) => {
        console.warn('[Shilp-AI] Legacy cleanup notice:', err);
      });
    }
  }, []);


  const handleOnboardingClose = () => {
    setShowOnboarding(false);
    localStorage.setItem('shilp_ai_onboarding_seen', 'true');
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Product Creation Callback — save to Supabase (only database write)
  const handleListingCreated = (newProduct: ProductListing) => {
    setProducts((prev) => [newProduct, ...prev]);
    setArtisanTab('dashboard');
    showToast(t('success.published'));

    // Save to Supabase
    saveProductToSupabase(newProduct).catch((err) =>
      console.warn('Supabase product save notice:', err)
    );
  };


  // Staging Photo from Studio to Smart Catalog
  const handlePhotoSelectedFromStudio = (enhancedUrl: string, originalUrl?: string) => {
    setStagedPhotoUrl(enhancedUrl);
    if (originalUrl) {
      setStagedOriginalPhotoUrl(originalUrl);
    }
    setCatalogSubView('voice'); // Always start at voice cataloger step
    setStagedCatalogProduct(null);
    setArtisanTab('voice');
    showToast(translate(language, 'success.published') || 'AI enhanced photo selected for Smart Catalog!');
  };

  // 1-to-1 Chat Messaging System (Supabase Realtime backed)
  const handleSendMessage = async (
    conversationId: string,
    text: string,
    customizationRequest?: CustomizationRequest,
    imageUrl?: string
  ) => {
    const now = new Date();
    const timestamp = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const senderRole = currentUser?.role || role;
    const senderName = currentUser?.name || (role === 'buyer' ? 'Vikram Mehta' : CURRENT_ARTISAN.name);
    const senderId = currentUser?.id || (role === 'buyer' ? '00000000-0000-0000-0000-000000000201' : CURRENT_ARTISAN.id);

    const message: ChatMessage = {
      id: `msg-${Date.now()}`,
      conversationId,
      senderId,
      senderRole,
      senderName,
      text,
      timestamp,
      customizationRequest,
      isRead: false,
      imageUrl,
    };

    setConversations((prev) =>
      prev.map((conv) => {
        if (conv.id === conversationId) {
          const updatedConv = {
            ...conv,
            messages: [...conv.messages.filter(m => m.id !== message.id), message],
            lastMessageAt: timestamp,
            unreadCount: 0,
          };
          if (isSupabaseConfigured()) {
            upsertConversation(updatedConv);
          }
          return updatedConv;
        }
        return conv;
      })
    );

    if (isSupabaseConfigured()) {
      await saveMessageToSupabase(message);
    }
  };

  const handleStartConversation = async (
    artisanId: string,
    artisanName: string,
    productId?: string,
    productTitle?: string
  ) => {
    const currentBuyerId = currentUser?.id || '00000000-0000-0000-0000-000000000201';
    const currentBuyerName = currentUser?.name || 'Vikram Mehta';

    const existing = conversations.find(
      (c) => c.buyerId === currentBuyerId && c.artisanId === artisanId && c.productId === productId
    );

    if (existing) {
      if (role === 'artisan') {
        setArtisanTab('chat');
      } else {
        setBuyerTab('chat');
      }
      return existing.id;
    }

    const convId = `conv-${Date.now()}`;
    const initialMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      conversationId: convId,
      senderId: currentBuyerId,
      senderRole: 'buyer',
      senderName: currentBuyerName,
      text: `Namaste ${artisanName}! I am interested in discussing your craft "${productTitle || 'item'}".`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isRead: false,
    };

    const newConversation: Conversation = {
      id: convId,
      buyerId: currentBuyerId,
      buyerName: currentBuyerName,
      artisanId,
      artisanName,
      productId,
      productTitle,
      messages: [initialMsg],
      lastMessageAt: initialMsg.timestamp,
      unreadCount: 1,
    };

    setConversations((prev) => [newConversation, ...prev]);
    if (role === 'artisan') {
      setArtisanTab('chat');
    } else {
      setBuyerTab('chat');
    }
    showToast('Conversation started with artisan!');
    if (isSupabaseConfigured()) {
      await upsertConversation(newConversation);
      await saveMessageToSupabase(initialMsg);
    }

    return convId;
  };

  // Reviews System — persisted to Supabase with UNIQUE(product_id, buyer_id) duplicate prevention
  const handleAddReview = async (review: ProductReview) => {
    const { error, isDuplicate } = await saveReviewToSupabase(review);

    if (isDuplicate) {
      showToast('You have already submitted a review for this product.');
      return;
    }

    if (error && isSupabaseConfigured()) {
      console.warn('[Supabase] Review save notice:', error.message);
    }

    setReviews((prev) => [review, ...prev.filter(r => !(r.productId === review.productId && r.buyerId === review.buyerId))]);
    showToast(t('success.reviewSubmitted'));
  };

  const getProductReviews = (productId: string) => {
    return reviews.filter((r) => r.productId === productId);
  };

  // Purchase / Checkout Flow
  const handleOrderSuccess = async (order: PlacedOrder) => {
    showToast(`Order #${order.id} placed! Artisan notified via SMS.`);
    if (isSupabaseConfigured()) {
      await saveOrderToSupabase({
        id: order.id,
        productId: order.productId,
        buyerId: currentUser?.id || '00000000-0000-0000-0000-000000000201',
        buyerName: order.buyerName,
        artisanId: order.artisanId,
        quantity: order.quantity,
        totalAmount: order.totalAmount,
        status: 'placed',
      });
    }
  };

  return (
    <>
      <LanguageAutoTranslator language={language} />
    <div className="min-h-screen min-h-[100dvh] bg-[#FAF8F5] dark:bg-[#070B14] text-stone-900 dark:text-stone-100 font-sans flex flex-col w-full max-w-full overflow-x-hidden transition-colors duration-250">
      {/* Universal Government & Application Navbar */}
      <Navbar
        role={role}
        setRole={(newRole) => {
          setRole(newRole);
          if (currentUser) {
            setCurrentUser({ ...currentUser, role: newRole });
          }
        }}
        language={language}
        setLanguage={setLanguage}
        isMobileFrame={isMobileFrame}
        setIsMobileFrame={setIsMobileFrame}
        currentUser={currentUser}
        onOpenAuth={() => setShowAuthModal(true)}
        onLogout={() => {
          setCurrentUser(null);
          setArtisanProfile(null);
          setShowAuthModal(true);
          showToast('Signed out successfully.');
        }}
        onOpenCardModal={() => setShowCardModal(true)}
        onOpenTutorial={() => setShowOnboarding(true)}
        isLightOn={isLightOn}
        onToggleLightMode={toggleLightMode}
      />

      {/* Floating Success Toast */}
      {toastMessage && (
        <div className="fixed top-20 right-4 z-50 bg-stone-900 text-white px-4 py-3 rounded-2xl shadow-xl border border-stone-700 flex items-center space-x-2 text-xs font-semibold animate-bounce">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* First-Time Onboarding Tutorial */}
      {showOnboarding && (
        <OnboardingTutorial language={language} onClose={handleOnboardingClose} />
      )}

      {/* MoSJE Digital Artisan Smart ID Card Modal */}
      <ArtisanCardModal
        isOpen={showCardModal}
        onClose={() => setShowCardModal(false)}
        language={language}
        artisan={artisanProfile ? {
          id: artisanProfile.id,
          name: artisanProfile.name || currentUser?.name || CURRENT_ARTISAN.name,
          regionalName: artisanProfile.regional_name || artisanProfile.name || currentUser?.name || CURRENT_ARTISAN.regionalName,
          phone: artisanProfile.phone || currentUser?.phoneOrEmail || CURRENT_ARTISAN.phone,
          craftCluster: artisanProfile.craft_cluster || CURRENT_ARTISAN.craftCluster,
          district: artisanProfile.district || CURRENT_ARTISAN.district,
          state: artisanProfile.state || CURRENT_ARTISAN.state,
          beneficiaryId: artisanProfile.beneficiary_id || currentUser?.beneficiaryId || CURRENT_ARTISAN.beneficiaryId,
          shilpCardNumber: artisanProfile.shilp_card_number || artisanProfile.shilp_artisan_id || CURRENT_ARTISAN.shilpCardNumber,
          avatarUrl: artisanProfile.avatar_url || currentUser?.avatarUrl || CURRENT_ARTISAN.avatarUrl,
          giTagCraft: artisanProfile.gi_tag_craft || CURRENT_ARTISAN.giTagCraft,
          experienceYears: artisanProfile.experience_years || CURRENT_ARTISAN.experienceYears,
          exhibitions: artisanProfile.exhibitions || CURRENT_ARTISAN.exhibitions,
          rating: artisanProfile.rating || CURRENT_ARTISAN.rating,
          totalSalesCount: artisanProfile.total_sales_count || CURRENT_ARTISAN.totalSalesCount,
          totalEarnings: artisanProfile.total_earnings || CURRENT_ARTISAN.totalEarnings,
          bankLinked: artisanProfile.bank_linked ?? CURRENT_ARTISAN.bankLinked,
        } : (currentUser && currentUser.role === 'artisan' ? {
          ...CURRENT_ARTISAN,
          id: currentUser.id,
          name: currentUser.name || CURRENT_ARTISAN.name,
          phone: currentUser.phoneOrEmail || CURRENT_ARTISAN.phone,
          beneficiaryId: currentUser.beneficiaryId || CURRENT_ARTISAN.beneficiaryId,
          avatarUrl: currentUser.avatarUrl || CURRENT_ARTISAN.avatarUrl,
        } : CURRENT_ARTISAN)}
      />

      {/* ── First-Launch Language Selection Screen (21 Sarvam Supported Languages) ── */}
      {showLanguageScreen && (
        <div className="fixed inset-0 z-50 bg-gradient-to-b from-amber-50 via-stone-50 to-stone-100 flex flex-col items-center justify-center p-4 sm:p-6 overflow-y-auto">
          <div className="w-full max-w-2xl flex flex-col items-center gap-5 my-auto max-h-[92dvh]">
            {/* Logo / Brand */}
            <div className="flex flex-col items-center gap-1.5 text-center">
              <div className="w-14 h-14 rounded-2xl bg-stone-900 flex items-center justify-center shadow-lg">
                <Sparkles className="w-7 h-7 text-amber-400" />
              </div>
              <h1 className="text-2xl font-extrabold text-stone-900 tracking-tight">SHILP-AI</h1>
              <p className="text-xs text-stone-500">Ministry of Social Justice and Empowerment · Sarvam AI Multilingual Linkage</p>
            </div>

            {/* Language Prompt */}
            <div className="text-center">
              <p className="text-lg font-bold text-stone-800">अपनी भाषा चुनें / Select Your Language</p>
              <p className="text-xs text-stone-500 mt-0.5">Choose from 21 Sarvam AI Supported Languages</p>
            </div>

            {/* 21 Sarvam AI Languages Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 w-full max-h-[50dvh] overflow-y-auto p-1 border border-stone-200/80 rounded-2xl bg-white/70 shadow-inner">
              {[
                { code: 'hi', label: 'हिन्दी', sub: 'Hindi' },
                { code: 'en', label: 'English', sub: 'English' },
                { code: 'te', label: 'తెలుగు', sub: 'Telugu' },
                { code: 'ta', label: 'தமிழ்', sub: 'Tamil' },
                { code: 'bn', label: 'বাংলা', sub: 'Bengali' },
                { code: 'mr', label: 'मराठी', sub: 'Marathi' },
                { code: 'gu', label: 'ગુજરાતી', sub: 'Gujarati' },
                { code: 'kn', label: 'ಕನ್ನಡ', sub: 'Kannada' },
                { code: 'ml', label: 'മലയാളം', sub: 'Malayalam' },
                { code: 'or', label: 'ଓଡ଼ିଆ', sub: 'Odia' },
                { code: 'pa', label: 'ਪੰਜਾਬੀ', sub: 'Punjabi' },
                { code: 'as', label: 'অসমীয়া', sub: 'Assamese' },
                { code: 'mai', label: 'मैथिली', sub: 'Maithili' },
                { code: 'sa', label: 'संस्कृतम्', sub: 'Sanskrit' },
                { code: 'ur', label: 'اُردُو', sub: 'Urdu' },
                { code: 'ne', label: 'नेपाली', sub: 'Nepali' },
                { code: 'sd', label: 'سنڌي', sub: 'Sindhi' },
                { code: 'kok', label: 'कोंकणी', sub: 'Konkani' },
                { code: 'doi', label: 'डोगरी', sub: 'Dogri' },
                { code: 'sat', label: 'ᱥᱟᱱᱛᱟᱲᱤ', sub: 'Santali' },
                { code: 'ks', label: 'कश्मीरी', sub: 'Kashmiri' },
              ].map((lang) => (
                <button
                  key={lang.code}
                  onClick={() => {
                    setLanguage(lang.code as any);
                    try {
                      localStorage.setItem('shilp_ai_preferred_language', lang.code);
                    } catch {}
                    setShowLanguageScreen(false);
                    setShowAuthModal(true);
                  }}
                  className={`flex flex-col items-center justify-center gap-0.5 p-3 rounded-xl border transition-all shadow-xs active:scale-95 ${
                    language === lang.code
                      ? 'border-amber-500 bg-amber-50 font-bold'
                      : 'border-stone-200 bg-white hover:border-amber-400 hover:bg-amber-50/50'
                  }`}
                >
                  <span className="text-base font-extrabold text-stone-900">{lang.label}</span>
                  <span className="text-[11px] text-stone-500">{lang.sub}</span>
                </button>
              ))}
            </div>

            {/* MoSJE badge */}
            <p className="text-[10.5px] text-stone-400 text-center">
              Govt. of India Initiative · MoSJE · Powered by Sarvam AI Multilingual Engine
            </p>
          </div>
        </div>
      )}

      {/* Authentication Modal — required; cannot be dismissed when unauthenticated */}
      <AuthModal
        isOpen={showAuthModal && !showLanguageScreen}
        onClose={() => {
          // Only allow closing the auth modal if already signed in
          if (currentUser) setShowAuthModal(false);
        }}
        onLoginSuccess={(user) => {
          setCurrentUser(user);
          setRole(user.role);
          showToast(`Welcome, ${user.name}!`);
          setShowAuthModal(false);

          if (user.onboardingComplete) {
            // Existing user login: mark onboarding seen so tutorial guide is NOT shown
            localStorage.setItem('shilp_ai_onboarding_seen', 'true');
          } else {
            // New user registration: trigger account setup wizard
            if (user.role === 'artisan') {
              setShowArtisanOnboarding(true);
            } else {
              // New buyer registration complete: mark complete & show guide
              user.onboardingComplete = true;
              localStorage.setItem('shilp_ai_current_user', JSON.stringify(user));
              const hasSeenOnboarding = localStorage.getItem('shilp_ai_onboarding_seen');
              if (!hasSeenOnboarding) {
                setShowOnboarding(true);
              }
            }
          }
        }}
        currentRole={role}
      />

      {/* Artisan Onboarding Wizard (triggered after artisan login for new users) */}
      {showArtisanOnboarding && (
        <ArtisanOnboarding
          onClose={() => {
            setShowArtisanOnboarding(false);
            showToast('Artisan profile created! Welcome to Shilp-AI.');
            if (currentUser) {
              currentUser.onboardingComplete = true;
              localStorage.setItem('shilp_ai_current_user', JSON.stringify(currentUser));
              if (isSupabaseConfigured()) {
                fetchArtisanProfile(currentUser.id).then((profile) => {
                  if (profile) setArtisanProfile(profile);
                });
              }
            }
            // ONLY THEN show the onboarding guide tutorial after profile is saved!
            const hasSeenOnboarding = localStorage.getItem('shilp_ai_onboarding_seen');
            if (!hasSeenOnboarding) {
              setShowOnboarding(true);
            }
          }}
          authenticatedUserId={currentUser?.id}
        />
      )}


      {/* Direct Artisan Checkout Modal */}
      {productToCheckout && (
        <CheckoutModal
          isOpen={true}
          onClose={() => setProductToCheckout(null)}
          product={productToCheckout}
          language={language}
          onOrderSuccess={handleOrderSuccess}
          buyerId={currentUser?.id || '00000000-0000-0000-0000-000000000201'}
        />
      )}

      {/* Main Content Area wrapped in optional Mobile Smartphone Simulator Frame */}
      <main className="flex-1 w-full max-w-full overflow-x-hidden flex flex-col justify-start">
        <MobileFrame isMobileFrame={isMobileFrame} setIsMobileFrame={setIsMobileFrame}>
          {isMobileFrame || isMobileScreen ? (
            /* Dedicated Native Mobile Application */
            <MobileNativeApp
              products={products}
              currentUser={currentUser}
              role={role}
              setRole={(newRole) => {
                setRole(newRole);
                if (currentUser) {
                  setCurrentUser({ ...currentUser, role: newRole });
                }
              }}
              language={language}
              setLanguage={setLanguage}
              conversations={conversations}
              onSendMessage={handleSendMessage}
              reviews={reviews}
              onSelectProduct={(prod) => setSelectedProduct(prod)}
              onStartConversation={(aId, aName, pId, pTitle) => { handleStartConversation(aId, aName, pId, pTitle); }}
              onBuyNow={(prod) => {
                setSelectedProduct(null);
                setProductToCheckout(prod);
              }}
              onOpenAuth={() => setShowAuthModal(true)}
              onLogout={() => {
                setCurrentUser(null);
                setArtisanProfile(null);
                setShowAuthModal(true);
                showToast('Signed out successfully.');
              }}
              onOpenCardModal={() => setShowCardModal(true)}
              onOpenTutorial={() => setShowOnboarding(true)}
              isLightOn={isLightOn}
              onToggleLightMode={toggleLightMode}
              onListingCreated={handleListingCreated}
            />
          ) : (
            <div className="max-w-7xl mx-auto px-2.5 sm:px-6 lg:px-8 py-3 sm:py-5 w-full max-w-full overflow-x-hidden flex-1 flex flex-col">
              {role === 'buyer' ? (
                /* Buyer / Government Portal View */
                <div className="space-y-3 sm:space-y-4 flex-1 flex flex-col w-full max-w-full overflow-x-hidden">
                  {/* Buyer Navigation & Controls Bar */}
                  <div className="bg-white p-1.5 rounded-2xl border border-stone-200/90 shadow-[0_1px_3px_rgba(0,0,0,0.03)] flex items-center justify-between gap-1 overflow-x-auto no-scrollbar w-full max-w-full touch-pan-x">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setBuyerTab('explore')}
                        className={`flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-medium transition-all whitespace-nowrap shrink-0 ${
                          buyerTab === 'explore'
                            ? 'bg-stone-900 text-white shadow-xs font-semibold'
                            : 'text-stone-600 hover:text-stone-900 hover:bg-stone-50'
                        }`}
                      >
                        <ShoppingBag className="w-4 h-4" />
                        <span>{language === 'hi' ? 'शिल्प बाज़ार (Explore)' : 'Explore Crafts'}</span>
                      </button>

                      <button
                        onClick={() => setBuyerTab('chat')}
                        className={`flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-medium transition-all whitespace-nowrap shrink-0 ${
                          buyerTab === 'chat'
                            ? 'bg-stone-900 text-white shadow-xs font-semibold'
                            : 'text-stone-600 hover:text-stone-900 hover:bg-stone-50'
                        }`}
                      >
                        <MessageSquare className="w-4 h-4" />
                        <span>{language === 'hi' ? 'कारीगर संदेश (Messages)' : 'Artisan Messages'}</span>
                        {conversations.length > 0 && (
                          <span className="bg-amber-100 text-amber-900 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                            {conversations.length}
                          </span>
                        )}
                      </button>
                    </div>

                    <button
                      onClick={() => setShowCardModal(true)}
                      className="px-3.5 py-1.5 rounded-xl border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-900 text-xs font-bold flex items-center gap-1.5 transition-colors shrink-0"
                    >
                      <ShieldCheck className="w-4 h-4 text-amber-600" />
                      <span className="hidden sm:inline">Artisan Smart ID Registry</span>
                    </button>
                  </div>

                  {buyerTab === 'explore' ? (
                    <BuyerPortal
                      products={products}
                      onSelectProduct={(prod) => setSelectedProduct(prod)}
                      onStartConversation={handleStartConversation}
                      onLaunchStudio={() => {
                        setRole('artisan');
                        setArtisanTab('studio');
                      }}
                      onOpenCardModal={() => setShowCardModal(true)}
                      language={language}
                      buyerId={currentUser?.id || '00000000-0000-0000-0000-000000000201'}
                      buyerName={currentUser?.name || 'Wholesale Buyer'}
                      buyerCompanyName={currentUser?.companyName}
                      buyerPhone={currentUser?.phoneOrEmail}
                      recommendedProducts={recommendedProducts}
                    />
                  ) : (
                    <ChatMessaging
                      conversations={conversations}
                      currentUserId={currentUser?.id || '00000000-0000-0000-0000-000000000201'}
                      currentUserRole="buyer"
                      currentUserName={currentUser?.name || 'Wholesale Buyer'}
                      language={language}
                      onSendMessage={handleSendMessage}
                      onStartConversation={handleStartConversation}
                    />
                  )}
                </div>
              ) : (
                /* Artisan App View with Navigation */
              <div className="space-y-3 sm:space-y-4 flex-1 flex flex-col w-full max-w-full overflow-x-hidden">
                {/* Mobile / Low-Literacy Quick Switcher Bar */}
                <div className="bg-white dark:bg-[#0F172A] p-1.5 rounded-2xl border-2 border-[#EADCD5] dark:border-stone-800 shadow-[0_2px_8px_rgba(200,90,50,0.06)] flex items-center gap-1 overflow-x-auto no-scrollbar w-full max-w-full touch-pan-x">
                  <button
                    onClick={() => setRole('buyer')}
                    className="flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap shrink-0 bg-gradient-to-r from-amber-500 to-amber-600 text-stone-950 shadow-xs hover:opacity-90"
                    title="View Heritage Hero & Craft Showcase"
                  >
                    <Sparkles className="w-4 h-4 text-stone-950" />
                    <span>Heritage Showcase 🏛️</span>
                  </button>

                  <button
                    onClick={() => setArtisanTab('dashboard')}
                    className={`flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all whitespace-nowrap shrink-0 ${
                      artisanTab === 'dashboard'
                        ? 'bg-[#C85A32] text-white shadow-xs font-bold'
                        : 'text-stone-600 dark:text-stone-300 hover:text-[#C85A32] dark:hover:text-amber-300 hover:bg-[#FAF0EB] dark:hover:bg-[#1A2644]'
                    }`}
                  >
                    <Home className="w-4 h-4" />
                    <span>{t('nav.home')}</span>
                  </button>

                  <button
                    onClick={() => setArtisanTab('studio')}
                    className={`flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all whitespace-nowrap shrink-0 ${
                      artisanTab === 'studio'
                        ? 'bg-[#C85A32] text-white shadow-xs font-bold'
                        : 'text-stone-600 dark:text-stone-300 hover:text-[#C85A32] dark:hover:text-amber-300 hover:bg-[#FAF0EB] dark:hover:bg-[#1A2644]'
                    }`}
                  >
                    <Camera className="w-4 h-4" />
                    <span>{t('nav.studio')}</span>
                  </button>

                  <button
                    onClick={() => setArtisanTab('voice')}
                    className={`flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all whitespace-nowrap shrink-0 ${
                      artisanTab === 'voice'
                        ? 'bg-[#C85A32] text-white shadow-xs font-bold'
                        : 'text-stone-600 dark:text-stone-300 hover:text-[#C85A32] dark:hover:text-amber-300 hover:bg-[#FAF0EB] dark:hover:bg-[#1A2644]'
                    }`}
                  >
                    <Mic className="w-4 h-4" />
                    <span>{t('nav.voice')}</span>
                  </button>

                  <button
                    onClick={() => setArtisanTab('copilot')}
                    className={`flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all whitespace-nowrap shrink-0 ${
                      artisanTab === 'copilot'
                        ? 'bg-[#C85A32] text-white shadow-xs font-bold'
                        : 'text-stone-600 dark:text-stone-300 hover:text-[#C85A32] dark:hover:text-amber-300 hover:bg-[#FAF0EB] dark:hover:bg-[#1A2644]'
                    }`}
                  >
                    <Bot className="w-4 h-4" />
                    <span>ShilpSaathi</span>
                  </button>

                  <button
                    onClick={() => setArtisanTab('pricing')}
                    className={`flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all whitespace-nowrap shrink-0 ${
                      artisanTab === 'pricing'
                        ? 'bg-[#C85A32] text-white shadow-xs font-bold'
                        : 'text-stone-600 dark:text-stone-300 hover:text-[#C85A32] dark:hover:text-amber-300 hover:bg-[#FAF0EB] dark:hover:bg-[#1A2644]'
                    }`}
                  >
                    <IndianRupee className="w-4 h-4" />
                    <span>{t('nav.pricing')}</span>
                  </button>

                  {/* Messages Tab */}
                  <button
                    onClick={() => setArtisanTab('chat')}
                    className={`flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all whitespace-nowrap shrink-0 ${
                      artisanTab === 'chat'
                        ? 'bg-[#C85A32] text-white shadow-xs font-bold'
                        : 'text-stone-600 dark:text-stone-300 hover:text-[#C85A32] dark:hover:text-amber-300 hover:bg-[#FAF0EB] dark:hover:bg-[#1A2644]'
                    }`}
                  >
                    <MessageSquare className="w-4 h-4" />
                    <span>{t('chat.title')}</span>
                    {conversations.length > 0 && (
                      <span className="bg-[#FAF0EB] dark:bg-stone-800 text-[#A33F1B] dark:text-amber-300 border border-[#E8CEBF] dark:border-stone-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                        {conversations.length}
                      </span>
                    )}
                  </button>

                  {/* Reviews Tab */}
                  <button
                    onClick={() => setArtisanTab('reviews')}
                    className={`flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all whitespace-nowrap shrink-0 ${
                      artisanTab === 'reviews'
                        ? 'bg-[#C85A32] text-white shadow-xs font-bold'
                        : 'text-stone-600 dark:text-stone-300 hover:text-[#C85A32] dark:hover:text-amber-300 hover:bg-[#FAF0EB] dark:hover:bg-[#1A2644]'
                    }`}
                  >
                    <Star className="w-4 h-4" />
                    <span>{t('review.title')}</span>
                  </button>

                  {/* Tutorials Tab */}
                  <button
                    onClick={() => setArtisanTab('tutorials')}
                    className={`flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all whitespace-nowrap shrink-0 ${
                      artisanTab === 'tutorials'
                        ? 'bg-[#C85A32] text-white shadow-xs font-bold'
                        : 'text-stone-600 dark:text-stone-300 hover:text-[#C85A32] dark:hover:text-amber-300 hover:bg-[#FAF0EB] dark:hover:bg-[#1A2644]'
                    }`}
                  >
                    <Video className="w-4 h-4" />
                    <span>{translate(language, 'nav.tutorials') || (language === 'hi' ? 'ट्यूटोरियल' : 'Tutorials')}</span>
                    <span className="bg-[#FAF0EB] dark:bg-stone-800 text-[#A33F1B] dark:text-amber-300 border border-[#E8CEBF] dark:border-stone-700 text-[10px] font-bold px-1.5 py-0.2 rounded-full">
                      2
                    </span>
                  </button>
                </div>

                {/* Sub-Views */}
                <div className="flex-1">
                  {artisanTab === 'dashboard' && (
                    <ArtisanDashboard
                      products={products}
                      onOpenStudio={() => setArtisanTab('studio')}
                      onOpenVoice={() => setArtisanTab('voice')}
                      onOpenCopilot={() => setArtisanTab('copilot')}
                      onOpenPricing={() => setArtisanTab('pricing')}
                      onOpenTutorials={() => setArtisanTab('tutorials')}
                      onSelectProduct={(prod) => setSelectedProduct(prod)}
                      language={language}
                      artisanId={currentUser?.id || '00000000-0000-0000-0000-000000000101'}
                      artisanName={artisanProfile?.name || currentUser?.name || 'Artisan'}
                      artisanRegionalName={artisanProfile?.regional_name || artisanProfile?.name || currentUser?.name}
                      artisanAvatarUrl={artisanProfile?.avatar_url || currentUser?.avatarUrl}
                      artisanCraftCluster={artisanProfile?.craft_cluster || 'Traditional Handicraft Cluster'}
                      artisanState={artisanProfile?.state || 'India'}
                      artisanBeneficiaryId={artisanProfile?.beneficiary_id || currentUser?.beneficiaryId || 'MoSJE-NBCFDC-2026'}
                      artisanGiTagCraft={artisanProfile?.gi_tag_craft || 'Handicraft & Handloom'}
                      artisanShilpCardNumber={artisanProfile?.shilp_card_number || artisanProfile?.shilp_artisan_id}
                      artisanExhibitions={artisanProfile?.exhibitions || undefined}
                      conversations={conversations}
                      reviews={reviews}
                    />
                  )}

                  {artisanTab === 'tutorials' && (
                    <TutorialPage
                      onBack={() => setArtisanTab('dashboard')}
                      language={language}
                    />
                  )}

                  {artisanTab === 'studio' && (
                    <ArtisanStudio
                      onPhotoSelected={handlePhotoSelectedFromStudio}
                      language={language}
                    />
                  )}

                  {artisanTab === 'voice' && (
                    catalogSubView === 'review' && stagedCatalogProduct ? (
                      <ProductSubmitReview
                        product={stagedCatalogProduct}
                        language={language}
                        onSubmitted={(product) => {
                          handleListingCreated(product);
                          // Reset catalog sub-flow after publish
                          setCatalogSubView('voice');
                          setStagedCatalogProduct(null);
                        }}
                        onBack={() => setCatalogSubView('voice')}
                      />
                    ) : (
                      <VoiceCatalogerModal
                        language={language}
                        selectedPhotoUrl={stagedPhotoUrl || undefined}
                        originalPhotoUrl={stagedOriginalPhotoUrl || undefined}
                        onReadyForReview={(listing) => {
                          setStagedCatalogProduct(listing);
                          setCatalogSubView('review');
                        }}
                        onListingCreated={handleListingCreated}
                      />
                    )
                  )}

                  {artisanTab === 'copilot' && (
                    <ArtisanCopilot
                      language={language}
                      onPublishListing={handleListingCreated}
                    />
                  )}

                  {artisanTab === 'pricing' && (
                    <div className="max-w-2xl mx-auto">
                      <DynamicPricingCard language={language} />
                    </div>
                  )}

                  {artisanTab === 'chat' && (
                    <ChatMessaging
                      conversations={conversations}
                      currentUserId={currentUser?.id || '00000000-0000-0000-0000-000000000101'}
                      currentUserRole={currentUser?.role || 'artisan'}
                      currentUserName={artisanProfile?.name || currentUser?.name || 'Master Artisan'}
                      language={language}
                      onSendMessage={handleSendMessage}
                      onStartConversation={handleStartConversation}
                    />
                  )}

                  {artisanTab === 'reviews' && (
                    <div className="space-y-4">
                      {products.map((product) => (
                        <ReviewsSection
                          key={product.id}
                          productId={product.id}
                          productTitle={product.titleEn}
                          reviews={getProductReviews(product.id)}
                          language={language}
                          currentBuyerName={currentUser?.name || 'Wholesale Buyer'}
                          currentBuyerId={currentUser?.id || ((role as string) === 'buyer' ? '00000000-0000-0000-0000-000000000201' : '00000000-0000-0000-0000-000000000101')}
                          currentUserRole="artisan"
                          onAddReview={handleAddReview}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
        </MobileFrame>
      </main>

      {/* Product Detail & Inspection Modal */}
      {selectedProduct && (
        <ProductDetailModal
          product={selectedProduct}
          onClose={() => setSelectedProduct(null)}
          onRequestQuote={() => {
            setSelectedProduct(null);
            setRole('buyer');
          }}
          onBuyNow={(prod) => {
            setSelectedProduct(null);
            setProductToCheckout(prod);
          }}
          onStartConversation={handleStartConversation}
          onOpenArtisanProfile={() => setShowCardModal(true)}
          language={language}
          reviews={reviews}
          onAddReview={handleAddReview}
          currentBuyerName={currentUser?.name || 'Wholesale Buyer'}
          currentBuyerId={currentUser?.id || ((role as string) === 'buyer' ? '00000000-0000-0000-0000-000000000201' : '00000000-0000-0000-0000-000000000101')}
        />
      )}

      {/* Bottom Footer (Shown on desktop) */}
      {!isMobileScreen && !isMobileFrame && (
        <footer className="bg-stone-900 text-stone-400 py-6 text-center text-xs border-t border-stone-800">
          <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center space-x-2">
              <span className="font-extrabold text-white">SHILP-AI</span>
              <span>•</span>
              <span>Ministry of Social Justice and Empowerment (MoSJE), Government of India</span>
            </div>
            <div className="text-[11px] text-stone-500">
              Heritage & Culture • AI-Driven Market Linkage for Marginalized Artisans
            </div>
          </div>
        </footer>
      )}
    </div>
    </>
  );
}

export default App;
