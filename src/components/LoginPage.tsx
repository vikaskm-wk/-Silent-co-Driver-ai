import React, { useState } from 'react';
import { Radio, Lock, Mail, Cpu, ArrowRight, ShieldCheck, AlertCircle, CheckCircle2 } from 'lucide-react';
import { User } from '../types';

interface LoginPageProps {
  onLoginSuccess: (user: User, token: string) => void;
  modelStatus?: {
    asr_model: string;
    emotion_model: string;
    status: string;
  } | null;
}

export default function LoginPage({ onLoginSuccess, modelStatus }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);

  // Validation & Auth States
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [transitionStep, setTransitionStep] = useState<string | null>(null);
  const [forgotModal, setForgotModal] = useState(false);

  const validateEmail = (val: string) => {
    if (!val.trim()) {
      return "Enter your email address.";
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(val.trim())) {
      return "Enter a valid email address.";
    }
    return null;
  };

  const validatePassword = (val: string) => {
    if (!val) {
      return "Enter your password.";
    }
    if (val.length < 6) {
      return "Password must be at least 6 characters.";
    }
    return null;
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const eErr = validateEmail(email);
    const pErr = validatePassword(password);

    setEmailError(eErr);
    setPasswordError(pErr);

    if (eErr || pErr) {
      return;
    }

    setIsLoading(true);
    setTransitionStep("AUTHENTICATING...");

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password, rememberMe })
      });

      const contentType = res.headers.get("content-type") || "";

      if (!res.ok) {
        if (contentType.includes("application/json")) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || errData.message || `Login failed (${res.status})`);
        } else {
          const text = await res.text().catch(() => "");
          throw new Error(`Login failed (${res.status}): ${text.slice(0, 300)}`);
        }
      }

      if (!contentType.includes("application/json")) {
        const text = await res.text().catch(() => "");
        throw new Error(`Auth API returned non-JSON response (${contentType}): ${text.slice(0, 300)}`);
      }

      const data = await res.json();

      setTransitionStep("SESSION READY");
      setTimeout(() => {
        onLoginSuccess(data.user, data.token);
      }, 500);

    } catch (err: any) {
      setIsLoading(false);
      setTransitionStep(null);
      setFormError(err.message || "Invalid email or password.");
    }
  };

  const handleDemoLogin = async () => {
    setFormError(null);
    setEmailError(null);
    setPasswordError(null);
    setIsLoading(true);
    setTransitionStep("AUTHENTICATING DEMO SESSION...");

    try {
      const res = await fetch('/api/auth/demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      const contentType = res.headers.get("content-type") || "";

      if (!res.ok) {
        if (contentType.includes("application/json")) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || errData.message || `Demo login failed (${res.status})`);
        } else {
          const text = await res.text().catch(() => "");
          throw new Error(`Demo login failed (${res.status}): ${text.slice(0, 300)}`);
        }
      }

      if (!contentType.includes("application/json")) {
        const text = await res.text().catch(() => "");
        throw new Error(`Demo login returned non-JSON response (${contentType}): ${text.slice(0, 300)}`);
      }

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to initialize demo session.");
      }

      setTransitionStep("SESSION READY");
      setTimeout(() => {
        onLoginSuccess(data.user, data.token);
      }, 500);

    } catch (err: any) {
      setIsLoading(false);
      setTransitionStep(null);
      setFormError(err.message || "Failed to launch demo session.");
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#0D0F12] text-[#F1F3F5] flex items-center justify-center p-4 sm:p-8 font-sans select-none">
      {/* Container */}
      <div className="w-full max-w-[1120px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
        
        {/* LEFT SIDE: Brand & Pipeline */}
        <div className="lg:col-span-7 flex flex-col space-y-6">
          {/* Header & Logo */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-md border border-[#292E35] bg-[#13161A] flex items-center justify-center text-[#E53935] shrink-0">
              <Radio className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs font-semibold tracking-wider text-[#E53935] uppercase">
                MOTORSPORT AI LABS
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#F1F3F5]">
                SILENT CO-DRIVER <span className="text-[#E53935]">AI</span>
              </h1>
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="text-lg sm:text-xl font-bold text-[#F1F3F5] tracking-wide">
              AI RACE ENGINEER COPILOT
            </h2>
            <p className="text-[#A6ADB7] text-base font-light italic border-l-2 border-[#E53935] pl-3">
              "Listen to what the lap times can't hear."
            </p>
          </div>

          <p className="text-[#A6ADB7] text-sm leading-relaxed max-w-lg">
            Real-time driver radio emotion & stress intelligence engine. Correlates vocal acoustic tone with telemetry lap deltas to optimize race strategy and performance.
          </p>

          {/* Workflow Pipeline */}
          <div className="pt-2">
            <div className="text-xs font-medium text-[#A6ADB7] mb-3 flex items-center gap-2">
              <Cpu className="w-4 h-4 text-[#E53935]" />
              Telemetry & Speech Pipeline
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {[
                { label: "Radio Input", sub: "Mic / Stream" },
                { label: "AI Transcription", sub: "Whisper / Gemini" },
                { label: "Driver State", sub: "Acoustic Tone" },
                { label: "Lap Performance", sub: "Strategy Signal" }
              ].map((item, idx) => (
                <div key={idx} className="bg-[#13161A] border border-[#292E35] rounded-md p-3 flex flex-col justify-between">
                  <div className="text-xs font-bold text-[#F1F3F5] mb-1">{item.label}</div>
                  <div className="text-xs text-[#A6ADB7]">{item.sub}</div>
                </div>
              ))}
            </div>
          </div>

          {/* System Status Badge */}
          <div className="flex items-center gap-3 pt-1">
            <div className="flex items-center gap-2 bg-[#13161A] border border-[#292E35] px-3 py-1.5 rounded-md text-xs">
              <span className="w-2 h-2 rounded-full bg-[#27C985]" />
              <span className="text-[#27C985] font-semibold text-xs">
                ● AI ENGINE READY
              </span>
            </div>
            {modelStatus?.asr_model && (
              <span className="text-xs text-[#A6ADB7] hidden sm:inline-block">
                [{modelStatus.asr_model}]
              </span>
            )}
          </div>
        </div>

        {/* RIGHT SIDE: Race Engineer Login Form */}
        <div className="lg:col-span-5">
          <div className="bg-[#13161A] border border-[#292E35] rounded-lg p-6 sm:p-8 shadow-xl">
            <div className="flex items-center justify-between mb-6 pb-4 border-b border-[#292E35]">
              <div>
                <h3 className="text-lg font-bold text-[#F1F3F5]">
                  RACE ENGINEER LOGIN
                </h3>
                <p className="text-xs text-[#A6ADB7] mt-0.5">Enter credentials to unlock telemetry controls</p>
              </div>
              <ShieldCheck className="w-6 h-6 text-[#E53935] shrink-0" />
            </div>

            {/* General Form Error Alert */}
            {formError && (
              <div className="mb-5 p-3 bg-[#E53935]/10 border border-[#E53935]/30 rounded-md text-xs text-[#E53935] flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{formError}</span>
              </div>
            )}

            {/* Transition State Banner */}
            {transitionStep && (
              <div className="mb-5 p-3 bg-[#27C985]/10 border border-[#27C985]/30 rounded-md text-xs text-[#27C985] flex items-center gap-2 font-medium">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{transitionStep}</span>
              </div>
            )}

            <form onSubmit={handleFormSubmit} className="space-y-4">
              {/* Email Input */}
              <div>
                <label className="block text-xs font-semibold text-[#A6ADB7] uppercase mb-1.5">
                  Engineer Email
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-[#A6ADB7] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (emailError) setEmailError(null);
                    }}
                    placeholder="engineer@team.com"
                    disabled={isLoading}
                    className={`w-full bg-[#0D0F12] border ${
                      emailError ? 'border-[#E53935]' : 'border-[#292E35] focus:border-[#E53935]'
                    } rounded-md pl-9 pr-3 py-2.5 text-sm text-[#F1F3F5] placeholder:text-[#A6ADB7]/50 focus:outline-none transition-colors`}
                  />
                </div>
                {emailError && (
                  <p className="text-xs text-[#E53935] mt-1">{emailError}</p>
                )}
              </div>

              {/* Password Input */}
              <div>
                <label className="block text-xs font-semibold text-[#A6ADB7] uppercase mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-[#A6ADB7] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (passwordError) setPasswordError(null);
                    }}
                    placeholder="••••••••••••"
                    disabled={isLoading}
                    className={`w-full bg-[#0D0F12] border ${
                      passwordError ? 'border-[#E53935]' : 'border-[#292E35] focus:border-[#E53935]'
                    } rounded-md pl-9 pr-3 py-2.5 text-sm text-[#F1F3F5] placeholder:text-[#A6ADB7]/50 focus:outline-none transition-colors`}
                  />
                </div>
                {passwordError && (
                  <p className="text-xs text-[#E53935] mt-1">{passwordError}</p>
                )}
              </div>

              {/* Options: Remember Me & Forgot Password */}
              <div className="flex items-center justify-between text-xs pt-1">
                <label className="flex items-center gap-2 cursor-pointer text-[#A6ADB7] hover:text-[#F1F3F5]">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="rounded bg-[#0D0F12] border-[#292E35] text-[#E53935] focus:ring-0 focus:ring-offset-0"
                  />
                  <span>Remember me</span>
                </label>

                <button
                  type="button"
                  onClick={() => setForgotModal(true)}
                  className="text-[#A6ADB7] hover:text-[#F1F3F5] transition-colors"
                >
                  Forgot password?
                </button>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-[#E53935] hover:bg-[#F04440] text-white py-2.5 rounded-md font-semibold text-sm tracking-wide transition-all shadow-md flex items-center justify-center gap-2 mt-2 disabled:opacity-50 cursor-pointer"
              >
                {isLoading ? (
                  <span>AUTHENTICATING...</span>
                ) : (
                  <>
                    <span>SIGN IN</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>

            {/* Divider */}
            <div className="relative my-6 text-center">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-[#292E35]" />
              </div>
              <span className="relative bg-[#13161A] px-3 text-xs text-[#A6ADB7]">
                DEMO ACCESS
              </span>
            </div>

            {/* Demo Login Button */}
            <button
              type="button"
              onClick={handleDemoLogin}
              disabled={isLoading}
              className="w-full bg-[#181C21] hover:bg-[#22272E] border border-[#292E35] text-[#F1F3F5] py-2.5 rounded-md font-semibold text-xs tracking-wide transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <span>CONTINUE AS DEMO ENGINEER</span>
            </button>
          </div>
        </div>

      </div>

      {/* Modal for Forgot Password */}
      {forgotModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#13161A] border border-[#292E35] rounded-lg p-6 max-w-md w-full space-y-4">
            <h4 className="text-base font-bold text-[#F1F3F5] flex items-center gap-2">
              <Lock className="w-4 h-4 text-[#E53935]" />
              Team Security Access
            </h4>
            <p className="text-xs text-[#A6ADB7] leading-relaxed">
              Telemetry and radio engineering credentials are issued by your Team Principal or IT Systems Lead. 
            </p>
            <p className="text-xs text-[#F1F3F5] bg-[#0D0F12] p-3 rounded-md border border-[#292E35]">
              For hackathon evaluation or testing, click "CONTINUE AS DEMO ENGINEER" to access the live copilot environment.
            </p>
            <button
              onClick={() => setForgotModal(false)}
              className="w-full bg-[#E53935] hover:bg-[#F04440] text-white py-2 rounded-md font-semibold text-xs uppercase cursor-pointer"
            >
              UNDERSTOOD
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

