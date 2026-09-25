import React, { useState } from 'react';
import { X, ShieldCheck, UserCheck, ShoppingBag, Phone, ArrowRight, User, CheckCircle2, Lock, LogIn, UserPlus } from 'lucide-react';
import { UserRole } from '../types';
import { CURRENT_ARTISAN } from '../data/craftPresets';
import { sendPhoneOTP, verifyPhoneOTP, normalizePhoneNumber, signInWithUsernamePassword, signUpWithUsernamePassword } from '../services/supabase';

export interface AuthUser {
  id: string;
  name: string;
  role: UserRole;
  phoneOrEmail: string;
  username?: string;
  beneficiaryId?: string;
  companyName?: string;
  avatarUrl: string;
  shilpArtisanId?: string;
  onboardingComplete?: boolean;
}

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess: (user: AuthUser) => void;
  currentRole: UserRole;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onLoginSuccess,
  currentRole,
}) => {
  const [authMode, setAuthMode] = useState<'create' | 'login'>('create');
  const [activeRole, setActiveRole] = useState<UserRole>(currentRole);

  // Form input states
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [buyerCompany, setBuyerCompany] = useState('');

  // OTP State
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [formattedPhone, setFormattedPhone] = useState('');

  // Status & Error Banner
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  // Handler for Existing User Login (Phone/Username + Password)
  const handleExistingLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone.trim()) {
      setErrorMessage('Please enter your phone number or username.');
      return;
    }
    if (!password.trim()) {
      setErrorMessage('Please enter your password.');
      return;
    }
    setLoading(true);
    setErrorMessage(null);

    try {
      const { user, error } = await signInWithUsernamePassword({
        username: phone.trim(),
        password: password.trim(),
      });

      if (error || !user) {
        setErrorMessage(error?.message || 'Login failed. Please check phone number and password.');
        setLoading(false);
        return;
      }

      const metaRole = user.user_metadata?.role as UserRole | undefined;
      const effectiveRole = metaRole || activeRole;

      const authUser: AuthUser = {
        id: user.id,
        name: user.user_metadata?.name || user.email || (effectiveRole === 'artisan' ? CURRENT_ARTISAN.name : 'B2B Buyer'),
        role: effectiveRole,
        phoneOrEmail: user.phone || phone.trim(),
        companyName: user.user_metadata?.companyName || buyerCompany.trim() || undefined,
        beneficiaryId: user.user_metadata?.beneficiaryId || (effectiveRole === 'artisan' ? 'MoSJE-2026' : undefined),
        avatarUrl: user.user_metadata?.avatar_url || (effectiveRole === 'artisan' ? CURRENT_ARTISAN.avatarUrl : 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150'),
        onboardingComplete: true, // Existing account — skip onboarding tutorial
      };

      onLoginSuccess(authUser);
      onClose();
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err?.message || 'Failed to sign in. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Handler for New Account Creation (Phone OTP Send)
  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone.trim()) {
      setErrorMessage('Please enter a valid phone number.');
      return;
    }
    setLoading(true);
    setErrorMessage(null);
    try {
      const { normalizedPhone, error } = await sendPhoneOTP(phone.trim());
      if (error) {
        setErrorMessage(error.message);
        setLoading(false);
        return;
      }
      setFormattedPhone(normalizedPhone);
      setOtpSent(true);
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err?.message || 'Failed to send OTP SMS.');
    } finally {
      setLoading(false);
    }
  };

  // Handler for New Account Creation (Verify OTP)
  const handleVerifyOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otp.trim()) {
      setErrorMessage('Please enter the 6-digit OTP code received on your phone.');
      return;
    }
    setLoading(true);
    setErrorMessage(null);
    try {
      const { user, userId, error } = await verifyPhoneOTP(phone.trim(), otp.trim());
      if (error || !userId) {
        setErrorMessage(error?.message || 'OTP Verification failed. Please check the code.');
        setLoading(false);
        return;
      }

      // Persist account with password mapping in Supabase Auth
      if (password.trim()) {
        try {
          await signUpWithUsernamePassword({
            username: phone.trim(),
            password: password.trim(),
            phone: phone.trim(),
            role: activeRole,
            name: name.trim() || (activeRole === 'artisan' ? 'Artisan' : 'Wholesale Buyer'),
            companyName: activeRole === 'buyer' ? buyerCompany.trim() : undefined,
          });
        } catch (pwErr) {
          console.warn('Password mapping notice:', pwErr);
        }
      }

      const authUser: AuthUser = {
        id: userId,
        name: name.trim() || (activeRole === 'artisan' ? 'Artisan' : 'Wholesale Buyer'),
        role: activeRole,
        phoneOrEmail: formattedPhone || normalizePhoneNumber(phone.trim()),
        companyName: activeRole === 'buyer' ? buyerCompany.trim() : undefined,
        beneficiaryId: activeRole === 'artisan' ? 'MoSJE-2026' : undefined,
        avatarUrl: activeRole === 'artisan'
          ? CURRENT_ARTISAN.avatarUrl
          : 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
        onboardingComplete: false, // New account — proceed to complete profile details
      };

      onLoginSuccess(authUser);
      onClose();
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err?.message || 'Invalid OTP code.');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickDemoArtisan = () => {
    onLoginSuccess({
      id: '00000000-0000-0000-0000-000000000101',
      name: CURRENT_ARTISAN.name,
      role: 'artisan',
      phoneOrEmail: CURRENT_ARTISAN.phone,
      beneficiaryId: CURRENT_ARTISAN.beneficiaryId,
      avatarUrl: CURRENT_ARTISAN.avatarUrl,
      shilpArtisanId: 'SHILP-TEL-2024-04921',
      onboardingComplete: true,
    });
    onClose();
  };

  const handleQuickDemoBuyer = () => {
    onLoginSuccess({
      id: '00000000-0000-0000-0000-000000000201',
      name: 'Vikram Mehta',
      role: 'buyer',
      phoneOrEmail: '+919848023145',
      companyName: 'FabIndia Procurement',
      avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
      onboardingComplete: true,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-md w-full max-h-[92dvh] overflow-y-auto p-4 sm:p-6 shadow-2xl border border-stone-200 relative animate-scaleIn space-y-4 my-auto">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-stone-400 hover:text-stone-700 w-8 h-8 rounded-full flex items-center justify-center transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="text-center space-y-1 pt-1">
          <div className="inline-flex p-2 rounded-2xl bg-amber-50 text-amber-600 mb-1">
            <ShieldCheck className="w-7 h-7 text-amber-600" />
          </div>
          <h3 className="font-extrabold text-lg text-stone-900">
            {authMode === 'create'
              ? (activeRole === 'artisan' ? 'MoSJE Artisan Account Registration' : 'B2B Buyer Account Registration')
              : (activeRole === 'artisan' ? 'Artisan Account Login' : 'B2B Buyer Account Login')}
          </h3>
          <p className="text-xs text-stone-500">
            Ministry of Social Justice and Empowerment · Supabase Secure Authentication
          </p>
        </div>

        {/* Mode Switcher: Create Account vs Login to Existing Account */}
        <div className="grid grid-cols-2 gap-1 p-1 bg-stone-100 rounded-2xl">
          <button
            onClick={() => {
              setAuthMode('create');
              setErrorMessage(null);
            }}
            className={`py-2 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-all ${
              authMode === 'create'
                ? 'bg-amber-600 text-white shadow-xs'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Create Account</span>
          </button>

          <button
            onClick={() => {
              setAuthMode('login');
              setErrorMessage(null);
            }}
            className={`py-2 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-all ${
              authMode === 'login'
                ? 'bg-stone-900 text-white shadow-xs'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            <LogIn className="w-3.5 h-3.5" />
            <span>Login to Account</span>
          </button>
        </div>

        {/* Role Toggle Tabs */}
        <div className="grid grid-cols-2 gap-1.5 p-1 bg-stone-50 border border-stone-200 rounded-2xl">
          <button
            onClick={() => setActiveRole('artisan')}
            className={`py-2 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-all ${
              activeRole === 'artisan'
                ? 'bg-amber-50 text-amber-800 border border-amber-300 font-bold'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            <UserCheck className="w-3.5 h-3.5" />
            <span>Artisan</span>
          </button>

          <button
            onClick={() => setActiveRole('buyer')}
            className={`py-2 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-all ${
              activeRole === 'buyer'
                ? 'bg-stone-900 text-white shadow-xs font-bold'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            <ShoppingBag className="w-3.5 h-3.5" />
            <span>B2B Buyer</span>
          </button>
        </div>

        {/* 1-Click Quick Demo Login Pill */}
        <div className="bg-amber-50/70 border border-amber-200/80 rounded-2xl p-3 flex items-center justify-between">
          <div className="text-left">
            <span className="text-[10px] font-bold text-amber-800 uppercase tracking-wider block">
              1-Click Demo Login
            </span>
            <span className="text-xs font-semibold text-stone-800">
              {activeRole === 'artisan' ? 'Rameshwaram Koli (Master Weaver)' : 'Vikram Mehta (FabIndia Buyer)'}
            </span>
          </div>
          <button
            onClick={activeRole === 'artisan' ? handleQuickDemoArtisan : handleQuickDemoBuyer}
            className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition-all shadow-xs flex items-center gap-1"
          >
            <span>Demo In</span>
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>

        {/* Error Banner */}
        {errorMessage && (
          <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs font-medium rounded-xl text-center space-y-1">
            <p className="font-bold">Authentication Error</p>
            <p>{errorMessage}</p>
          </div>
        )}

        {/* ── MODE 1: LOGIN TO EXISTING ACCOUNT ── */}
        {authMode === 'login' ? (
          <form onSubmit={handleExistingLoginSubmit} className="space-y-3 pt-1">
            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">
                Phone Number or Username *
              </label>
              <div className="relative">
                <Phone className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="e.g. 9063114094 or username"
                  className="w-full pl-9 pr-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-xs text-stone-900 focus:ring-2 focus:ring-amber-500"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1">
                Password *
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-9 pr-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-xs text-stone-900 focus:ring-2 focus:ring-amber-500"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className={`w-full py-2.5 rounded-xl text-white text-xs font-bold shadow-md transition-all flex items-center justify-center gap-1.5 mt-2 ${
                activeRole === 'artisan' ? 'bg-amber-600 hover:bg-amber-700' : 'bg-stone-900 hover:bg-black'
              } disabled:opacity-60`}
            >
              <span>{loading ? 'Authenticating…' : 'Sign In with Password'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </form>
        ) : (
          /* ── MODE 2: CREATE NEW ACCOUNT (Phone OTP) ── */
          !otpSent ? (
            <form onSubmit={handleSendOtp} className="space-y-3 pt-1">
              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Full Name *
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={activeRole === 'artisan' ? 'e.g. Rameshwaram Koli' : 'e.g. Vikram Mehta'}
                    className="w-full pl-9 pr-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-xs text-stone-900 focus:ring-2 focus:ring-amber-500"
                    required
                  />
                </div>
              </div>

              {activeRole === 'buyer' && (
                <div>
                  <label className="block text-xs font-semibold text-stone-700 mb-1">
                    Company / Organization Name
                  </label>
                  <input
                    type="text"
                    value={buyerCompany}
                    onChange={(e) => setBuyerCompany(e.target.value)}
                    placeholder="FabIndia Crafts / GeM Procurement"
                    className="w-full px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-xs text-stone-900 focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Mobile Phone Number or Username * <span className="text-[11px] font-normal text-stone-400">(e.g. 9063114094)</span>
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="9063114094"
                    className="w-full pl-9 pr-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-xs text-stone-900 font-mono focus:ring-2 focus:ring-amber-500"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Create Account Password *
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-9 pr-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-xs text-stone-900 focus:ring-2 focus:ring-amber-500"
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className={`w-full py-2.5 rounded-xl text-white text-xs font-bold shadow-md transition-all flex items-center justify-center gap-1.5 mt-2 ${
                  activeRole === 'artisan' ? 'bg-amber-600 hover:bg-amber-700' : 'bg-stone-900 hover:bg-black'
                } disabled:opacity-60`}
              >
                <span>{loading ? 'Sending Vonage OTP…' : 'Send Phone OTP (Vonage SMS)'}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </form>
          ) : (
            /* OTP VERIFICATION FORM */
            <form onSubmit={handleVerifyOtpSubmit} className="space-y-3 pt-1">
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-stone-700 space-y-1">
                <p className="font-semibold text-amber-900 flex items-center gap-1">
                  <CheckCircle2 className="w-4 h-4 text-amber-600" /> OTP Sent via Vonage SMS
                </p>
                <p className="text-[11px]">
                  Sent to: <strong className="font-mono">{formattedPhone}</strong>
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 mb-1">
                  Enter 6-Digit OTP Token *
                </label>
                <input
                  type="text"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  placeholder="e.g. 123456"
                  className="w-full px-3 py-3 bg-stone-50 border border-stone-200 rounded-xl text-sm font-mono tracking-widest text-center font-bold focus:ring-2 focus:ring-amber-500"
                  required
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setOtpSent(false)}
                  className="w-1/3 py-2.5 rounded-xl border border-stone-200 text-stone-600 text-xs font-medium hover:bg-stone-50"
                >
                  ← Back
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-2/3 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-md transition-all flex items-center justify-center gap-1.5 disabled:opacity-60"
                >
                  <span>{loading ? 'Verifying…' : 'Verify OTP & Authenticate'}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </form>
          )
        )}

        <div className="pt-2 text-center border-t border-stone-100">
          <p className="text-[10.5px] text-stone-500">
            Protected by MoSJE & Supabase Auth (Vonage SMS Provider)
          </p>
        </div>
      </div>
    </div>
  );
};
