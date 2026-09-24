import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Search, 
  Award, 
  ShieldCheck, 
  MessageSquare, 
  Building2, 
  CheckCircle2, 
  Send, 
  X, 
  Sparkles, 
  Loader2, 
  ArrowDown,
  ChevronDown,
  ChevronUp,
  SlidersHorizontal,
  RotateCcw,
  Camera,
  Layers,
  Image as ImageIcon
} from 'lucide-react';
import { ProductListing, Language } from '../types';
import { CURRENT_ARTISAN } from '../data/craftPresets';
import { HeritageHeroSection } from './HeritageHeroSection';
import { CraftAtlasExplorer } from './CraftAtlasExplorer';
import { useMobileMode } from './MobileFrame';
import { translate } from '../services/translations';
import { saveRFQToSupabase } from '../services/supabase';
import {
  getProductTitle,
  getProductDescription,
  getCategoryTranslation,
  getCraftTechniqueTranslation
} from '../services/displayTranslation';

interface BuyerPortalProps {
  products: ProductListing[];
  onSelectProduct: (product: ProductListing) => void;
  onStartConversation?: (artisanId: string, artisanName: string, productId?: string, productTitle?: string) => void;
  onOpenCardModal?: () => void;
  language?: Language;
  onLaunchStudio?: () => void;
  buyerId?: string;
  buyerName?: string;
  buyerCompanyName?: string;
  buyerPhone?: string;
  recommendedProducts?: ProductListing[];
}

/**
 * Museum-Style Lazy Image with loading shimmer and fallback
 */
const LazyProductImage: React.FC<{
  src: string;
  alt: string;
  className?: string;
}> = ({ src, alt, className = '' }) => {
  const [loaded, setLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#FAF7F2] dark:bg-[#131B2E] flex items-center justify-center">
      {!loaded && !hasError && (
        <div className="absolute inset-0 bg-gradient-to-r from-stone-200 via-stone-100 to-stone-200 dark:from-stone-800 dark:via-stone-700 dark:to-stone-800 animate-pulse flex items-center justify-center">
          <div className="flex items-center gap-1.5 text-stone-400 dark:text-stone-500 text-[11px] font-mono">
            <Sparkles className="w-3.5 h-3.5 text-amber-500 animate-spin" />
            <span>Loading...</span>
          </div>
        </div>
      )}
      <img
        src={hasError ? 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?auto=format&fit=crop&w=800&q=80' : src}
        alt={alt}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => {
          setHasError(true);
          setLoaded(true);
        }}
        className={`${className} transition-opacity duration-500 ease-in-out ${
          loaded ? 'opacity-100' : 'opacity-0'
        }`}
      />
    </div>
  );
};

