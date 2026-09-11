"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { setUser, getUser } from "@/lib/auth";

const GQL_URL = process.env.NEXT_PUBLIC_GRAPHQL_URL ?? "http://localhost:4000/graphql";
type Mode = "login" | "register";

async function fetchLocationSuggestions(query: string): Promise<string[]> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&countrycodes=in&format=json&addressdetails=1&limit=8`,
    { headers: { "Accept-Language": "en" } }
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any[] = await res.json();
  return data.map(item => item.display_name.replace(/, India$/, ""));
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode]               = useState<Mode>("register");
  const [phone, setPhone]             = useState("");
  const [pin, setPin]                 = useState("");
  const [confirmPin, setConfirmPin]   = useState("");
  const [travelsName, setTravelsName] = useState("");
  const [location, setLocation]       = useState("");
  const [error, setError]             = useState("");
  const [loading, setLoading]         = useState(false);
  const [showPin, setShowPin]         = useState(false);
  const [showConfirmPin, setShowConfirmPin] = useState(false);
  const [locationSuggestions, setLocationSuggestions] = useState<string[]>([]);
  const [locationLoading, setLocationLoading]         = useState(false);
  const locationRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (locationRef.current && !locationRef.current.contains(e.target as Node))
        setLocationSuggestions([]);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => { if (getUser()) router.replace("/"); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function switchMode(m: Mode) {
    setMode(m);
    setPhone(""); setPin(""); setConfirmPin("");
    setTravelsName(""); setLocation(""); setError("");
    setShowPin(false); setShowConfirmPin(false);
    setLocationSuggestions([]);
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }

  const isValidPhone = /^[6-9]\d{9}$/.test(phone);

  async function handleLogin() {
    if (!isValidPhone) { setError("Enter a valid 10-digit mobile number."); return; }
    if (!pin)          { setError("Enter your PIN."); return; }
    setLoading(true); setError("");
    try {
      const res = await fetch(GQL_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: `mutation { loginWithPin(phone: "${phone}", pin: ${JSON.stringify(pin)}) { success message token } }` }),
      });
      const { data, errors } = await res.json();
      if (errors || !data?.loginWithPin?.success) {
        setError(data?.loginWithPin?.message ?? errors?.[0]?.message ?? "Login failed.");
        return;
      }
      setUser(phone, data.loginWithPin.token ?? "");
      router.push("/");
    } catch { setError("Network error. Please try again."); }
    finally { setLoading(false); }
  }

  async function handleRegister() {
    if (!travelsName.trim()) { setError("Enter your travels name."); return; }
    if (!location.trim())    { setError("Enter your location."); return; }
    if (!isValidPhone)       { setError("Enter a valid 10-digit mobile number."); return; }
    if (!pin)                { setError("Create a PIN."); return; }
    if (pin !== confirmPin)  { setError("PINs do not match."); return; }
    setLoading(true); setError("");
    try {
      const res = await fetch(GQL_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `mutation { registerOperator(phone: "${phone}", travelsName: ${JSON.stringify(travelsName.trim())}, location: ${JSON.stringify(location.trim())}, pin: ${JSON.stringify(pin)}) { success message token } }`,
        }),
      });
      const { data, errors } = await res.json();
      if (errors || !data?.registerOperator?.success) {
        setError(data?.registerOperator?.message ?? errors?.[0]?.message ?? "Registration failed.");
        return;
      }
      setUser(phone, data.registerOperator.token ?? "");
      router.push("/");
    } catch { setError("Network error. Please try again."); }
    finally { setLoading(false); }
  }

  const inputCls = "w-full px-4 py-3.5 rounded-xl text-sm text-gray-800 font-medium bg-gray-50 border border-gray-200 outline-none focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all placeholder-gray-400";

  return (
    <div className="min-h-screen flex bg-white">

      {/* ── Left panel ─────────────────────────────────────────────── */}
      <div className="hidden lg:flex flex-col w-5/12 relative overflow-hidden"
        style={{ background: "linear-gradient(145deg,#0f172a 0%,#1e3a5f 50%,#1e40af 100%)" }}>

        {/* decorative blobs */}
        <div className="absolute top-0 right-0 w-72 h-72 rounded-full opacity-20"
          style={{ background: "radial-gradient(circle,#3b82f6,transparent)", transform: "translate(30%,-30%)" }} />
        <div className="absolute bottom-0 left-0 w-96 h-96 rounded-full opacity-10"
          style={{ background: "radial-gradient(circle,#818cf8,transparent)", transform: "translate(-30%,30%)" }} />
        <div className="absolute inset-0 opacity-5"
          style={{ backgroundImage: "radial-gradient(circle at 1px 1px, white 1px, transparent 0)", backgroundSize: "32px 32px" }} />

        {/* content */}
        <div className="relative z-10 flex flex-col h-full px-12 py-12">

          {/* brand */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-blue-500/20 border border-blue-400/30">
              <svg className="w-5 h-5 text-blue-300" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 6H5a2 2 0 00-2 2v6a2 2 0 002 2h1m10-10h3a2 2 0 012 2v6a2 2 0 01-2 2h-1M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M8 6h8m-8 8h8" />
              </svg>
            </div>
            <span className="text-white font-bold text-lg tracking-tight">Payanam Operator</span>
          </div>

          {/* hero */}
          <div className="flex-1 flex flex-col justify-center">
            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold text-blue-300 border border-blue-500/40 bg-blue-500/10 w-fit mb-8">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              Fleet Management Portal
            </span>
            <h1 className="text-4xl xl:text-5xl font-black text-white leading-tight mb-5">
              Manage Your<br />
              <span className="text-transparent bg-clip-text"
                style={{ backgroundImage: "linear-gradient(90deg,#60a5fa,#a78bfa)" }}>
                Fleet Smarter
              </span>
            </h1>
            <p className="text-blue-200 text-base leading-relaxed max-w-xs mb-10">
              Track vehicles, manage operators, and grow your travel business — all in one place.
            </p>
            <div className="flex gap-8">
              {[["500+", "Operators"], ["2k+", "Vehicles"], ["4.9★", "Rating"]].map(([val, label]) => (
                <div key={label}>
                  <p className="text-2xl font-black text-white">{val}</p>
                  <p className="text-blue-300 text-xs font-medium mt-0.5">{label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* footer */}
          <div className="border-t border-white/10 pt-6">
            <p className="text-blue-200 text-sm italic opacity-80">
              &ldquo;The best way to manage your fleet — fast, reliable, and beautiful.&rdquo;
            </p>
            <p className="text-blue-400 text-xs mt-2 font-medium">— Payanam Team</p>
          </div>
        </div>
      </div>

      {/* ── Right panel ─────────────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12 overflow-y-auto"
        style={{ background: "linear-gradient(135deg,#f8faff 0%,#f0f4ff 100%)" }}>
        <div className="w-full max-w-md">

          {/* mobile brand */}
          <div className="flex lg:hidden items-center gap-2 mb-8">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-blue-100">
              <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 6H5a2 2 0 00-2 2v6a2 2 0 002 2h1m10-10h3a2 2 0 012 2v6a2 2 0 01-2 2h-1M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M8 6h8m-8 8h8" />
              </svg>
            </div>
            <span className="text-gray-900 font-bold">Payanam Operator</span>
          </div>

          <div className="bg-white rounded-2xl shadow-xl shadow-blue-100/50 border border-gray-100 p-8">

            {/* tabs */}
            <div className="flex bg-gray-100 rounded-xl p-1 mb-7">
              {(["login", "register"] as Mode[]).map(m => (
                <button key={m} onClick={() => switchMode(m)}
                  className="flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all"
                  style={mode === m
                    ? { background: "linear-gradient(135deg,#1d4ed8,#4f46e5)", color: "#fff", boxShadow: "0 2px 8px rgba(79,70,229,0.35)" }
                    : { color: "#6b7280" }
                  }>
                  {m === "login" ? "Sign In" : "Register"}
                </button>
              ))}
            </div>

            <div className="mb-6">
              <h2 className="text-2xl font-black text-gray-900">
                {mode === "login" ? "Welcome back" : "Create account"}
              </h2>
              <p className="text-gray-500 text-sm mt-1">
                {mode === "login" ? "Sign in to your operator account." : "Fill in your details to get started."}
              </p>
            </div>

            <div className="space-y-4">

              {mode === "register" && (
                <>
                  {/* travels name */}
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Travels Name</label>
                    <input type="text" value={travelsName} autoFocus
                      onChange={e => { setTravelsName(e.target.value); setError(""); }}
                      placeholder="e.g. Sri Murugan Travels"
                      className={inputCls} />
                  </div>

                  {/* location */}
                  <div ref={locationRef} className="relative">
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Location</label>
                    <div className="relative">
                      <input type="text" value={location}
                        onChange={e => {
                          const v = e.target.value;
                          setLocation(v); setError("");
                          if (debounceRef.current) clearTimeout(debounceRef.current);
                          if (v.trim().length < 2) { setLocationSuggestions([]); setLocationLoading(false); return; }
                          setLocationLoading(true);
                          debounceRef.current = setTimeout(() => {
                            fetchLocationSuggestions(v.trim())
                              .then(r => { setLocationSuggestions(r); setLocationLoading(false); })
                              .catch(() => { setLocationSuggestions([]); setLocationLoading(false); });
                          }, 400);
                        }}
                        placeholder="e.g. Chennai, Tamil Nadu"
                        className={inputCls} />
                      {locationLoading && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2">
                          <svg className="animate-spin w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                        </div>
                      )}
                    </div>
                    {locationSuggestions.length > 0 && (
                      <ul className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-100 rounded-xl shadow-xl overflow-hidden max-h-52 overflow-y-auto">
                        {locationSuggestions.map((place, i) => (
                          <li key={i} onMouseDown={e => { e.preventDefault(); setLocation(place); setLocationSuggestions([]); }}
                            className="px-4 py-3 text-sm text-gray-700 cursor-pointer hover:bg-blue-50 flex items-start gap-2.5 transition-colors">
                            <svg className="w-3.5 h-3.5 text-gray-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            {place}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              )}

              {/* phone */}
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Mobile Number</label>
                <div className="flex items-center bg-gray-50 border border-gray-200 rounded-xl overflow-hidden focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 transition-all">
                  <span className="px-4 py-3.5 text-sm font-bold text-gray-500 border-r border-gray-200 select-none bg-gray-100">+91</span>
                  <input type="tel" maxLength={10} value={phone}
                    autoFocus={mode === "login"}
                    onChange={e => { setPhone(e.target.value.replace(/\D/g, "")); setError(""); }}
                    onKeyDown={e => e.key === "Enter" && (mode === "login" ? handleLogin() : handleRegister())}
                    placeholder="Enter number"
                    className="flex-1 px-4 py-3.5 text-sm text-gray-800 font-medium bg-transparent outline-none placeholder-gray-400" />
                  {isValidPhone && (
                    <div className="pr-3">
                      <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center">
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* PIN */}
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">PIN</label>
                <div className="flex items-center bg-gray-50 border border-gray-200 rounded-xl overflow-hidden focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 transition-all">
                  <input type={showPin ? "text" : "password"} value={pin}
                    onChange={e => { setPin(e.target.value); setError(""); }}
                    onKeyDown={e => e.key === "Enter" && (mode === "login" ? handleLogin() : handleRegister())}
                    placeholder={mode === "login" ? "Enter your PIN" : "Create a PIN"}
                    className="flex-1 px-4 py-3.5 text-sm text-gray-800 font-medium bg-transparent outline-none placeholder-gray-400" />
                  <button type="button" onClick={() => setShowPin(v => !v)}
                    className="pr-4 text-gray-400 hover:text-gray-600 transition-colors" tabIndex={-1}>
                    {showPin
                      ? <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                      : <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                    }
                  </button>
                </div>
              </div>

              {/* confirm PIN */}
              {mode === "register" && (
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Confirm PIN</label>
                  <div className={`flex items-center bg-gray-50 border rounded-xl overflow-hidden focus-within:ring-2 transition-all ${confirmPin && confirmPin !== pin ? "border-red-300 focus-within:ring-red-100" : "border-gray-200 focus-within:border-blue-400 focus-within:ring-blue-100"}`}>
                    <input type={showConfirmPin ? "text" : "password"} value={confirmPin}
                      onChange={e => { setConfirmPin(e.target.value); setError(""); }}
                      onKeyDown={e => e.key === "Enter" && handleRegister()}
                      placeholder="Re-enter PIN"
                      className="flex-1 px-4 py-3.5 text-sm text-gray-800 font-medium bg-transparent outline-none placeholder-gray-400" />
                    <button type="button" onClick={() => setShowConfirmPin(v => !v)}
                      className="pr-4 text-gray-400 hover:text-gray-600 transition-colors" tabIndex={-1}>
                      {showConfirmPin
                        ? <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                        : <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                      }
                    </button>
                  </div>
                  {confirmPin && confirmPin !== pin && (
                    <p className="text-red-500 text-xs mt-1.5 font-medium">PINs do not match</p>
                  )}
                </div>
              )}

              {/* error */}
              {error && (
                <p className="flex items-center gap-1.5 text-red-500 text-xs font-medium bg-red-50 border border-red-100 px-3 py-2 rounded-lg">
                  <svg className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  {error}
                </p>
              )}

              {/* submit */}
              <button onClick={mode === "login" ? handleLogin : handleRegister}
                disabled={loading || !isValidPhone || !pin || (mode === "register" && (!travelsName.trim() || !location.trim() || pin !== confirmPin))}
                className="w-full py-3.5 rounded-xl font-bold text-white text-sm tracking-wide transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 mt-2"
                style={{ background: "linear-gradient(135deg,#1d4ed8,#4f46e5)" }}>
                {loading
                  ? <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                  : <>{mode === "login" ? "Sign In" : "Create Account"} <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg></>
                }
              </button>
            </div>

            <p className="text-center text-gray-400 text-xs mt-5">
              By continuing, you agree to our{" "}
              <span className="text-blue-500 font-semibold cursor-pointer hover:underline">Terms of Service</span>
            </p>
          </div>

          <p className="text-center text-gray-400 text-xs mt-5">© 2025 Payanam. All rights reserved.</p>
        </div>
      </div>
    </div>
  );
}
