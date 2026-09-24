// src/components/ArtisanOnboarding.tsx
import React, { useState, useRef } from 'react';
import {
  sendPhoneOTP,
  verifyPhoneOTP,
  upsertArtisanProfile,
  generateUniqueArtisanId,
  updateVerificationRefs,
  uploadPrivateDocument,
  isUuid,
  getCurrentSupabaseUser,
} from '../services/supabase';
import { askGemini, hasGeminiApiKey, generateArtisanBio } from '../services/geminiService';
import VerificationBadge from './VerificationBadge';
import ArtisanIDCard from './ArtisanIDCard';
import { VerificationTier } from '../types';

// ─── Wizard Steps ─────────────────────────────────────────────────────────────

enum WizardStep {
  LanguageSelection,
  PhoneInput,
  OTPVerification,
  RoleSelection,
  VerificationDocs,
  ProfileDetails,
  ReviewAndSubmit,
}

// ─── Profile shape ────────────────────────────────────────────────────────────

interface ProfileState {
  name: string;
  craftCluster: string;
  state: string;
  bio: string;
  voiceBioUrl: string;
}

const INITIAL_PROFILE: ProfileState = {
  name: '',
  craftCluster: '',
  state: '',
  bio: '',
  voiceBioUrl: '',
};

// ─── Web Speech API types ─────────────────────────────────────────────────────

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

interface ArtisanOnboardingProps {
  onClose: () => void;
  authenticatedUserId?: string;
}