export const BuyerPortal: React.FC<BuyerPortalProps> = ({
  products,
  onSelectProduct,
  onStartConversation,
  language = 'en',
  onLaunchStudio,
  onOpenCardModal,
  buyerId,
  buyerName = 'B2B Buyer',
  buyerCompanyName,
  buyerPhone,
  recommendedProducts = [],
}) => {
  const { isMobileMode } = useMobileMode();
  // Search & Faceted Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedWorkTypes, setSelectedWorkTypes] = useState<string[]>([]);
  const [selectedStates, setSelectedStates] = useState<string[]>([]);
  const [selectedMaterials, setSelectedMaterials] = useState<string[]>([]);
  const [onlyGICertified, setOnlyGICertified] = useState(false);
  const [sortBy, setSortBy] = useState<'relevance' | 'price-asc' | 'price-desc' | 'days'>('relevance');

  // Accordion Expand / Collapse States (Vastra Shilpa Kosh style)
  const [expandedAccordions, setExpandedAccordions] = useState<Record<string, boolean>>({
    mainCategory: true,
    functionalCategory: true,
    workType: true,
    state: true,
    material: false,
    certification: true
  });

  // Mobile drawer state
  const [isMobileFiltersOpen, setIsMobileFiltersOpen] = useState(false);

  // RFQ Modal State
  const [activeRFQProduct, setActiveRFQProduct] = useState<ProductListing | null>(null);
  const [rfqSubmitted, setRfqSubmitted] = useState(false);

  // Lazy Loading & Pagination State (8 items per batch for 4-col grid)
  const BATCH_SIZE = 8;
  const [visibleCount, setVisibleCount] = useState<number>(BATCH_SIZE);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // RFQ Form State
  const [rfqForm, setRfqForm] = useState({
    companyName: buyerCompanyName || 'Crafts Procurement Ltd',
    buyerName: buyerName,
    email: '',
    phone: buyerPhone || '',
    quantity: 25,
    targetDate: '2026-04-15',
    notes: 'Required for corporate festive gifting. Needs authentic MoSJE GI certification tag included.'
  });

  const toggleAccordion = (key: string) => {
    setExpandedAccordions(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  // Distinct Categories with dynamic counts
  const availableCategories = useMemo(() => {
    const map = new Map<string, number>();
    products.forEach(p => {
      map.set(p.category, (map.get(p.category) || 0) + 1);
    });
    return Array.from(map.entries()).map(([name, count]) => ({ name, count }));
  }, [products]);

  // Distinct Work Types / Craft Techniques
  const availableWorkTypes = useMemo(() => {
    const list = [
      { id: 'Weaving', label: 'Handloom & Tapestry Weaving', match: ['weaving', 'handloom', 'katan', 'ikat', 'shuttle'] },
      { id: 'Brocade', label: 'Tested Zari Brocade & Kadhwa', match: ['zari', 'brocade', 'kadhwa', 'asawali'] },
      { id: 'Embroidery', label: 'Sozni Needlework & Aari', match: ['sozni', 'needlework', 'embroidery', 'aari'] },
      { id: 'BlockPrint', label: 'Resist Block Printing (Ajrakh)', match: ['block', 'ajrakh', 'print'] },
      { id: 'LostWax', label: 'Lost-Wax Bronze Casting (Dhokra)', match: ['lost-wax', 'cire perdue', 'casting', 'dhokra'] },
      { id: 'SilverInlay', label: 'Pure Silver Wire Inlay (Bidri)', match: ['inlay', 'bidri', 'damascening'] },
      { id: 'Pottery', label: 'Wheel-Thrown & Stone Pottery', match: ['wheel-thrown', 'pottery', 'platter', 'serpentine', 'clay'] },
      { id: 'FolkPainting', label: 'Palm Leaf & Nib Folk Art', match: ['painting', 'pattachitra', 'mithila', 'madhubani', 'tanjore'] },
      { id: 'WoodTurning', label: 'Lacquer Wood Turning & Carving', match: ['turning', 'wood', 'lacquer', 'channapatna', 'kondapalli'] },
      { id: 'LeatherCraft', label: 'Vegetable Tanning & Braiding', match: ['leather', 'tanning', 'chappal', 'sandal'] },
    ];

    return list.map(item => {
      const count = products.filter(p => {
        const text = (p.craftTechnique + ' ' + p.titleEn + ' ' + p.category).toLowerCase();
        return item.match.some(m => text.includes(m));
      }).length;
      return { ...item, count };
    }).filter(item => item.count > 0);
  }, [products]);

  // Distinct States
  const availableStates = useMemo(() => {
    const map = new Map<string, number>();
    products.forEach(p => {
      map.set(p.state, (map.get(p.state) || 0) + 1);
    });
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [products]);

  // Distinct Materials
  const availableMaterials = useMemo(() => {
    const materialsList = [
      { id: 'Silk', label: 'Pure Mulberry & Katan Silk', match: 'silk' },
      { id: 'Wool', label: 'Cashmere & Himalayan Wool', match: 'wool' },
      { id: 'Metal', label: 'Bell Metal & Silver Inlay', match: ['metal', 'brass', 'silver', 'zinc'] },
      { id: 'Clay', label: 'Alluvial Clay & Quartz Glaze', match: ['clay', 'quartz', 'pottery', 'serpentine'] },
      { id: 'Wood', label: 'Seasoned Teak & Aale Mara Wood', match: ['wood', 'teak', 'mara'] },
      { id: 'Leather', label: 'Vegetable-Tanned Leather', match: 'leather' },
      { id: 'NaturalPigments', label: 'Palm Leaf & Botanical Dyes', match: ['palm', 'pigment', 'botanical', 'dye'] },
    ];

    return materialsList.map(item => {
      const count = products.filter(p => {
        const mat = (p.primaryMaterial + ' ' + p.descriptionEn).toLowerCase();
        if (Array.isArray(item.match)) {
          return item.match.some(m => mat.includes(m));
        }
        return mat.includes(item.match);
      }).length;
      return { ...item, count };
    }).filter(item => item.count > 0);
  }, [products]);

  // Filter products based on all faceted criteria
  const filteredProducts = useMemo(() => {
    let result = products.filter((p) => {
      // 1. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const searchable = (
          p.titleEn + ' ' + 
          p.titleHi + ' ' + 
          p.craftTechnique + ' ' + 
          p.artisanName + ' ' + 
          p.state + ' ' + 
          p.primaryMaterial + ' ' +
          p.seoKeywords.join(' ')
        ).toLowerCase();
        if (!searchable.includes(q)) return false;
      }

      // 2. Main Category Filter (Multi-select)
      if (selectedCategories.length > 0) {
        if (!selectedCategories.includes(p.category)) return false;
      }

      // 3. Work Type Filter
      if (selectedWorkTypes.length > 0) {
        const text = (p.craftTechnique + ' ' + p.titleEn + ' ' + p.category).toLowerCase();
        const matchesAny = selectedWorkTypes.some(wtId => {
          const wt = availableWorkTypes.find(w => w.id === wtId);
          return wt ? wt.match.some(m => text.includes(m)) : false;
        });
        if (!matchesAny) return false;
      }

      // 4. State Filter
      if (selectedStates.length > 0) {
        if (!selectedStates.includes(p.state)) return false;
      }

      // 5. Material Filter
      if (selectedMaterials.length > 0) {
        const mat = (p.primaryMaterial + ' ' + p.descriptionEn).toLowerCase();
        const matchesAny = selectedMaterials.some(matId => {
          const mObj = availableMaterials.find(m => m.id === matId);
          if (!mObj) return false;
          if (Array.isArray(mObj.match)) {
            return mObj.match.some(m => mat.includes(m));
          }
          return mat.includes(mObj.match);
        });
        if (!matchesAny) return false;
      }

      // 6. GI Tagged Filter
      if (onlyGICertified && !p.giCertified) {
        return false;
      }

      return true;
    });

    // Sorting
    if (sortBy === 'price-asc') {
      result = [...result].sort((a, b) => a.pricing.suggestedRetailPrice - b.pricing.suggestedRetailPrice);
    } else if (sortBy === 'price-desc') {
      result = [...result].sort((a, b) => b.pricing.suggestedRetailPrice - a.pricing.suggestedRetailPrice);
    } else if (sortBy === 'days') {
      result = [...result].sort((a, b) => a.productionDays - b.productionDays);
    }

    return result;
  }, [
    products, 
    searchQuery, 
    selectedCategories, 
    selectedWorkTypes, 
    selectedStates, 
    selectedMaterials, 
    onlyGICertified, 
    sortBy, 
    availableWorkTypes, 
    availableMaterials
  ]);

  // Reset pagination when any filter changes
  useEffect(() => {
    setVisibleCount(BATCH_SIZE);
  }, [searchQuery, selectedCategories, selectedWorkTypes, selectedStates, selectedMaterials, onlyGICertified, sortBy]);

  // Scroll Lazy Loading via Intersection Observer
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (first.isIntersecting && !isLoadingMore && visibleCount < filteredProducts.length) {
          setIsLoadingMore(true);
          setTimeout(() => {
            setVisibleCount((prev) => Math.min(prev + BATCH_SIZE, filteredProducts.length));
            setIsLoadingMore(false);
          }, 450);
        }
      },
      {
        root: null,
        rootMargin: '250px',
        threshold: 0.1,
      }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [visibleCount, filteredProducts.length, isLoadingMore]);

  // Helpers for multi-select toggles
  const toggleCategory = (cat: string) => {
    setSelectedCategories(prev => 
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    );
  };

  const toggleWorkType = (wtId: string) => {
    setSelectedWorkTypes(prev => 
      prev.includes(wtId) ? prev.filter(w => w !== wtId) : [...prev, wtId]
    );
  };

  const toggleState = (st: string) => {
    setSelectedStates(prev => 
      prev.includes(st) ? prev.filter(s => s !== st) : [...prev, st]
    );
  };

  const toggleMaterial = (matId: string) => {
    setSelectedMaterials(prev => 
      prev.includes(matId) ? prev.filter(m => m !== matId) : [...prev, matId]
    );
  };

  const clearAllFilters = () => {
    setSearchQuery('');
    setSelectedCategories([]);
    setSelectedWorkTypes([]);
    setSelectedStates([]);
    setSelectedMaterials([]);
    setOnlyGICertified(false);
    setSortBy('relevance');
  };

  const activeFiltersCount = 
    (searchQuery ? 1 : 0) + 
    selectedCategories.length + 
    selectedWorkTypes.length + 
    selectedStates.length + 
    selectedMaterials.length + 
    (onlyGICertified ? 1 : 0);

  const handleOpenRFQ = (product: ProductListing, e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveRFQProduct(product);
    setRfqSubmitted(false);
  };

  const handleChatWithArtisan = (product: ProductListing, e: React.MouseEvent) => {
    e.stopPropagation();
    onStartConversation?.(product.artisanId, product.artisanName, product.id, product.titleEn);
  };

  const handleSendRFQ = async (e: React.FormEvent) => {
    e.preventDefault();
    if (activeRFQProduct) {
      const rfqId = `rfq-${Date.now()}`;
      await saveRFQToSupabase({
        id: rfqId,
        buyerId: buyerId || '00000000-0000-0000-0000-000000000201',
        buyerName: rfqForm.buyerName || buyerName || 'B2B Buyer',
        artisanId: activeRFQProduct.artisanId,
        productId: activeRFQProduct.id,
        quantity: rfqForm.quantity,
        message: `${rfqForm.notes} (Company: ${rfqForm.companyName}, Target Date: ${rfqForm.targetDate}, Contact: ${rfqForm.phone})`,
        status: 'pending',
      });
    }
    setRfqSubmitted(true);
    setTimeout(() => {
      setActiveRFQProduct(null);
      setRfqSubmitted(false);
    }, 2500);
  };

  const handleExploreCraft = (categoryName: string) => {
    setSelectedCategories([categoryName]);
    const target = document.getElementById('procurement-catalog');
    if (target) {
      target.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const visibleProducts = filteredProducts.slice(0, visibleCount);

  // Derived real buyer recommendations (strictly real data; NO fake personalization)
  const computedRecommendations = (recommendedProducts && recommendedProducts.length > 0)
    ? recommendedProducts
    : products.filter((p) => p.giCertified || p.featured).slice(0, 4);

  return (
    <div className="w-full p-0 m-0">
      {/* ========================================================================= */}
      {/* 1. REFINED HERITAGE HERO SECTION (100% FLUSH EDGE-TO-EDGE, ZERO PADDING) */}
      {/* ========================================================================= */}
      <HeritageHeroSection
        language={language}
        onExploreCraft={handleExploreCraft}
        onLaunchStudio={onLaunchStudio}
      />

      {/* ========================================================================= */}
      {/* 2. INTERACTIVE CRAFT ATLAS & STATE HERITAGE EXPLORER                      */}
      {/* ========================================================================= */}
      <CraftAtlasExplorer
        onSelectStateFromAtlas={(stateName) => {
          setSelectedStates([stateName]);
        }}
        onExploreCraftCategory={(category) => {
          setSelectedCategories([category]);
        }}
      />

      {/* ========================================================================= */}
      {/* 3. REPOSITORY & B2B MARKETPLACE (VASTRA SHILPA KOSH TWO-COLUMN ARCHIVE)   */}
      {/* ========================================================================= */}
      <div id="procurement-catalog" className="max-w-[1440px] mx-auto px-3 sm:px-6 lg:px-8 py-6 space-y-6">

        {/* B2B Government Linkage Metric Strip */}
        <div className={`bg-gradient-to-r from-[#1C1815] via-[#2A231D] to-[#181412] rounded-2xl ${isMobileMode ? 'p-3 gap-2.5' : 'p-4 sm:p-5 gap-4'} text-white border border-amber-500/25 shadow-lg flex flex-col md:flex-row items-center justify-between`}>
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3">
            <span className="bg-amber-400/20 text-amber-300 border border-amber-400/40 text-[10px] sm:text-[11px] font-bold px-2.5 py-0.5 sm:px-3 sm:py-1 rounded-full flex items-center gap-1.5 backdrop-blur-xs">
              <Building2 className="w-3.5 h-3.5" />
              GeM & TRIFED Integrated
            </span>
            <span className="text-[11px] sm:text-xs text-stone-300 font-medium">
              National Textile & Craft Repository (Vastra Shilpa Kosh Standard) • MoSJE Verified Beneficiary Direct Linkage
            </span>
          </div>
          <div className="flex items-center space-x-2 text-[11px] sm:text-xs text-emerald-400 font-bold bg-emerald-950/40 px-3 py-1.5 rounded-xl border border-emerald-500/30">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>100% Direct DBT Payments • Fair Minimum Wage Protected</span>
          </div>
        </div>

        {/* Mobile Filter Toggle Button */}
        <div className={`${isMobileMode ? 'flex' : 'lg:hidden flex'} items-center justify-between bg-white dark:bg-[#0F172A] p-2.5 sm:p-3 rounded-xl border border-stone-200 dark:border-stone-800 shadow-xs`}>
          <button
            onClick={() => setIsMobileFiltersOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg bg-[#8B1D1D] text-white text-xs font-bold shadow-xs cursor-pointer"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Filter Repository</span>
            {activeFiltersCount > 0 && (
              <span className="bg-white text-[#8B1D1D] text-[10px] font-extrabold px-1.5 py-0.2 rounded-full">
                {activeFiltersCount}
              </span>
            )}
          </button>

          <span className="text-xs text-stone-500 dark:text-stone-400">
            <strong>{filteredProducts.length}</strong> items found
          </span>
        </div>

        {/* Category Pills */}
        <div className="flex items-center space-x-1.5 overflow-x-auto no-scrollbar pt-1">
          {['all', ...availableCategories.map((c) => c.name)].map((cat: string) => (
            <button
              key={cat}
              onClick={() => setSelectedCategories(cat === 'all' ? [] : [cat])}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
                (cat === 'all' && selectedCategories.length === 0) || selectedCategories.includes(cat)
                  ? 'bg-stone-900 text-white shadow-xs'
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              {cat === 'all'
                ? (translate(language, 'buyer.allCategories') || 'All Craft Categories')
                : getCategoryTranslation(cat, language)}
            </button>
          ))}
        </div>

      {/* Recommended Crafts Section — Real Supabase recommendations & interests */}
      {computedRecommendations.length > 0 &&
        selectedCategories.length === 0 &&
        selectedStates.length === 0 &&
        !searchQuery && (
          <div className="bg-amber-50/70 dark:bg-[#1B2435] rounded-3xl p-4 sm:p-5 border border-amber-200/80 dark:border-amber-400/20 space-y-3 shadow-2xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <span className="p-1.5 rounded-xl bg-amber-500 text-white shadow-xs">
                  <Sparkles className="w-4 h-4" />
                </span>

                <div>
                  <h3 className="font-bold text-sm text-stone-900 dark:text-white">
                    Recommended for You
                  </h3>
                  <p className="text-[11px] text-stone-500 dark:text-stone-400">
                    Popular GI-certified & top verified craft items for buyers
                  </p>
                </div>
              </div>

              <span className="text-[10px] bg-white dark:bg-stone-800 text-stone-700 dark:text-stone-200 px-2.5 py-1 rounded-full font-bold border border-amber-200 dark:border-stone-700 shadow-2xs">
                Personalized
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              {computedRecommendations.slice(0, 4).map((product) => (
                <div
                  key={`rec-${product.id}`}
                  onClick={() => onSelectProduct(product)}
                  className="bg-white dark:bg-[#131E33] rounded-2xl p-3 border border-amber-200/90 dark:border-stone-700 shadow-2xs hover:shadow-xs hover:-translate-y-0.5 transition-all cursor-pointer flex flex-col justify-between group"
                >
                  <div className="space-y-2">
                    <div className="relative aspect-[4/3] rounded-xl overflow-hidden bg-stone-100 dark:bg-stone-800">
                      <img
                        src={product.enhancedImageUrl || product.enhancedImage || product.originalImageUrl || product.originalImage}
                        alt={product.titleEn}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />

                      {product.giCertified && (
                        <span className="absolute top-2 left-2 bg-[#1C1815]/90 text-amber-300 text-[9px] font-bold px-2 py-0.5 rounded-full border border-amber-400/30 backdrop-blur-xs">
                          GI Tagged
                        </span>
                      )}
                    </div>

                    <div>
                      <span className="text-[9px] font-bold text-[#A33F1B] dark:text-amber-300 uppercase tracking-wider block truncate">
                        {getCategoryTranslation(product.category, language)}
                      </span>

                      <h4 className="font-bold text-xs text-stone-900 dark:text-white line-clamp-1 group-hover:text-[#C85A32] dark:group-hover:text-amber-300 transition-colors">
                        {getProductTitle(product, language)}
                      </h4>

                      <p className="text-[10px] text-stone-500 dark:text-stone-400 line-clamp-1 mt-0.5">
                        {getCraftTechniqueTranslation(product.craftTechnique, language)} • {product.state}
                      </p>
                    </div>
                  </div>

                  <div className="pt-2 mt-2 border-t border-stone-100 dark:border-stone-800 flex items-center justify-between">
                    <span className="text-xs font-black text-stone-900 dark:text-white">
                      ₹{product.pricing.suggestedRetailPrice.toLocaleString('en-IN')}
                    </span>

                    <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-bold group-hover:underline">
                      View Craft →
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      {/* Results Header */}
      <div className="flex justify-between items-center text-xs text-stone-500 dark:text-stone-400 px-1">
        <span>
          Showing <strong className="text-stone-900 dark:text-white">{filteredProducts.length}</strong> verified artisan listings
        </span>

        <span className="flex items-center gap-1">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
          MoSJE Beneficiary Verified
        </span>
      </div>

        {/* Two-Column Archive: Left Sidebar Filters + Right Product Grid */}
        <div className="flex flex-col lg:flex-row gap-6">
          <aside className={`w-full lg:w-72 shrink-0 space-y-4 bg-white dark:bg-[#0F172A] p-4 rounded-2xl border border-stone-200/90 dark:border-stone-800/90 shadow-xs transition-all ${
            isMobileFiltersOpen
              ? 'fixed inset-y-0 left-0 z-50 w-80 max-w-[85vw] h-full overflow-y-auto shadow-2xl animate-slideRight'
              : isMobileMode ? 'hidden' : 'hidden lg:block'
          }`}>
            <div className="flex items-center justify-between pb-3 border-b border-stone-100 dark:border-stone-800">
              <div className="flex items-center space-x-2">
                <SlidersHorizontal className="w-4 h-4 text-[#8B1D1D] dark:text-amber-400" />
                <h3 className="font-bold text-sm text-stone-900 dark:text-stone-100">
                  Filter Repository
                </h3>
              </div>
              <button
                onClick={() => setIsMobileFiltersOpen(false)}
                className="lg:hidden text-stone-400 hover:text-stone-700 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {activeFiltersCount > 0 && (
              <div className="mt-2.5 flex items-center justify-between">
                <span className="text-[11px] font-mono text-stone-500">
                  {activeFiltersCount} filter(s) active
                </span>
                <button
                  onClick={clearAllFilters}
                  className="text-[11px] font-bold text-[#8B1D1D] dark:text-amber-400 hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Clear All</span>
                </button>
              </div>
            )}

              {/* ----------------------------------------------------------------- */}
              {/* Accordion 1: Main Category (Vastra Shilpa Kosh)                   */}
              {/* ----------------------------------------------------------------- */}
              <div className="border-t border-stone-100 dark:border-stone-800/80 pt-3">
                <button
                  type="button"
                  onClick={() => toggleAccordion('mainCategory')}
                  className="w-full flex items-center justify-between text-left py-1 text-[#8B1D1D] dark:text-red-400 text-xs sm:text-sm font-bold tracking-tight hover:opacity-85 transition-opacity cursor-pointer"
                >
                  <span>Main Category</span>
                  {expandedAccordions.mainCategory ? (
                    <ChevronUp className="w-4 h-4 text-[#8B1D1D] dark:text-red-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-[#8B1D1D] dark:text-red-400" />
                  )}
                </button>

                {expandedAccordions.mainCategory && (
                  <div className="mt-2.5 space-y-1.5 pl-1 max-h-48 overflow-y-auto pr-1 no-scrollbar">
                    {availableCategories.map(({ name, count }) => (
                      <label
                        key={name}
                        className="flex items-center space-x-2 text-xs text-stone-700 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white cursor-pointer py-0.5 select-none"
                      >
                        <input
                          type="checkbox"
                          checked={selectedCategories.includes(name)}
                          onChange={() => toggleCategory(name)}
                          className="rounded-xs text-[#8B1D1D] accent-[#8B1D1D] focus:ring-red-400 w-3.5 h-3.5 cursor-pointer"
                        />
                        <span className="truncate flex-1">{name}</span>
                        <span className="text-[11px] text-stone-400 font-mono font-medium">[{count}]</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* ----------------------------------------------------------------- */}
              {/* Accordion 2: Functional Category / Work Type (Vastra Shilpa Kosh) */}
              {/* ----------------------------------------------------------------- */}
              <div className="border-t border-stone-100 dark:border-stone-800/80 pt-3">
                <button
                  type="button"
                  onClick={() => toggleAccordion('workType')}
                  className="w-full flex items-center justify-between text-left py-1 text-[#8B1D1D] dark:text-red-400 text-xs sm:text-sm font-bold tracking-tight hover:opacity-85 transition-opacity cursor-pointer"
                >
                  <span>Work Type / Craft Technique</span>
                  {expandedAccordions.workType ? (
                    <ChevronUp className="w-4 h-4 text-[#8B1D1D] dark:text-red-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-[#8B1D1D] dark:text-red-400" />
                  )}
                </button>

                {expandedAccordions.workType && (
                  <div className="mt-2.5 space-y-1.5 pl-1 max-h-52 overflow-y-auto pr-1 no-scrollbar">
                    {availableWorkTypes.map(({ id, label, count }) => (
                      <label
                        key={id}
                        className="flex items-center space-x-2 text-xs text-stone-700 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white cursor-pointer py-0.5 select-none"
                      >
                        <input
                          type="checkbox"
                          checked={selectedWorkTypes.includes(id)}
                          onChange={() => toggleWorkType(id)}
                          className="rounded-xs text-[#8B1D1D] accent-[#8B1D1D] focus:ring-red-400 w-3.5 h-3.5 cursor-pointer"
                        />
                        <span className="truncate flex-1">{label}</span>
                        <span className="text-[11px] text-stone-400 font-mono font-medium">[{count}]</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* ----------------------------------------------------------------- */}
              {/* Accordion 3: State / Origin Region */}
              {/* ----------------------------------------------------------------- */}
              <div className="border-t border-stone-100 dark:border-stone-800/80 pt-3">
                <button
                  type="button"
                  onClick={() => toggleAccordion('state')}
                  className="w-full flex items-center justify-between text-left py-1 text-[#8B1D1D] dark:text-red-400 text-xs sm:text-sm font-bold tracking-tight hover:opacity-85 transition-opacity cursor-pointer"
                >
                  <span>State & Artisan Cluster</span>
                  {expandedAccordions.state ? (
                    <ChevronUp className="w-4 h-4 text-[#8B1D1D] dark:text-red-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-[#8B1D1D] dark:text-red-400" />
                  )}
                </button>

                {expandedAccordions.state && (
                  <div className="mt-2.5 space-y-1.5 pl-1 max-h-48 overflow-y-auto pr-1 no-scrollbar">
                    {availableStates.map(({ name, count }) => (
                      <label
                        key={name}
                        className="flex items-center space-x-2 text-xs text-stone-700 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white cursor-pointer py-0.5 select-none"
                      >
                        <input
                          type="checkbox"
                          checked={selectedStates.includes(name)}
                          onChange={() => toggleState(name)}
                          className="rounded-xs text-[#8B1D1D] accent-[#8B1D1D] focus:ring-red-400 w-3.5 h-3.5 cursor-pointer"
                        />
                        <span className="truncate flex-1">{name}</span>
                        <span className="text-[11px] text-stone-400 font-mono font-medium">[{count}]</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* ----------------------------------------------------------------- */}
              {/* Accordion 4: Primary Material & Fibres */}
              {/* ----------------------------------------------------------------- */}
              <div className="border-t border-stone-100 dark:border-stone-800/80 pt-3">
                <button
                  type="button"
                  onClick={() => toggleAccordion('material')}
                  className="w-full flex items-center justify-between text-left py-1 text-[#8B1D1D] dark:text-red-400 text-xs sm:text-sm font-bold tracking-tight hover:opacity-85 transition-opacity cursor-pointer"
                >
                  <span>Material & Fabric</span>
                  {expandedAccordions.material ? (
                    <ChevronUp className="w-4 h-4 text-[#8B1D1D] dark:text-red-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-[#8B1D1D] dark:text-red-400" />
                  )}
                </button>

                {expandedAccordions.material && (
                  <div className="mt-2.5 space-y-1.5 pl-1 max-h-44 overflow-y-auto pr-1 no-scrollbar">
                    {availableMaterials.map(({ id, label, count }) => (
                      <label
                        key={id}
                        className="flex items-center space-x-2 text-xs text-stone-700 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white cursor-pointer py-0.5 select-none"
                      >
                        <input
                          type="checkbox"
                          checked={selectedMaterials.includes(id)}
                          onChange={() => toggleMaterial(id)}
                          className="rounded-xs text-[#8B1D1D] accent-[#8B1D1D] focus:ring-red-400 w-3.5 h-3.5 cursor-pointer"
                        />
                        <span className="truncate flex-1">{label}</span>
                        <span className="text-[11px] text-stone-400 font-mono font-medium">[{count}]</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* ----------------------------------------------------------------- */}
              {/* Accordion 5: GI Tag Certification */}
              {/* ----------------------------------------------------------------- */}
              <div className="border-t border-stone-100 dark:border-stone-800/80 pt-3">
                <button
                  type="button"
                  onClick={() => toggleAccordion('certification')}
                  className="w-full flex items-center justify-between text-left py-1 text-[#8B1D1D] dark:text-red-400 text-xs sm:text-sm font-bold tracking-tight hover:opacity-85 transition-opacity cursor-pointer"
                >
                  <span>Verification & Tagging</span>
                  {expandedAccordions.certification ? (
                    <ChevronUp className="w-4 h-4 text-[#8B1D1D] dark:text-red-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-[#8B1D1D] dark:text-red-400" />
                  )}
                </button>

                {expandedAccordions.certification && (
                  <div className="mt-2.5 space-y-1.5 pl-1">
                    <label className="flex items-center space-x-2 text-xs text-stone-700 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white cursor-pointer py-0.5 select-none">
                      <input
                        type="checkbox"
                        checked={onlyGICertified}
                        onChange={(e) => setOnlyGICertified(e.target.checked)}
                        className="rounded-xs text-[#8B1D1D] accent-[#8B1D1D] focus:ring-red-400 w-3.5 h-3.5 cursor-pointer"
                      />
                      <span className="truncate flex-1 font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1">
                        <Award className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                        GI Tag Certified Only
                      </span>
                      <span className="text-[11px] text-stone-400 font-mono font-medium">
                        [{products.filter(p => p.giCertified).length}]
                      </span>
                    </label>
                  </div>
                )}
              </div>
          </aside>

          {/* Mobile backdrop */}
          {isMobileFiltersOpen && (
            <div
              onClick={() => setIsMobileFiltersOpen(false)}
              className={`${isMobileMode ? 'fixed' : 'lg:hidden fixed'} inset-0 z-40 bg-black/60 backdrop-blur-xs`}
            />
          )}

          {/* RIGHT COLUMN: 4-COLUMN MUSEUM ARTIFACT GRID & CATALOG HEADER */}
          <main className="flex-1 w-full min-w-0 space-y-4">

            {/* Top Toolbar: Result Count, Active Filter Chips, Sort By */}
            <div className="bg-white dark:bg-[#0F172A] rounded-2xl p-4 border border-stone-200/90 dark:border-stone-800 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <span className="font-extrabold text-sm sm:text-base text-stone-900 dark:text-stone-100">
                    Cultural Craft & Textile Archive
                  </span>
                  <span className="bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 text-xs px-2.5 py-0.5 rounded-full font-bold">
                    {filteredProducts.length} artifacts
                  </span>
                </div>
                <p className="text-[11px] text-stone-500 dark:text-stone-400">
                  National Repository standard catalog with direct artisan procurement linkage
                </p>
              </div>

              {/* Sort Dropdown */}
              <div className="flex items-center space-x-2 text-xs w-full md:w-auto justify-between md:justify-end">
                <span className="text-stone-500 font-medium whitespace-nowrap">Sort by:</span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="px-3 py-1.5 bg-stone-50 dark:bg-stone-900 border border-stone-300 dark:border-stone-700 rounded-lg text-xs font-semibold text-stone-800 dark:text-stone-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#8B1D1D]/30"
                >
                  <option value="relevance">Relevance / Featured</option>
                  <option value="price-asc">Price: Low to High</option>
                  <option value="price-desc">Price: High to Low</option>
                  <option value="days">Production Days (Fastest)</option>
                </select>
              </div>
            </div>

            {/* Active Filter Chips */}
            {activeFiltersCount > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-xs text-stone-500 font-medium mr-1">Active Filters:</span>
                {searchQuery && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-[#8B1D1D]/10 text-[#8B1D1D] dark:text-red-400 border border-[#8B1D1D]/20">
                    Search: "{searchQuery}"
                    <button onClick={() => setSearchQuery('')} className="hover:opacity-75">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                )}
                {selectedCategories.map(cat => (
                  <span key={cat} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-amber-500/10 text-amber-800 dark:text-amber-300 border border-amber-500/30">
                    {cat}
                    <button onClick={() => toggleCategory(cat)} className="hover:opacity-75">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                {selectedWorkTypes.map(wtId => {
                  const wt = availableWorkTypes.find(w => w.id === wtId);
                  return (
                    <span key={wtId} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 border border-stone-300 dark:border-stone-700">
                      {wt ? wt.label : wtId}
                      <button onClick={() => toggleWorkType(wtId)} className="hover:opacity-75">
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  );
                })}
                {selectedStates.map(st => (
                  <span key={st} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 border border-stone-300 dark:border-stone-700">
                    {st}
                    <button onClick={() => toggleState(st)} className="hover:opacity-75">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                {onlyGICertified && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-amber-500/10 text-amber-800 dark:text-amber-300 border border-amber-500/30">
                    GI Tagged Only
                    <button onClick={() => setOnlyGICertified(false)} className="hover:opacity-75">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                )}
                <button
                  onClick={clearAllFilters}
                  className="text-xs text-[#8B1D1D] dark:text-amber-400 font-bold hover:underline ml-2"
                >
                  Reset all
                </button>
              </div>
            )}

            {/* Zero State if no matching filters */}
            {filteredProducts.length === 0 && (
              <div className="bg-white dark:bg-[#0F172A] rounded-3xl border border-stone-200 dark:border-stone-800 p-12 text-center space-y-4">
                <div className="w-16 h-16 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-400 mx-auto flex items-center justify-center">
                  <Search className="w-8 h-8" />
                </div>
                <h3 className="font-bold text-lg text-stone-900 dark:text-stone-100">
                  No artifacts match your selected filter criteria
                </h3>
                <p className="text-xs text-stone-500 max-w-md mx-auto">
                  Try unchecking some category boxes or clearing your search term to see more verified heritage items from the national repository.
                </p>
                <button
                  onClick={clearAllFilters}
                  className="px-5 py-2.5 rounded-xl bg-stone-900 dark:bg-amber-500 text-white dark:text-stone-950 font-bold text-xs shadow-xs"
                >
                  Clear All Filters
                </button>
              </div>
            )}

            {/* ================================================================= */}
            {/* VASTRA SHILPA KOSH MUSEUM REPOSITORY CARD GRID (2-Col in Mobile)   */}
            {/* ================================================================= */}
            <div className={`grid ${isMobileMode ? 'grid-cols-2 gap-2.5' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-4.5'}`}>
              {visibleProducts.map((product) => (
                <div
                  key={product.id}
                  onClick={() => onSelectProduct(product)}
                  className="bg-white dark:bg-[#0F172A] rounded-xl border border-stone-200/90 dark:border-stone-800 overflow-hidden shadow-[0_2px_12px_rgba(0,0,0,0.03)] hover:shadow-[0_12px_28px_rgba(0,0,0,0.08)] hover:-translate-y-1 transition-all duration-300 cursor-pointer group flex flex-col justify-between"
                >
                  <div>
                    {/* Visual Card Top: Tall 4:5 Aspect Ratio with Watermark & Red Badge */}
                    <div className="relative aspect-[4/5] bg-[#FAF8F5] dark:bg-[#111726] overflow-hidden flex items-center justify-center p-2 sm:p-2.5 border-b border-stone-100 dark:border-stone-800">
                      
                      {/* Product Photo */}
                      <LazyProductImage
                        src={product.enhancedImageUrl || product.enhancedImage || product.originalImageUrl || product.originalImage}
                        alt={product.titleEn}
                        className="w-full h-full object-contain mix-blend-multiply dark:mix-blend-normal group-hover:scale-105 transition-transform duration-500"
                      />

                      {/* Top-Left: GI Badge & State */}
                      <div className="absolute top-2 left-2 flex flex-col gap-1 z-10">
                        {product.giCertified && (
                          <span className="bg-[#1C1815]/90 text-amber-300 text-[8px] sm:text-[9px] font-bold px-1.5 sm:px-2 py-0.5 rounded-md backdrop-blur-xs shadow-xs border border-amber-400/30 flex items-center gap-1">
                            <Award className="w-2.5 h-2.5 text-amber-300" />
                            GI Tagged
                          </span>
                        )}
                        <span className="bg-stone-900/80 text-amber-200 text-[8px] sm:text-[9px] font-mono px-1 sm:px-1.5 py-0.5 rounded-md backdrop-blur">
                          {product.state}
                        </span>
                      </div>

                      {/* Center Watermark Outline Icon (Vastra Shilpa Kosh style) */}
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-20 dark:opacity-15">
                        <ImageIcon className="w-8 sm:w-10 h-8 sm:h-10 text-stone-400" />
                      </div>

                      {/* Bottom-Right Circular MoSJE Watermark Seal */}
                      <div className="absolute bottom-2 right-7 sm:right-8 pointer-events-none opacity-40 dark:opacity-30 select-none">
                        <div className="w-6 sm:w-7 h-6 sm:h-7 rounded-full border border-stone-500/60 dark:border-amber-400/60 flex items-center justify-center p-0.5">
                          <span className="text-[6px] sm:text-[7px] font-mono font-black text-stone-600 dark:text-amber-300 text-center leading-none">
                            MoSJE
                          </span>
                        </div>
                      </div>

                      {/* Bottom-Right: Red Media / Gallery Badge (Vastra Shilpa Kosh Reference) */}
                      <div className="absolute bottom-1.5 sm:bottom-2 right-1.5 sm:right-2 z-10">
                        <div 
                          className="bg-[#8B1D1D] text-white p-1 rounded-xs shadow-sm flex items-center justify-center"
                          title="View High-Res Craft Visual"
                        >
                          <Camera className="w-2.5 sm:w-3 h-2.5 sm:h-3 text-white" />
                        </div>
                      </div>

                    </div>

                    {/* Body Typography: Clean Bold Title below image */}
                    <div className={`${isMobileMode ? 'p-2 space-y-1.5' : 'p-3.5 space-y-2'}`}>
                      <div>
                        <h4 className={`font-bold ${isMobileMode ? 'text-[11px] leading-tight line-clamp-1' : 'text-xs sm:text-[13px] line-clamp-1 leading-snug'} text-stone-900 dark:text-stone-100 group-hover:text-[#8B1D1D] dark:group-hover:text-amber-400 transition-colors`}>
                          {product.titleEn}
                        </h4>
                        <p className={`${isMobileMode ? 'text-[10px]' : 'text-[11px]'} text-stone-500 dark:text-stone-400 line-clamp-1 mt-0.5`}>
                          {product.craftTechnique}
                        </p>
                      </div>

                      {/* Artisan & MoSJE Beneficiary Tag */}
                      <div className={`flex items-center justify-between ${isMobileMode ? 'text-[10px] pt-0.5' : 'text-[11px] pt-1'} text-stone-600 dark:text-stone-300`}>
                        <span className="truncate font-medium">{product.artisanName}</span>
                        <ShieldCheck className="w-3 sm:w-3.5 h-3 sm:h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      </div>

                      {/* Pricing Row */}
                      <div className={`bg-[#FAF8F5] dark:bg-stone-900/90 rounded-lg ${isMobileMode ? 'p-1.5 text-[10px]' : 'p-2 text-xs'} border border-stone-200/60 dark:border-stone-800 flex items-baseline justify-between`}>
                        <div>
                          <span className="text-[9px] text-stone-400 block leading-tight">MSRP</span>
                          <span className="font-bold text-stone-900 dark:text-stone-100">
                            ₹{product.pricing.suggestedRetailPrice.toLocaleString('en-IN')}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-[9px] text-emerald-700 dark:text-emerald-400 block leading-tight">Bulk Tier</span>
                          <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                            ₹{product.pricing.wholesaleTiers[1].unitPrice.toLocaleString('en-IN')} / pc
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Card Bottom Quick Actions */}
                  <div className={`${isMobileMode ? 'p-2 pt-0 gap-1' : 'p-3.5 pt-0 gap-1.5'} flex items-center`}>
                    <button
                      onClick={(e) => handleChatWithArtisan(product, e)}
                      className={`${isMobileMode ? 'p-1.5' : 'p-2'} rounded-lg border border-stone-200 dark:border-stone-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-stone-600 dark:text-stone-300 transition-colors cursor-pointer`}
                      title="Direct Chat with Artisan"
                    >
                      <MessageSquare className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    </button>

                    <button
                      onClick={(e) => handleOpenRFQ(product, e)}
                      className={`flex-1 ${isMobileMode ? 'py-1 px-1.5 text-[10px]' : 'py-1.5 px-2.5 text-[11px]'} rounded-lg bg-stone-900 dark:bg-[#8B1D1D] hover:bg-stone-800 dark:hover:bg-[#731717] text-white font-bold transition-all shadow-xs flex items-center justify-center gap-1 cursor-pointer`}
                    >
                      <Building2 className="w-3 h-3 text-amber-300" />
                      <span>{isMobileMode ? 'Quote' : 'Request Quote'}</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* ================================================================= */}
            {/* SCROLL LAZY-LOADING SENTINEL & SHIMMER LOADING STATES             */}
            {/* ================================================================= */}
            <div ref={sentinelRef} className="h-6 w-full" />

            {/* Shimmer Skeletons when fetching next batch on scroll */}
            {isLoadingMore && (
              <div className="w-full py-4 flex flex-col items-center justify-center gap-4">
                <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-[#8B1D1D]/10 border border-[#8B1D1D]/30 text-[#8B1D1D] dark:text-red-400 text-xs font-bold shadow-xs">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Loading next repository artifacts from National Registry...</span>
                </div>

                {/* Card Skeleton Grid */}
                <div className={`grid ${isMobileMode ? 'grid-cols-2 gap-2.5' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4'} w-full`}>
                  {[1, 2, 3, 4].map((n) => (
                    <div
                      key={n}
                      className="bg-white dark:bg-[#0F172A] rounded-xl border border-stone-200 dark:border-stone-800 p-3 space-y-3 animate-pulse shadow-xs"
                    >
                      <div className="aspect-[4/5] rounded-lg bg-stone-200 dark:bg-stone-800 w-full" />
                      <div className="h-3.5 bg-stone-200 dark:bg-stone-800 rounded-md w-3/4" />
                      <div className="h-3 bg-stone-200 dark:bg-stone-800 rounded-md w-1/2" />
                      <div className="h-9 bg-stone-100 dark:bg-stone-800/60 rounded-lg w-full" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Fallback load more button */}
            {visibleCount < filteredProducts.length && !isLoadingMore && (
              <div className="w-full flex flex-col items-center justify-center pt-2 pb-4 text-center">
                <button
                  onClick={() => {
                    setIsLoadingMore(true);
                    setTimeout(() => {
                      setVisibleCount((prev) => Math.min(prev + BATCH_SIZE, filteredProducts.length));
                      setIsLoadingMore(false);
                    }, 400);
                  }}
                  className="px-6 py-2.5 rounded-xl bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-200 text-xs font-bold transition-all shadow-xs flex items-center gap-2 cursor-pointer"
                >
                  <ArrowDown className="w-3.5 h-3.5 text-[#8B1D1D] dark:text-amber-400 animate-bounce" />
                  <span>Load More Artifacts ({filteredProducts.length - visibleCount} remaining)</span>
                  <span className="text-[10px] text-stone-400 font-normal hidden sm:inline">• or scroll down</span>
                </button>
              </div>
            )}

            {/* End of results indicator */}
            {visibleCount >= filteredProducts.length && filteredProducts.length > 8 && (
              <div className="w-full py-4 text-center">
                <span className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-stone-100 dark:bg-stone-800/80 text-stone-500 dark:text-stone-400 text-xs font-semibold">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  All {filteredProducts.length} verified repository artifacts loaded
                </span>
              </div>
            )}

          </main>
        </div>
      </div>

      {/* Bulk RFQ Modal */}
      {activeRFQProduct && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-lg w-full max-h-[92dvh] overflow-y-auto p-4 sm:p-6 shadow-2xl border border-stone-200 relative animate-scaleIn my-auto">
            <button
              onClick={() => setActiveRFQProduct(null)}
              className="absolute top-4 right-4 text-stone-400 hover:text-stone-700 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            {rfqSubmitted ? (
              <div className="text-center py-8 space-y-3">
                <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 mx-auto flex items-center justify-center shadow-inner">
                  <CheckCircle2 className="w-9 h-9" />
                </div>
                <h3 className="text-xl font-bold text-stone-900">RFQ Sent to Artisan!</h3>
                <p className="text-xs text-stone-600 max-w-sm mx-auto">
                  Your bulk quotation request for <strong>{rfqForm.quantity} units</strong> has been transmitted to master artisan <strong>{activeRFQProduct.artisanName}</strong> and registered on the MoSJE marketplace portal.
                </p>
                <div className="text-[11px] font-mono text-emerald-700 bg-emerald-50 py-1.5 px-3 rounded-xl inline-block">
                  RFQ Reference: #RFQ-MoSJE-2025-{Math.floor(1000 + Math.random() * 9000)}
                </div>
              </div>
            ) : (
              <form onSubmit={handleSendRFQ} className="space-y-4">
                <div>
                  <span className="text-[10px] font-bold text-[#8B1D1D] uppercase tracking-wider">
                    B2B Wholesale RFQ
                  </span>
                  <h3 className="font-bold text-lg text-stone-900 leading-tight">
                    {getProductTitle(activeRFQProduct, language)}
                  </h3>
                  <p className="text-xs text-stone-500">
                    Artisan: {activeRFQProduct.artisanName} • {getCraftTechniqueTranslation(activeRFQProduct.craftTechnique, language)}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="block text-stone-600 font-semibold mb-1">Company / Organization</label>
                    <input
                      type="text"
                      required
                      value={rfqForm.companyName}
                      onChange={(e) => setRfqForm({ ...rfqForm, companyName: e.target.value })}
                      className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs text-stone-900 focus:ring-2 focus:ring-[#8B1D1D]"
                    />
                  </div>
                  <div>
                    <label className="block text-stone-600 font-semibold mb-1">Buyer Name</label>
                    <input
                      type="text"
                      required
                      value={rfqForm.buyerName}
                      onChange={(e) => setRfqForm({ ...rfqForm, buyerName: e.target.value })}
                      className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs text-stone-900 focus:ring-2 focus:ring-[#8B1D1D]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="block text-stone-600 font-semibold mb-1">Email</label>
                    <input
                      type="email"
                      required
                      value={rfqForm.email}
                      onChange={(e) => setRfqForm({ ...rfqForm, email: e.target.value })}
                      className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs text-stone-900 focus:ring-2 focus:ring-[#8B1D1D]"
                    />
                  </div>
                  <div>
                    <label className="block text-stone-600 font-semibold mb-1">Phone</label>
                    <input
                      type="tel"
                      required
                      value={rfqForm.phone}
                      onChange={(e) => setRfqForm({ ...rfqForm, phone: e.target.value })}
                      className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs text-stone-900 focus:ring-2 focus:ring-[#8B1D1D]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="block text-stone-600 font-semibold mb-1">Target Quantity (Units)</label>
                    <input
                      type="number"
                      min="10"
                      value={rfqForm.quantity}
                      onChange={(e) => setRfqForm({ ...rfqForm, quantity: parseInt(e.target.value) || 10 })}
                      className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs text-stone-900 focus:ring-2 focus:ring-[#8B1D1D]"
                    />
                  </div>
                  <div>
                    <label className="block text-stone-600 font-semibold mb-1">Delivery Target Date</label>
                    <input
                      type="date"
                      value={rfqForm.targetDate}
                      onChange={(e) => setRfqForm({ ...rfqForm, targetDate: e.target.value })}
                      className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs text-stone-900 focus:ring-2 focus:ring-[#8B1D1D]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-stone-600 font-semibold text-xs mb-1">Specification / Customization Notes</label>
                  <textarea
                    rows={2}
                    value={rfqForm.notes}
                    onChange={(e) => setRfqForm({ ...rfqForm, notes: e.target.value })}
                    className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs text-stone-900 focus:ring-2 focus:ring-[#8B1D1D] resize-none"
                  />
                </div>

                <div className="pt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveRFQProduct(null)}
                    className="px-4 py-2.5 rounded-xl border border-stone-300 text-xs font-semibold text-stone-700 hover:bg-stone-50 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2.5 rounded-xl bg-[#8B1D1D] hover:bg-[#731717] text-white text-xs font-bold shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Submit Official RFQ</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};