const ArtisanOnboarding: React.FC<ArtisanOnboardingProps> = ({ onClose, authenticatedUserId }) => {
  // ── Wizard state ────────────────────────────────────────────────────────────
  const [step, setStep] = useState<WizardStep>(
    authenticatedUserId ? WizardStep.VerificationDocs : WizardStep.LanguageSelection
  );
  const [loading, setLoading] = useState(false);

  // ── Step 1 — Language ────────────────────────────────────────────────────────
  const [language, setLanguage] = useState('en');

  // ── Step 2 — Phone ───────────────────────────────────────────────────────────
  const [phone, setPhone] = useState('');

  // ── Step 3 — OTP ────────────────────────────────────────────────────────────
  const [otp, setOtp] = useState('');
  const [userId, setUserId] = useState(authenticatedUserId || '');

  // ── Step 4 — Role ────────────────────────────────────────────────────────────
  const [role, setRole] = useState<'artisan' | 'buyer'>('artisan');

  // ── Step 5 — Verification docs ───────────────────────────────────────────────
  const [identityDoc, setIdentityDoc] = useState<File | null>(null);
  const [giCert, setGiCert] = useState<File | null>(null);
  const [verificationTier, setVerificationTier] = useState<VerificationTier>('normal');
  // Store uploaded storage paths in state for final submit
  const [identityDocRef, setIdentityDocRef] = useState('');
  const [giCertRef, setGiCertRef] = useState('');

  // ── Step 6 — Profile details ─────────────────────────────────────────────────
  const [profile, setProfile] = useState<ProfileState>(INITIAL_PROFILE);
  const [generatingBio, setGeneratingBio] = useState(false);
  const [recording, setRecording] = useState(false);

  // ── Step 7 — Review & ID card ────────────────────────────────────────────────
  const [shilpId, setShilpId] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');

  // ── Speech recognition ref ───────────────────────────────────────────────────
  const recognitionRef = useRef<any>(null);

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /** Upload a private doc to Supabase and return its storage path. */
  const uploadDoc = async (
    file: File,
    docType: 'identity' | 'gi-certificate'
  ): Promise<string> => {
    const effectiveUid = isUuid(userId) ? userId : '00000000-0000-0000-0000-000000000101';
    const result = await uploadPrivateDocument(file, docType, effectiveUid);
    if (result.error) throw result.error;
    return result.storagePath ?? '';
  };

  // ─── Step 2 → 3: Send OTP ───────────────────────────────────────────────────

  const handleSendOtp = async () => {
    if (!phone.trim()) {
      alert('Please enter your phone number.');
      return;
    }
    setLoading(true);
    try {
      const { error } = await sendPhoneOTP(phone.trim());
      if (error) throw error;
      setStep(WizardStep.OTPVerification);
    } catch (e) {
      console.error(e);
      alert('Failed to send OTP. Please check the number and try again.');
    } finally {
      setLoading(false);
    }
  };

  // ─── Step 3 → 4: Verify OTP ─────────────────────────────────────────────────

  const handleVerifyOtp = async () => {
    if (!otp.trim()) {
      alert('Please enter the OTP.');
      return;
    }
    setLoading(true);
    try {
      const { userId: uid, error } = await verifyPhoneOTP(phone.trim(), otp.trim());
      if (error) throw error;
      setUserId(uid ?? '00000000-0000-0000-0000-000000000101');
      setStep(WizardStep.RoleSelection);
    } catch (e) {
      console.error(e);
      alert('Invalid OTP. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // ─── Step 4 → 5 (artisan) / onClose (buyer) ──────────────────────────────────

  const handleRoleContinue = () => {
    if (role === 'artisan') {
      setStep(WizardStep.VerificationDocs);
    } else {
      // Buyers don't need the artisan onboarding wizard
      onClose();
    }
  };

  // ─── Step 5: Upload verification documents ────────────────────────────────────

  const handleDocsUpload = async () => {
    setLoading(true);
    try {
      let idRef = '';
      let giRef = '';

      if (identityDoc) {
        idRef = await uploadDoc(identityDoc, 'identity');
      }
      if (giCert) {
        giRef = await uploadDoc(giCert, 'gi-certificate');
      }

      const hasId = Boolean(identityDoc || idRef);
      const hasGi = Boolean(giCert || giRef);

      let newTier: VerificationTier = 'normal';
      if (hasId && hasGi) {
        newTier = 'gi_craft_verified';
      } else if (hasGi) {
        newTier = 'gi_craft_verified';
      } else if (hasId) {
        newTier = 'identity_verified';
      } else {
        newTier = 'normal';
      }

      // Store refs in state — committed during final handleSubmit
      setIdentityDocRef(idRef);
      setGiCertRef(giRef);
      setVerificationTier(newTier);

      setStep(WizardStep.ProfileDetails);
    } catch (e) {
      console.error(e);
      alert('Failed to upload documents. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // ─── Step 6: AI-assisted bio ───────────────────────────────────────────────

  const handleGenerateBio = async () => {
    setGeneratingBio(true);
    try {
      const bio = await generateArtisanBio(
        profile.name || 'the artisan',
        profile.state || 'India',
        profile.craftCluster || 'traditional handloom & craft',
        'en'
      );
      setProfile((p) => ({ ...p, bio: bio.trim() }));
    } catch (e: any) {
      console.error(e);
      alert(`Failed to generate bio: ${e?.message || 'AI service unavailable'}. You can type your bio manually.`);
    } finally {
      setGeneratingBio(false);
    }
  };

  // ─── Step 6: Voice bio recording ─────────────────────────────────────────────

  const handleToggleVoiceBio = () => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert('Voice input is not supported in this browser. Please type your bio.');
      return;
    }

    if (recording) {
      recognitionRef.current?.stop();
      setRecording(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = language === 'hi' ? 'hi-IN' : language === 'mr' ? 'mr-IN' : 'en-IN';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = (event: any) => {
      const transcript = event.results[0]?.[0]?.transcript ?? '';
      setProfile((p) => ({ ...p, bio: p.bio ? p.bio + ' ' + transcript : transcript }));
    };
    recognition.onerror = (e: any) => {
      console.error('Speech recognition error:', e);
      setRecording(false);
    };
    recognition.onend = () => setRecording(false);

    recognitionRef.current = recognition;
    recognition.start();
    setRecording(true);
  };

  // ─── Step 7: Final submit ──────────────────────────────────────────────────

  const handleSubmit = async () => {
    setLoading(true);
    try {
      // Determine valid UUID for primary key
      let effectiveUserId = userId;
      if (!isUuid(effectiveUserId)) {
        const currentUser = await getCurrentSupabaseUser();
        effectiveUserId = currentUser?.id ?? '';
      }
      if (!isUuid(effectiveUserId)) {
        effectiveUserId = '00000000-0000-0000-0000-000000000101';
      }

      // Generate unique Shilp-AI Artisan ID (public display ID)
      const artisanId = await generateUniqueArtisanId(profile.state || 'india');
      setShilpId(artisanId);

      // Generate QR code data URL linking to the public artisan profile
      const profileUrl = `${window.location.origin}/artisan/${artisanId}`;
      const QRCode = (await import('qrcode')) as typeof import('qrcode');
      const qrUrl = await QRCode.toDataURL(profileUrl, {
        width: 256,
        margin: 2,
        color: { dark: '#1c1917', light: '#ffffff' },
      });
      setQrDataUrl(qrUrl);

      const isIdVerified = Boolean(identityDocRef || identityDoc);
      const isGiVerified = Boolean(giCertRef || giCert);

      let finalTier: VerificationTier = 'normal';
      if (isIdVerified && isGiVerified) {
        finalTier = 'gi_craft_verified';
      } else if (isGiVerified) {
        finalTier = 'gi_craft_verified';
      } else if (isIdVerified) {
        finalTier = 'identity_verified';
      } else {
        finalTier = 'normal';
      }

      // Build the profile payload — `id` must match auth.users.id (UUID primary key)
      const payload = {
        id: effectiveUserId,
        shilp_artisan_id: artisanId,
        name: profile.name || null,
        craft_cluster: profile.craftCluster || null,
        state: profile.state || null,
        bio: profile.bio || null,
        verification_tier: finalTier,
        is_identity_verified: isIdVerified,
        is_gi_verified: isGiVerified,
        onboarding_complete: true,
      };

      const { error: upsertError } = await upsertArtisanProfile(payload as any);
      if (upsertError) {
        console.error('[Supabase] Profile creation error:', upsertError);
        alert(`Failed to create profile: ${upsertError.message}`);
        setLoading(false);
        return;
      }

      // Update private verification document references separately (RLS gated)
      if (identityDocRef || giCertRef) {
        await updateVerificationRefs(effectiveUserId, {
          identity_doc_ref: identityDocRef || undefined,
          gi_cert_ref: giCertRef || undefined,
          verification_tier: finalTier,
          is_identity_verified: isIdVerified,
          is_gi_verified: isGiVerified,
        });
      }
    } catch (e: any) {
      console.error('[Supabase] Profile submit exception:', e);
      alert(`Failed to create profile: ${e?.message || e}. Please check details and try again.`);
      setLoading(false);
      return;
    }
    setLoading(false);
    // Stay on ReviewAndSubmit to show the ID card — user closes when ready
  };

  // ─── Step renderer ─────────────────────────────────────────────────────────

  const renderStep = () => {
    switch (step) {
      // ── Step 1: Language ────────────────────────────────────────────────────
      case WizardStep.LanguageSelection:
        return (
          <div className="p-5 space-y-4">
            <h2 className="text-xl font-bold text-stone-800">Select Language / भाषा चुनें</h2>
            <div className="grid grid-cols-2 gap-2">
              {[
                { code: 'en', label: 'English' },
                { code: 'hi', label: 'हिन्दी' },
                { code: 'mr', label: 'मराठी' },
                { code: 'te', label: 'తెలుగు' },
                { code: 'ta', label: 'தமிழ்' },
                { code: 'gu', label: 'ગુજરાતી' },
              ].map(({ code, label }) => (
                <button
                  key={code}
                  className={`py-2 px-3 rounded-xl border text-sm font-medium transition-all ${
                    language === code
                      ? 'bg-saffron-600 text-white border-saffron-600 shadow'
                      : 'bg-stone-50 text-stone-700 border-stone-200 hover:border-saffron-400'
                  }`}
                  style={language === code ? { backgroundColor: '#d97706', borderColor: '#d97706' } : {}}
                  onClick={() => setLanguage(code)}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              className="w-full py-2.5 rounded-xl text-white text-sm font-bold"
              style={{ backgroundColor: '#d97706' }}
              onClick={() => setStep(WizardStep.PhoneInput)}
            >
              Continue →
            </button>
          </div>
        );

      // ── Step 2: Phone input ──────────────────────────────────────────────────
      case WizardStep.PhoneInput:
        return (
          <div className="p-5 space-y-4">
            <h2 className="text-xl font-bold text-stone-800">Enter Mobile Number</h2>
            <p className="text-xs text-stone-500">We'll send a one-time password (OTP) to verify your number.</p>
            <input
              type="tel"
              placeholder="+91 98480 XXXXX"
              className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:outline-none"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendOtp()}
            />
            <button
              className="w-full py-2.5 rounded-xl text-white text-sm font-bold disabled:opacity-60"
              style={{ backgroundColor: '#d97706' }}
              onClick={handleSendOtp}
              disabled={loading}
            >
              {loading ? 'Sending…' : 'Send OTP'}
            </button>
          </div>
        );

      // ── Step 3: OTP verification ─────────────────────────────────────────────
      case WizardStep.OTPVerification:
        return (
          <div className="p-5 space-y-4">
            <h2 className="text-xl font-bold text-stone-800">Enter OTP</h2>
            <p className="text-xs text-stone-500">
              OTP sent to <strong>{phone}</strong>. Check your SMS.
            </p>
            <input
              type="text"
              maxLength={6}
              placeholder="Enter 4–6 digit OTP"
              className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm font-mono tracking-widest focus:ring-2 focus:outline-none"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleVerifyOtp()}
            />
            <p className="text-[10.5px] text-emerald-600">
              ✓ Dev mode: OTP is printed in console if Supabase is not configured.
            </p>
            <div className="flex gap-2">
              <button
                className="flex-1 py-2.5 rounded-xl border border-stone-200 text-sm text-stone-600"
                onClick={() => setStep(WizardStep.PhoneInput)}
              >
                ← Back
              </button>
              <button
                className="flex-1 py-2.5 rounded-xl text-white text-sm font-bold disabled:opacity-60"
                style={{ backgroundColor: '#d97706' }}
                onClick={handleVerifyOtp}
                disabled={loading}
              >
                {loading ? 'Verifying…' : 'Verify OTP'}
              </button>
            </div>
          </div>
        );

      // ── Step 4: Role selection ───────────────────────────────────────────────
      case WizardStep.RoleSelection:
        return (
          <div className="p-5 space-y-4">
            <h2 className="text-xl font-bold text-stone-800">I am a…</h2>
            <div className="grid grid-cols-2 gap-3">
              {(['artisan', 'buyer'] as const).map((r) => (
                <button
                  key={r}
                  className={`py-4 px-3 rounded-xl border text-sm font-semibold transition-all ${
                    role === r
                      ? 'border-green-500 bg-green-50 text-green-800'
                      : 'border-stone-200 bg-stone-50 text-stone-700 hover:border-stone-400'
                  }`}
                  onClick={() => setRole(r)}
                >
                  {r === 'artisan' ? '🪡 Artisan (कारीगर)' : '🛍️ Buyer (खरीदार)'}
                </button>
              ))}
            </div>
            <button
              className="w-full py-2.5 rounded-xl text-white text-sm font-bold"
              style={{ backgroundColor: '#16a34a' }}
              onClick={handleRoleContinue}
            >
              Continue →
            </button>
          </div>
        );

      // ── Step 5: Verification documents ──────────────────────────────────────
      case WizardStep.VerificationDocs:
        return (
          <div className="p-5 space-y-4">
            <h2 className="text-xl font-bold text-stone-800">Verification Documents</h2>
            <p className="text-xs text-stone-500">
              Documents are stored privately and never shared publicly. Upload either or both to get a verification badge.
            </p>

            {/* Identity Doc */}
            <div className="border border-stone-200 rounded-xl p-3 space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold text-stone-700">
                  🟢 Government ID <span className="font-normal text-xs text-stone-400">(Aadhaar / PAN / Voter ID)</span>
                </label>
                {identityDoc && (
                  <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full">✓ Selected</span>
                )}
              </div>
              <input
                type="file"
                accept="image/*,application/pdf"
                className="w-full text-xs text-stone-500"
                onChange={(e) => setIdentityDoc(e.target.files?.[0] ?? null)}
              />
              <p className="text-[10px] text-stone-400">Grants: Identity Verified 🟢 badge</p>
            </div>

            {/* GI Certificate — separate from identity */}
            <div className="border border-stone-200 rounded-xl p-3 space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold text-stone-700">
                  🟣 GI Craft Certificate <span className="font-normal text-xs text-stone-400">(GI Tag / MoSJE Letter)</span>
                </label>
                {giCert && (
                  <span className="text-[10px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">✓ Selected</span>
                )}
              </div>
              <input
                type="file"
                accept="image/*,application/pdf"
                className="w-full text-xs text-stone-500"
                onChange={(e) => setGiCert(e.target.files?.[0] ?? null)}
              />
              <p className="text-[10px] text-stone-400">Grants: GI Craft Verified 🟣 badge (highest tier)</p>
            </div>

            {/* Preview badge that will be awarded */}
            {(identityDoc || giCert) && (
              <div className="flex items-center gap-2 text-xs text-stone-600 bg-stone-50 rounded-lg px-3 py-2">
                <span>You will receive:</span>
                <VerificationBadge tier={giCert ? 'gi_craft_verified' : 'identity_verified'} />
              </div>
            )}

            <div className="flex gap-2">
              <button
                className="flex-1 py-2 rounded-xl border border-stone-200 text-sm text-stone-600"
                onClick={() => setStep(WizardStep.ProfileDetails)}
              >
                Skip for now
              </button>
              <button
                className="flex-1 py-2 rounded-xl text-white text-sm font-bold disabled:opacity-60"
                style={{ backgroundColor: '#7c3aed' }}
                onClick={handleDocsUpload}
                disabled={loading || (!identityDoc && !giCert)}
              >
                {loading ? 'Uploading…' : 'Upload & Continue'}
              </button>
            </div>
          </div>
        );

      // ── Step 6: Profile details ──────────────────────────────────────────────
      case WizardStep.ProfileDetails:
        return (
          <div className="p-5 space-y-3">
            <h2 className="text-xl font-bold text-stone-800">Your Profile</h2>

            <div className="space-y-2">
              <input
                type="text"
                placeholder="Full Name *"
                className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:outline-none"
                value={profile.name}
                onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))}
              />
              <input
                type="text"
                placeholder="Craft Cluster (e.g., Pochampally Ikat, Blue Pottery)"
                className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:outline-none"
                value={profile.craftCluster}
                onChange={(e) => setProfile((p) => ({ ...p, craftCluster: e.target.value }))}
              />
              <input
                type="text"
                placeholder="State (e.g., Telangana, Rajasthan)"
                className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:outline-none"
                value={profile.state}
                onChange={(e) => setProfile((p) => ({ ...p, state: e.target.value }))}
              />
            </div>

            {/* Bio — AI-assisted + voice */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-stone-600">Bio (AI-assisted, editable)</label>
              <textarea
                placeholder="Tell buyers about yourself and your craft…"
                className="w-full border border-stone-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:outline-none resize-none"
                rows={4}
                value={profile.bio}
                onChange={(e) => setProfile((p) => ({ ...p, bio: e.target.value }))}
              />
              <div className="flex gap-2">
                <button
                  className="flex-1 py-1.5 text-xs rounded-lg border border-amber-300 bg-amber-50 text-amber-800 font-semibold disabled:opacity-60"
                  onClick={handleGenerateBio}
                  disabled={generatingBio}
                >
                  {generatingBio ? '✨ Generating…' : '✨ Generate AI Bio'}
                </button>
                <button
                  className={`flex-1 py-1.5 text-xs rounded-lg border font-semibold transition-all ${
                    recording
                      ? 'border-red-400 bg-red-50 text-red-700 animate-pulse'
                      : 'border-stone-300 bg-stone-50 text-stone-700'
                  }`}
                  onClick={handleToggleVoiceBio}
                >
                  {recording ? '🔴 Stop Recording' : '🎙️ Voice Bio'}
                </button>
              </div>
            </div>

            <button
              className="w-full py-2.5 rounded-xl text-white text-sm font-bold"
              style={{ backgroundColor: '#1d4ed8' }}
              onClick={() => setStep(WizardStep.ReviewAndSubmit)}
              disabled={!profile.name.trim()}
            >
              Review & Submit →
            </button>
          </div>
        );

      // ── Step 7: Review & Submit ──────────────────────────────────────────────
      case WizardStep.ReviewAndSubmit:
        return (
          <div className="p-5 space-y-4">
            <h2 className="text-xl font-bold text-stone-800">Your Shilp-AI Profile</h2>

            {/* Profile summary */}
            <div className="bg-stone-50 rounded-xl p-3 text-sm space-y-1 text-stone-700">
              <p><span className="font-semibold">Name:</span> {profile.name || '—'}</p>
              <p><span className="font-semibold">Craft:</span> {profile.craftCluster || '—'}</p>
              <p><span className="font-semibold">State:</span> {profile.state || '—'}</p>
              {profile.bio && (
                <p className="text-xs text-stone-500 italic mt-1">"{profile.bio}"</p>
              )}
              <div className="pt-1 flex items-center gap-2">
                <span className="font-semibold">Verification:</span>
                <VerificationBadge tier={verificationTier} />
              </div>
            </div>

            {/* ID Card — shown after submit */}
            {shilpId ? (
              <>
                <ArtisanIDCard
                  name={profile.name}
                  shilpId={shilpId}
                  qrDataUrl={qrDataUrl}
                  verificationTier={verificationTier}
                />
                <p className="text-xs text-center text-stone-500">
                  Your Shilp-AI Artisan ID: <strong>{shilpId}</strong>
                </p>
                <button
                  className="w-full py-2.5 rounded-xl text-white text-sm font-bold"
                  style={{ backgroundColor: '#16a34a' }}
                  onClick={onClose}
                >
                  ✓ Done — Open Dashboard
                </button>
              </>
            ) : (
              <div className="flex gap-2">
                <button
                  className="flex-1 py-2 rounded-xl border border-stone-200 text-sm text-stone-600"
                  onClick={() => setStep(WizardStep.ProfileDetails)}
                >
                  ← Edit Profile
                </button>
                <button
                  className="flex-1 py-2.5 rounded-xl text-white text-sm font-bold disabled:opacity-60"
                  style={{ backgroundColor: '#16a34a' }}
                  onClick={handleSubmit}
                  disabled={loading}
                >
                  {loading ? 'Creating Profile…' : 'Create Profile & ID Card'}
                </button>
              </div>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  // ─── Step progress indicator ──────────────────────────────────────────────

  const stepLabels = ['Language', 'Phone', 'OTP', 'Role', 'Docs', 'Profile', 'ID Card'];

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-3 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[92dvh] overflow-y-auto flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center px-5 pt-4 pb-2 border-b border-stone-100 shrink-0">
          <div>
            <h1 className="text-base font-extrabold text-stone-900">Artisan Onboarding</h1>
            <p className="text-[10px] text-stone-400 mt-0.5">
              Step {step + 1} of {stepLabels.length} — {stepLabels[step]}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-stone-400 hover:text-stone-700 w-7 h-7 rounded-full flex items-center justify-center text-lg"
          >
            ✕
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-stone-100 shrink-0">
          <div
            className="h-1 bg-amber-500 transition-all duration-300"
            style={{ width: `${((step + 1) / stepLabels.length) * 100}%` }}
          />
        </div>

        {/* Step content */}
        <div className="flex-1 overflow-y-auto">{renderStep()}</div>
      </div>
    </div>
  );
};

export default ArtisanOnboarding;
