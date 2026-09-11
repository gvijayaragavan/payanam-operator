"use client";

import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { getUser, logout, getAuthHeaders, AuthUser } from "@/lib/auth";
import { Vehicle } from "@/lib/data";

const PRESET_COLORS = ["#e53935","#f97316","#f59e0b","#10b981","#0ea5e9","#6366f1","#8b5cf6","#ec4899"];
type FilterKey = "All" | "Available" | "Diesel" | "Petrol";

const GQL_URL = process.env.NEXT_PUBLIC_GRAPHQL_URL ?? "http://localhost:4000/graphql";

const VEHICLE_QUERY = `
  query { vehicles {
    id name model category seater fuel specialist plate color ac available imageUris perKmPrice minKm priority
    fcEndDate fcDocument insuranceEndDate insuranceDocument rcBook
    pricing {
      s1 { baseFare perDay driverCharges hillsCharges }
      s2  { perKm perDayPrice driverAllowance hillsCharges tollParking sightseeing }
      s2b { perKm perDayPrice driverAllowance hillsCharges tollParking sightseeing }
      s3  { perKm perDayPrice driverAllowance hillsCharges tollParking sightseeing }
      s3b { perKm perDayPrice driverAllowance hillsCharges tollParking sightseeing }
      s4  { perDayRent perKmRate driverAllowance hillsCharges tollParking }
      s4b { perDayRent perKmRate driverAllowance hillsCharges tollParking }
      s5  { perDayRent perKmRate driverCharges hillsCharges tollParking }
      s5b { perDayRent perKmRate driverCharges hillsCharges tollParking }
      s6  { kmRange minFare additionalKmRange }
      s6b { kmRange minFare additionalKmRange }
      s7 { from to day1 day2 day3 tollParking }

    }
  }}
`;

const SHOW_PER_KM_QUERY = `query { setting(key: "showPerKm") }`;
const ME_QUERY = `query { me { travelsName location operatorId } }`;

const CREATE_VEHICLE = `
  mutation CreateVehicle($input: CreateVehicleInput!) {
    createVehicle(input: $input) { id }
  }
`;

const UPDATE_VEHICLE = `
  mutation UpdateVehicle($id: ID!, $input: UpdateVehicleInput!) {
    updateVehicle(id: $id, input: $input) { id }
  }
`;


function getVehicleCategory(modelYear: string): "Economy" | "Premium" | "Platinum" {
  const year = Number(modelYear);
  if (year > 2023) return "Platinum";
  if (year >= 2020) return "Premium";
  return "Economy";
}

function compressImage(file: File, maxWidth = 900, quality = 0.72): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale  = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement("canvas");
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = reject;
    img.src = url;
  });
}

async function backfillPriority(list: Vehicle[]): Promise<Vehicle[]> {
  const needsBackfill = list.filter(v => v.priority === undefined || v.priority === null);
  if (!needsBackfill.length) return list;
  await Promise.all(
    needsBackfill.map(v =>
      fetch(GQL_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          query: `mutation UpdateVehicle($id: ID!, $input: UpdateVehicleInput!) { updateVehicle(id: $id, input: $input) { id } }`,
          variables: {
            id: v.id,
            input: {
              name: v.name, model: v.model, category: v.category,
              seater: v.seater, fuel: v.fuel, specialist: v.specialist,
              plate: v.plate, color: v.color, ac: v.ac, available: v.available,
              imageUris: v.images ?? undefined,
              perKmPrice: v.perKmPrice ?? undefined,
              fcEndDate: v.fcEndDate ?? undefined, fcDocument: v.fcDocument ?? undefined,
              insuranceEndDate: v.insuranceEndDate ?? undefined, insuranceDocument: v.insuranceDocument ?? undefined,
              rcBook: v.rcBook ?? undefined,
              priority: 3,
            },
          },
        }),
      }).catch(() => null)
    )
  );
  return list.map(v =>
    v.priority === undefined || v.priority === null ? { ...v, priority: 3 } : v
  );
}

async function fetchFleetFromDB(): Promise<Vehicle[]> {
  const res  = await fetch(GQL_URL, {
    method: "POST", headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify({ query: VEHICLE_QUERY }),
  });
  const json = await res.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const list: any[] = json?.data?.vehicles ?? [];
  return list.map((v): Vehicle => ({
    id: String(v.id ?? ""), name: String(v.name ?? ""), model: String(v.model ?? ""),
    category: (["Economy","Premium","Platinum"].includes(v.category) ? v.category : undefined) as Vehicle["category"],
    seater: Number(v.seater ?? 0),
    fuel: (v.fuel === "Petrol" ? "Petrol" : "Diesel") as "Diesel" | "Petrol",
    specialist: String(v.specialist ?? ""),
    plate: String(v.plate ?? ""), color: String(v.color ?? "#1a6fe8"),
    ac: Boolean(v.ac ?? true), available: Boolean(v.available ?? true),
    images: Array.isArray(v.imageUris) && v.imageUris.length ? v.imageUris : undefined,
    perKmPrice: v.perKmPrice !== undefined && v.perKmPrice !== null ? Number(v.perKmPrice) : undefined,
    minKm:      v.minKm      !== undefined && v.minKm      !== null ? Number(v.minKm)      : undefined,
    fcEndDate:         v.fcEndDate         || undefined,
    fcDocument:        v.fcDocument        || undefined,
    insuranceEndDate:  v.insuranceEndDate  || undefined,
    insuranceDocument: v.insuranceDocument || undefined,
    rcBook:            v.rcBook            || undefined,
    pricing:           v.pricing           || undefined,
    priority:          v.priority !== undefined && v.priority !== null ? Number(v.priority) : undefined,
  }));
}

// ── Fuel icon paths ───────────────────────────────────────────────────────────
const DIESEL_PATH = "M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z";
const PETROL_PATH = "M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z";

// ── Doc Upload ────────────────────────────────────────────────────────────────
function DocUpload({ value, label, onUpload, onRemove }: {
  value: string; label: string;
  onUpload: (f: File) => Promise<void>;
  onRemove: () => void;
}) {
  if (value) {
    return (
      <div className="relative rounded-xl overflow-hidden border-2 border-blue-200 aspect-video">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={value} alt={label} className="w-full h-full object-cover" />
        <button
          type="button"
          onClick={onRemove}
          className="absolute top-1 right-1 w-6 h-6 rounded-full bg-red-500 flex items-center justify-center shadow"
        >
          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    );
  }
  return (
    <label className="block cursor-pointer">
      <div className="h-12 rounded-xl border-2 border-dashed border-blue-200 bg-blue-50/50 hover:border-blue-400 hover:bg-blue-50 flex items-center justify-center gap-2 transition-all">
        <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
        </svg>
        <span className="text-xs font-bold text-blue-400">{label}</span>
      </div>
      <input type="file" accept="image/*" className="hidden"
        onChange={async e => {
          const f = e.target.files?.[0];
          if (f) { e.target.value = ""; await onUpload(f); }
        }} />
    </label>
  );
}

// ── Pricing state (shared by FareDetailsModal) ────────────────────────────────
const EMPTY_PRICING = {
  s1_baseFare: "", s1_perDay: "", s1_driverCharges: "", s1_hillsCharges: "",
  s2_perKm:  "", s2_perDayPrice:  "", s2_driverAllowance:  "", s2_hillsCharges:  "", s2_tollParking:  "", s2_sightseeing:  "",
  s2b_perKm: "", s2b_perDayPrice: "", s2b_driverAllowance: "", s2b_hillsCharges: "", s2b_tollParking: "", s2b_sightseeing: "",
  s3_perKm:  "", s3_perDayPrice:  "", s3_driverAllowance:  "", s3_hillsCharges:  "", s3_tollParking:  "", s3_sightseeing:  "",
  s3b_perKm: "", s3b_perDayPrice: "", s3b_driverAllowance: "", s3b_hillsCharges: "", s3b_tollParking: "", s3b_sightseeing: "",
  s4_perDayRent:  "", s4_perKmRate:  "", s4_driverAllowance:  "", s4_hillsCharges:  "", s4_tollParking:  "",
  s4b_perDayRent: "", s4b_perKmRate: "", s4b_driverAllowance: "", s4b_hillsCharges: "", s4b_tollParking: "",
  s5_perDayRent:  "", s5_perKmRate:  "", s5_driverCharges:  "", s5_hillsCharges:  "", s5_tollParking:  "",
  s5b_perDayRent: "", s5b_perKmRate: "", s5b_driverCharges: "", s5b_hillsCharges: "", s5b_tollParking: "",
  s6_kmRange:  "", s6_minFare:  "", s6_additionalKmRange:  "",
  s6b_kmRange: "", s6b_minFare: "", s6b_additionalKmRange: "",
};
type PricingState = typeof EMPTY_PRICING;

// ── Vehicle Form Modal ────────────────────────────────────────────────────────

const EMPTY_FORM = {
  name: "", model: "", seater: "", plate: "", specialist: "",
  fuel: "Diesel" as "Diesel" | "Petrol", ac: true, available: true, color: PRESET_COLORS[4], images: [] as string[],
  perKmPrice: "",
  fcEndDate: "", fcDocument: "",
  insuranceEndDate: "", insuranceDocument: "",
  rcBook: "",
  priority: "3",
  category: "Economy" as "Economy" | "Premium" | "Platinum",
};

type FormState = typeof EMPTY_FORM;

function VehicleModal({
  mode, initial, nextId, onClose, onSave, showPerKm,
}: {
  mode: "add" | "edit";
  initial?: Vehicle;
  nextId: string;
  onClose: () => void;
  onSave: (v: Vehicle) => void;
  showPerKm: boolean;
}) {
  const [form, setForm] = useState<FormState>(
    initial
      ? { name: initial.name, model: initial.model, seater: String(initial.seater), plate: initial.plate, specialist: initial.specialist, fuel: initial.fuel, ac: initial.ac, available: initial.available, color: initial.color, images: initial.images ?? [], perKmPrice: initial.perKmPrice !== undefined ? String(initial.perKmPrice) : "", fcEndDate: initial.fcEndDate ?? "", fcDocument: initial.fcDocument ?? "", insuranceEndDate: initial.insuranceEndDate ?? "", insuranceDocument: initial.insuranceDocument ?? "", rcBook: initial.rcBook ?? "", priority: initial.priority !== undefined ? String(initial.priority) : "3", category: (["Economy","Premium","Platinum"].includes(initial.category ?? "") ? initial.category! : "Economy") as "Economy" | "Premium" | "Platinum" }
      : EMPTY_FORM
  );
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [saving, setSaving] = useState(false);

  function validate() {
    const e: Partial<Record<keyof FormState, string>> = {};
    if (!form.name.trim())       e.name       = "Required";
    if (!form.model.trim())      e.model      = "Required";
    if (!form.plate.trim())      e.plate      = "Required";
    if (!form.specialist.trim()) e.specialist = "Required";
    if (!form.seater || isNaN(Number(form.seater)) || Number(form.seater) < 1) e.seater = "Enter a valid number";
    return e;
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }

    const modelYear = form.model.trim();
    const gqlInput = {
      name:              form.name.trim(),
      model:             modelYear,
      category:          form.category,
      seater:            Number(form.seater),
      fuel:              form.fuel,
      specialist:        form.specialist.trim(),
      plate:             form.plate.trim(),
      color:             form.color,
      ac:                form.ac,
      available:         form.available,
      imageUris:         form.images.length ? form.images : undefined,
      perKmPrice:        form.perKmPrice ? Number(form.perKmPrice) : undefined,
      fcEndDate:         form.fcEndDate         || undefined,
      fcDocument:        form.fcDocument        || undefined,
      insuranceEndDate:  form.insuranceEndDate  || undefined,
      insuranceDocument: form.insuranceDocument || undefined,
      rcBook:            form.rcBook            || undefined,
      priority:          form.priority ? Number(form.priority) : 3,
    };

    setSaving(true);
    try {
      if (mode === "add") {
        const res  = await fetch(GQL_URL, {
          method:  "POST",
          headers: { "Content-Type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify({ query: CREATE_VEHICLE, variables: { input: gqlInput } }),
        });
        const json = await res.json();
        if (json.errors?.length) throw new Error(json.errors[0].message);
        onSave({
          id: json.data.createVehicle.id,
          name: gqlInput.name, model: gqlInput.model, category: gqlInput.category, seater: gqlInput.seater,
          fuel: gqlInput.fuel, specialist: gqlInput.specialist, plate: gqlInput.plate,
          color: gqlInput.color, ac: gqlInput.ac, available: gqlInput.available,
          perKmPrice: gqlInput.perKmPrice,
          images: form.images.length ? form.images : undefined,
          fcEndDate: gqlInput.fcEndDate, fcDocument: gqlInput.fcDocument,
          insuranceEndDate: gqlInput.insuranceEndDate, insuranceDocument: gqlInput.insuranceDocument,
          rcBook: gqlInput.rcBook, priority: gqlInput.priority,
        });
      } else {
        const res  = await fetch(GQL_URL, {
          method:  "POST",
          headers: { "Content-Type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify({ query: UPDATE_VEHICLE, variables: { id: initial!.id, input: gqlInput } }),
        });
        const json = await res.json();
        if (json.errors?.length) throw new Error(json.errors[0].message);
        onSave({
          id: initial!.id,
          name: gqlInput.name, model: gqlInput.model, category: gqlInput.category, seater: gqlInput.seater,
          fuel: gqlInput.fuel, specialist: gqlInput.specialist, plate: gqlInput.plate,
          color: gqlInput.color, ac: gqlInput.ac, available: gqlInput.available,
          perKmPrice: gqlInput.perKmPrice,
          images: form.images.length ? form.images : undefined,
          fcEndDate: gqlInput.fcEndDate, fcDocument: gqlInput.fcDocument,
          insuranceEndDate: gqlInput.insuranceEndDate, insuranceDocument: gqlInput.insuranceDocument,
          rcBook: gqlInput.rcBook, priority: gqlInput.priority,
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save vehicle. Please try again.";
      alert(msg);
    } finally {
      setSaving(false);
    }
  }

  function set<K extends keyof FormState>(key: K, val: FormState[K]) {
    setForm(f => ({ ...f, [key]: val }));
    setErrors(e => { const c = { ...e }; delete c[key]; return c; });
  }

  const field = (err?: string) =>
    `w-full px-4 py-3 rounded-xl text-lg font-medium text-gray-800 border outline-none transition-all
     ${err ? "border-red-400 bg-red-50" : "border-gray-200 bg-gray-50 focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white w-full max-w-5xl rounded-2xl shadow-2xl max-h-[92dvh] flex flex-col overflow-y-auto">

        {/* Header */}
        <div className="shrink-0 px-6 pt-6 pb-5 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#1d4ed8,#3b82f6)" }}>
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                {mode === "add"
                  ? <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  : <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />}
              </svg>
            </div>
            <div>
              <h2 className="font-extrabold text-gray-900 text-2xl">{mode === "add" ? "Add New Vehicle" : "Edit Vehicle"}</h2>
              <p className="text-base text-gray-400 mt-0.5">
                {mode === "add" ? <>ID: <span className="font-mono font-bold text-blue-500">{nextId}</span></> : initial?.id}
              </p>
            </div>
            <button onClick={onClose} className="ml-auto w-8 h-8 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors">
              <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">

              {/* Left column */}
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-bold uppercase tracking-widest text-gray-400 mb-1.5">Vehicle Name</label>
                  <input value={form.name ?? ""} onChange={e => set("name", e.target.value)} placeholder="e.g. Toyota Innova Crysta" className={field(errors.name)} />
                  {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-bold uppercase tracking-widest text-gray-400 mb-1.5">Model Year</label>
                    <input value={form.model ?? ""} onChange={e => set("model", e.target.value)} placeholder="2023" className={field(errors.model)} />
                    {errors.model && <p className="text-xs text-red-500 mt-1">{errors.model}</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-bold uppercase tracking-widest text-gray-400 mb-1.5">Plate Number</label>
                    <input value={form.plate ?? ""} onChange={e => set("plate", e.target.value)} placeholder="TN 33 AX 4521" className={field(errors.plate)} />
                    {errors.plate && <p className="text-xs text-red-500 mt-1">{errors.plate}</p>}
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-bold uppercase tracking-widest text-gray-400 mb-1.5">Seats</label>
                    <input type="number" min={1} value={form.seater ?? ""} onChange={e => set("seater", e.target.value)} placeholder="7" className={field(errors.seater)} />
                    {errors.seater && <p className="text-xs text-red-500 mt-1">{errors.seater}</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-bold uppercase tracking-widest text-gray-400 mb-1.5">Priority</label>
                    <input type="number" min={1} value={form.priority ?? "3"} onChange={e => set("priority", e.target.value)} placeholder="3" className={field()} />
                  </div>
                </div>
                {showPerKm && (
                  <div>
                    <label className="block text-sm font-bold uppercase tracking-widest text-gray-400 mb-1.5">Per KM Price (₹)</label>
                    <input type="number" min={0} step="0.01" value={form.perKmPrice ?? ""} onChange={e => set("perKmPrice", e.target.value)} placeholder="18.00" className={field()} />
                  </div>
                )}
                <div>
                  <label className="block text-sm font-bold uppercase tracking-widest text-gray-400 mb-1.5">Owner&apos;s Name</label>
                  <input value={form.specialist ?? ""} onChange={e => set("specialist", e.target.value)} placeholder="e.g. Rajan Kumar" className={field(errors.specialist)} />
                  {errors.specialist && <p className="text-xs text-red-500 mt-1">{errors.specialist}</p>}
                </div>
                <div>
                  <label className="block text-sm font-bold uppercase tracking-widest text-gray-400 mb-1.5">Fuel Type</label>
                  <div className="grid grid-cols-2 gap-3">
                    {(["Diesel", "Petrol"] as const).map(f => (
                      <button type="button" key={f} onClick={() => set("fuel", f)}
                        className={`py-2.5 rounded-xl text-base font-bold border-2 transition-all ${form.fuel === f ? (f === "Diesel" ? "border-amber-400 bg-amber-50 text-amber-700" : "border-green-400 bg-green-50 text-green-700") : "border-gray-200 bg-gray-50 text-gray-400 hover:border-gray-300"}`}>
                        {f}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-bold uppercase tracking-widest text-gray-400 mb-1.5">Category</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(["Economy", "Premium", "Platinum"] as const).map(cat => (
                      <button type="button" key={cat} onClick={() => set("category", cat)}
                        className={`py-2.5 rounded-xl text-sm font-bold border-2 transition-all ${form.category === cat ? "border-blue-400 bg-blue-50 text-blue-700" : "border-gray-200 bg-gray-50 text-gray-400 hover:border-gray-300"}`}>
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {([["ac", "AC"], ["available", "Available"]] as const).map(([key, label]) => (
                    <button type="button" key={key} onClick={() => set(key, !form[key])}
                      className={`py-2.5 rounded-xl text-base font-bold border-2 transition-all ${form[key] ? "border-blue-400 bg-blue-50 text-blue-700" : "border-gray-200 bg-gray-50 text-gray-400 hover:border-gray-300"}`}>
                      {form[key] ? `✓ ${label}` : label}
                    </button>
                  ))}
                </div>
                <div>
                  <label className="block text-sm font-bold uppercase tracking-widest text-gray-400 mb-2">Card Color</label>
                  <div className="flex gap-2 flex-wrap">
                    {PRESET_COLORS.map(c => (
                      <button type="button" key={c} onClick={() => set("color", c)}
                        className={`w-7 h-7 rounded-lg transition-all hover:scale-110 ${form.color === c ? "ring-2 ring-offset-2 ring-gray-700 scale-110" : ""}`}
                        style={{ backgroundColor: c }} />
                    ))}
                  </div>
                </div>
              </div>

              {/* Right column */}
              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-sm font-bold uppercase tracking-widest text-gray-400">Vehicle Photos</label>
                    {form.images.length > 0 && (
                      <span className="text-[10px] font-bold text-blue-500 bg-blue-50 px-2 py-0.5 rounded-full">
                        {form.images.length} photo{form.images.length !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                  {form.images.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 mb-1.5">
                      {form.images.map((img, i) => (
                        <div key={i} className="relative aspect-video rounded-lg overflow-hidden border border-gray-100 group">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={img} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
                          <button type="button" onClick={() => set("images", form.images.filter((_, j) => j !== i))}
                            className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center">
                            <span className="opacity-0 group-hover:opacity-100 transition-opacity w-6 h-6 rounded-full bg-red-500 flex items-center justify-center shadow">
                              <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </span>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <label className="block cursor-pointer">
                    <div className="h-11 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 hover:border-blue-400 hover:bg-blue-50 flex items-center justify-center gap-2 transition-all">
                      <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                      </svg>
                      <span className="text-xs font-bold text-gray-400">{form.images.length === 0 ? "Add vehicle photos" : "Add more photos"}</span>
                    </div>
                    <input type="file" accept="image/*" multiple className="hidden"
                      onChange={async e => {
                        const files = Array.from(e.target.files ?? []);
                        if (!files.length) return;
                        e.target.value = "";
                        const results = await Promise.all(files.map(f => compressImage(f)));
                        set("images", [...form.images, ...results]);
                      }} />
                  </label>
                </div>
                <div className="rounded-2xl border border-blue-100 bg-blue-50/40 p-3 space-y-3">
                  <p className="text-sm font-black uppercase tracking-widest text-blue-400">Documents</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-bold uppercase tracking-widest text-gray-400 mb-1.5">FC End Date</label>
                      <input type="date" value={form.fcEndDate} onChange={e => set("fcEndDate", e.target.value)} className={field()} />
                    </div>
                    <div>
                      <label className="block text-sm font-bold uppercase tracking-widest text-gray-400 mb-1.5">FC Document</label>
                      <DocUpload value={form.fcDocument} label="Upload FC"
                        onUpload={async f => { const r = await compressImage(f); set("fcDocument", r); }}
                        onRemove={() => set("fcDocument", "")} />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-bold uppercase tracking-widest text-gray-400 mb-1.5">Insurance End Date</label>
                      <input type="date" value={form.insuranceEndDate} onChange={e => set("insuranceEndDate", e.target.value)} className={field()} />
                    </div>
                    <div>
                      <label className="block text-sm font-bold uppercase tracking-widest text-gray-400 mb-1.5">Insurance Document</label>
                      <DocUpload value={form.insuranceDocument} label="Upload Insurance"
                        onUpload={async f => { const r = await compressImage(f); set("insuranceDocument", r); }}
                        onRemove={() => set("insuranceDocument", "")} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-bold uppercase tracking-widest text-gray-400 mb-1.5">RC Book</label>
                    <DocUpload value={form.rcBook} label="Upload RC Book"
                      onUpload={async f => { const r = await compressImage(f); set("rcBook", r); }}
                      onRemove={() => set("rcBook", "")} />
                  </div>
                </div>
              </div>
            </div>

          {/* ── Save ── */}
          <div className="flex gap-2 pt-5">
            <button type="button" onClick={onClose}
              className="px-4 py-3 rounded-xl border-2 border-gray-200 text-base font-bold text-gray-500 hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-3 rounded-xl text-base font-extrabold text-white transition-all hover:opacity-90 hover:shadow-lg disabled:opacity-60"
              style={{ background: "linear-gradient(135deg,#1d4ed8,#3b82f6)" }}>
              {saving ? "Saving…" : mode === "add" ? "Add Vehicle" : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Fare Details Modal ────────────────────────────────────────────────────────
function FareDetailsModal({
  vehicle, fleet, onClose,
}: {
  vehicle: Vehicle | null;
  fleet: Vehicle[];
  onClose: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string>(vehicle?.id ?? "");
  const selectedVehicle = vehicle ?? fleet.find(v => v.id === selectedId) ?? null;

  const ip = selectedVehicle?.pricing;
  const [pricing, setPricingState] = useState<PricingState>(ip ? {
    s1_baseFare: String(ip.s1?.baseFare ?? ""), s1_perDay: String(ip.s1?.perDay ?? ""), s1_driverCharges: String(ip.s1?.driverCharges ?? ""), s1_hillsCharges: String(ip.s1?.hillsCharges ?? ""),
    s2_perKm:  String(ip.s2?.perKm  ?? ""), s2_perDayPrice:  String(ip.s2?.perDayPrice  ?? ""), s2_driverAllowance:  String(ip.s2?.driverAllowance  ?? ""), s2_hillsCharges:  String(ip.s2?.hillsCharges  ?? ""), s2_tollParking:  String(ip.s2?.tollParking  ?? ""), s2_sightseeing:  String(ip.s2?.sightseeing  ?? ""),
    s2b_perKm: String(ip.s2b?.perKm ?? ""), s2b_perDayPrice: String(ip.s2b?.perDayPrice ?? ""), s2b_driverAllowance: String(ip.s2b?.driverAllowance ?? ""), s2b_hillsCharges: String(ip.s2b?.hillsCharges ?? ""), s2b_tollParking: String(ip.s2b?.tollParking ?? ""), s2b_sightseeing: String(ip.s2b?.sightseeing ?? ""),
    s3_perKm:  String(ip.s3?.perKm  ?? ""), s3_perDayPrice:  String(ip.s3?.perDayPrice  ?? ""), s3_driverAllowance:  String(ip.s3?.driverAllowance  ?? ""), s3_hillsCharges:  String(ip.s3?.hillsCharges  ?? ""), s3_tollParking:  String(ip.s3?.tollParking  ?? ""), s3_sightseeing:  String(ip.s3?.sightseeing  ?? ""),
    s3b_perKm: String(ip.s3b?.perKm ?? ""), s3b_perDayPrice: String(ip.s3b?.perDayPrice ?? ""), s3b_driverAllowance: String(ip.s3b?.driverAllowance ?? ""), s3b_hillsCharges: String(ip.s3b?.hillsCharges ?? ""), s3b_tollParking: String(ip.s3b?.tollParking ?? ""), s3b_sightseeing: String(ip.s3b?.sightseeing ?? ""),
    s4_perDayRent:  String(ip.s4?.perDayRent  ?? ""), s4_perKmRate:  String(ip.s4?.perKmRate  ?? ""), s4_driverAllowance:  String(ip.s4?.driverAllowance  ?? ""), s4_hillsCharges:  String(ip.s4?.hillsCharges  ?? ""), s4_tollParking:  String(ip.s4?.tollParking  ?? ""),
    s4b_perDayRent: String(ip.s4b?.perDayRent ?? ""), s4b_perKmRate: String(ip.s4b?.perKmRate ?? ""), s4b_driverAllowance: String(ip.s4b?.driverAllowance ?? ""), s4b_hillsCharges: String(ip.s4b?.hillsCharges ?? ""), s4b_tollParking: String(ip.s4b?.tollParking ?? ""),
    s5_perDayRent:  String(ip.s5?.perDayRent  ?? ""), s5_perKmRate:  String(ip.s5?.perKmRate  ?? ""), s5_driverCharges:  String(ip.s5?.driverCharges  ?? ""), s5_hillsCharges:  String(ip.s5?.hillsCharges  ?? ""), s5_tollParking:  String(ip.s5?.tollParking  ?? ""),
    s5b_perDayRent: String(ip.s5b?.perDayRent ?? ""), s5b_perKmRate: String(ip.s5b?.perKmRate ?? ""), s5b_driverCharges: String(ip.s5b?.driverCharges ?? ""), s5b_hillsCharges: String(ip.s5b?.hillsCharges ?? ""), s5b_tollParking: String(ip.s5b?.tollParking ?? ""),
    s6_kmRange:  String(ip.s6?.kmRange  ?? ""), s6_minFare:  String(ip.s6?.minFare  ?? ""), s6_additionalKmRange:  String(ip.s6?.additionalKmRange  ?? ""),
    s6b_kmRange: String(ip.s6b?.kmRange ?? ""), s6b_minFare: String(ip.s6b?.minFare ?? ""), s6b_additionalKmRange: String(ip.s6b?.additionalKmRange ?? ""),
  } : EMPTY_PRICING);

  const [minKm, setMinKm] = useState<string>(
    selectedVehicle?.minKm !== undefined && selectedVehicle.minKm !== null
      ? String(selectedVehicle.minKm) : ""
  );

  type Pkg = { from: string; to: string; day1: string; day2: string; day3: string; tollParking: string };
  const emptyPkg = (): Pkg => ({ from: "", to: "", day1: "", day2: "", day3: "", tollParking: "" });
  const [packages, setPackages] = useState<Pkg[]>(
    ip?.s7?.length ? ip.s7.map(p => ({
      from: p.from ?? "", to: p.to ?? "",
      day1: String(p.day1 ?? ""), day2: String(p.day2 ?? ""),
      day3: String(p.day3 ?? ""), tollParking: String(p.tollParking ?? ""),
    })) : [emptyPkg()]
  );

  function setPkg(i: number, field: keyof Pkg, val: string) {
    setPackages(ps => ps.map((p, idx) => idx === i ? { ...p, [field]: val } : p));
  }
  function addPkg() { setPackages(ps => [...ps, emptyPkg()]); }
  function removePkg(i: number) { setPackages(ps => ps.filter((_, idx) => idx !== i)); }
  const [kmSaved, setKmSaved] = useState(false);

  async function autoSaveKm() {
    if (!selectedVehicle || minKm === "") return;
    try {
      const res = await fetch(GQL_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          query: UPDATE_VEHICLE,
          variables: { id: selectedVehicle.id, input: { minKm: Number(minKm) } },
        }),
      });
      const json = await res.json();
      if (json.errors?.length) {
        console.error("saveMinKm error:", json.errors[0].message);
        return;
      }
      setKmSaved(true);
      setTimeout(() => setKmSaved(false), 2000);
    } catch (err) {
      console.error("saveMinKm network error:", err);
    }
  }

  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [acTab,    setAcTab]    = useState<"lt" | "gt">("lt");
  const [nonAcTab, setNonAcTab] = useState<"lt" | "gt">("lt");

  function setP<K extends keyof PricingState>(key: K, val: string) {
    setPricingState(p => ({ ...p, [key]: val }));
  }

  function n(s: string): number | undefined {
    const v = parseFloat(s);
    return isNaN(v) ? undefined : v;
  }

  const field = () =>
    "w-full px-4 py-3.5 rounded-xl text-lg font-medium text-black border border-gray-200 bg-gray-50 outline-none focus:border-orange-400 focus:bg-white focus:ring-2 focus:ring-orange-100 transition-all";

  async function handleSave() {
    if (!selectedVehicle) return;
    const pricingInput = {
      s1: { baseFare: n(pricing.s1_baseFare), perDay: n(pricing.s1_perDay), driverCharges: n(pricing.s1_driverCharges), hillsCharges: n(pricing.s1_hillsCharges) },
      s2:  { perKm: n(pricing.s2_perKm),  perDayPrice: n(pricing.s2_perDayPrice),  driverAllowance: n(pricing.s2_driverAllowance),  hillsCharges: n(pricing.s2_hillsCharges),  tollParking: n(pricing.s2_tollParking),  sightseeing: n(pricing.s2_sightseeing)  },
      s2b: { perKm: n(pricing.s2b_perKm), perDayPrice: n(pricing.s2b_perDayPrice), driverAllowance: n(pricing.s2b_driverAllowance), hillsCharges: n(pricing.s2b_hillsCharges), tollParking: n(pricing.s2b_tollParking), sightseeing: n(pricing.s2b_sightseeing) },
      s3:  { perKm: n(pricing.s3_perKm),  perDayPrice: n(pricing.s3_perDayPrice),  driverAllowance: n(pricing.s3_driverAllowance),  hillsCharges: n(pricing.s3_hillsCharges),  tollParking: n(pricing.s3_tollParking),  sightseeing: n(pricing.s3_sightseeing)  },
      s3b: { perKm: n(pricing.s3b_perKm), perDayPrice: n(pricing.s3b_perDayPrice), driverAllowance: n(pricing.s3b_driverAllowance), hillsCharges: n(pricing.s3b_hillsCharges), tollParking: n(pricing.s3b_tollParking), sightseeing: n(pricing.s3b_sightseeing) },
      s4:  { perDayRent: n(pricing.s4_perDayRent),  perKmRate: n(pricing.s4_perKmRate),  driverAllowance: n(pricing.s4_driverAllowance),  hillsCharges: n(pricing.s4_hillsCharges),  tollParking: n(pricing.s4_tollParking)  },
      s4b: { perDayRent: n(pricing.s4b_perDayRent), perKmRate: n(pricing.s4b_perKmRate), driverAllowance: n(pricing.s4b_driverAllowance), hillsCharges: n(pricing.s4b_hillsCharges), tollParking: n(pricing.s4b_tollParking) },
      s5:  { perDayRent: n(pricing.s5_perDayRent),  perKmRate: n(pricing.s5_perKmRate),  driverCharges: n(pricing.s5_driverCharges),  hillsCharges: n(pricing.s5_hillsCharges),  tollParking: n(pricing.s5_tollParking)  },
      s5b: { perDayRent: n(pricing.s5b_perDayRent), perKmRate: n(pricing.s5b_perKmRate), driverCharges: n(pricing.s5b_driverCharges), hillsCharges: n(pricing.s5b_hillsCharges), tollParking: n(pricing.s5b_tollParking) },
      s6:  { kmRange: n(pricing.s6_kmRange),  minFare: n(pricing.s6_minFare),  additionalKmRange: n(pricing.s6_additionalKmRange)  },
      s6b: { kmRange: n(pricing.s6b_kmRange), minFare: n(pricing.s6b_minFare), additionalKmRange: n(pricing.s6b_additionalKmRange) },
      s7: packages.filter(p => p.from || p.to).map(p => ({ from: p.from || undefined, to: p.to || undefined, day1: n(p.day1), day2: n(p.day2), day3: n(p.day3), tollParking: n(p.tollParking) })),
    };
    setSaving(true);
    try {
      const res = await fetch(GQL_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ query: UPDATE_VEHICLE, variables: { id: selectedVehicle.id, input: { pricing: pricingInput } } }),
      });
      const json = await res.json();
      if (json.errors?.length) throw new Error(json.errors[0].message);
      setSaved(true);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to save fare details.");
    } finally {
      setSaving(false);
    }
  }

  const km = minKm || "0";
  const FARE_STEPS = [
    { label: "Regular Fare", sub: "AC & Non-AC" },
    { label: "Local",        sub: "AC & Non-AC" },
    { label: "Package",      sub: null },
  ];
  const cur = FARE_STEPS[step - 1];
  const total = FARE_STEPS.length;

  if (saved) {
    return createPortal(
      <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm text-center px-8 py-10">
          <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: "linear-gradient(135deg,#22c55e,#16a34a)" }}>
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-lg font-extrabold text-gray-900">Fare Details Saved!</p>
          <p className="text-sm text-gray-400 mt-1 mb-6">{selectedVehicle?.name}</p>
          <button onClick={onClose} className="w-full py-3 rounded-xl text-sm font-extrabold text-white" style={{ background: "linear-gradient(135deg,#1d4ed8,#3b82f6)" }}>
            Done
          </button>
        </div>
      </div>,
      document.body
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-2 sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white w-full max-w-6xl rounded-2xl shadow-2xl max-h-[98dvh] flex flex-col overflow-y-auto">

        {/* Header */}
        <div className="shrink-0 px-6 pt-6 pb-5 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#f97316,#fb923c)" }}>
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 11h.01M12 11h.01M15 11h.01M4 19h16a2 2 0 002-2V7a2 2 0 00-2-2H4a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <h2 className="font-extrabold text-black text-2xl">Fare Details</h2>
              {vehicle && <p className="text-base text-gray-500 mt-0.5">{vehicle.name}</p>}
            </div>

            {/* Operator minimum KM — shown only after a vehicle is selected */}
            {selectedVehicle && <div className="flex flex-col">
              <div className="flex items-center gap-1.5 mb-1">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Min. KM</label>
                {kmSaved && <span className="text-xs font-semibold text-green-500">Saved ✓</span>}
              </div>
              <input
                type="number" min={0} step="1"
                value={minKm}
                onChange={e => { setMinKm(e.target.value); setKmSaved(false); }}
                onBlur={autoSaveKm}
                placeholder="e.g. 100"
                className="w-36 px-3 py-2 rounded-xl text-base font-medium text-black border border-gray-200 bg-gray-50 outline-none focus:border-orange-400 focus:bg-white focus:ring-2 focus:ring-orange-100 transition-all"
              />
            </div>}

            {!vehicle && (
              <select value={selectedId}
                onChange={e => { setSelectedId(e.target.value); setStep(1); setPricingState(EMPTY_PRICING); }}
                className="ml-auto flex-1 max-w-xs px-4 py-2.5 rounded-xl text-base font-medium text-gray-800 border border-gray-200 bg-gray-50 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 transition-all">
                <option value="">— Choose a vehicle —</option>
                {fleet.map(v => <option key={v.id} value={v.id}>{v.name} · {v.plate}</option>)}
              </select>
            )}
            <button onClick={onClose} className={`${vehicle ? "ml-auto" : ""} w-8 h-8 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors shrink-0`}>
              <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="px-6 py-5 space-y-5">

          {selectedVehicle && (
            <>
              {/* Step indicator */}
              <div className="rounded-2xl border border-gray-100 bg-gray-50 px-4 pt-4 pb-3">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-sm font-black uppercase tracking-widest text-gray-500">Step {step} of {total}</p>
                    <p className="text-xl font-bold text-black mt-0.5">
                      {cur.label}
                      {cur.sub && <span className="ml-1.5 text-base font-semibold text-gray-500">({cur.sub})</span>}
                    </p>
                  </div>
                  <span className="text-base font-bold text-orange-600 bg-orange-50 px-3 py-1 rounded-full">{step}/{total}</span>
                </div>
                <div className="flex gap-1">
                  {FARE_STEPS.map((_, i) => (
                    <div key={i} className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${i < step ? "bg-orange-400" : "bg-gray-200"}`} />
                  ))}
                </div>
              </div>

              {/* Pricing fields */}
              <div className="space-y-4">

                {/* ── Screen 1: Regular Fare — AC card + Non-AC card, each with own toggle ── */}
                {step === 1 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* AC card */}
                    <div className="rounded-xl border border-orange-200 bg-orange-50/40 p-4">
                      <div className="flex items-center justify-between mb-4">
                        <p className="text-sm font-extrabold text-orange-500 uppercase tracking-widest">AC</p>
                        <div className="flex rounded-2xl p-1" style={{ background: "#fff7ed", border: "1.5px solid #fed7aa" }}>
                          <button onClick={() => setAcTab("lt")} className="px-4 py-1.5 rounded-xl text-sm font-bold transition-all"
                            style={acTab === "lt" ? { background: "linear-gradient(135deg,#f97316,#fb923c)", color: "#fff", boxShadow: "0 2px 6px rgba(249,115,22,0.3)" } : { color: "#fb923c" }}>
                            {"< "}{km} km
                          </button>
                          <button onClick={() => setAcTab("gt")} className="px-4 py-1.5 rounded-xl text-sm font-bold transition-all"
                            style={acTab === "gt" ? { background: "linear-gradient(135deg,#f97316,#fb923c)", color: "#fff", boxShadow: "0 2px 6px rgba(249,115,22,0.3)" } : { color: "#fb923c" }}>
                            {">"} {km} km
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        {(acTab === "lt"
                          ? [["Per KM (₹)", "s2_perKm"], ["Per Day Price (₹)", "s2_perDayPrice"], ["Driver Allowance (₹)", "s2_driverAllowance"], ["Hills Charges (₹)", "s2_hillsCharges"], ["Toll & Parking (₹)", "s2_tollParking"], ["Sightseeing (₹)", "s2_sightseeing"]]
                          : [["Per KM (₹)", "s2b_perKm"], ["Driver Allowance (₹)", "s2b_driverAllowance"], ["Hills Charges (₹)", "s2b_hillsCharges"], ["Toll & Parking (₹)", "s2b_tollParking"], ["Sightseeing (₹)", "s2b_sightseeing"]]
                        ).map(([lbl, key]) => (
                          <div key={key}>
                            <label className="flex items-center gap-1.5 text-sm font-bold text-gray-600 mb-1.5">
                              {lbl}
                              {lbl === "Sightseeing (₹)" && (
                                <span className="text-[0.6rem] font-bold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200">Important</span>
                              )}
                            </label>
                            <input type="number" min={0} step="0.01" value={pricing[key as keyof PricingState]} onChange={e => setP(key as keyof PricingState, e.target.value)} placeholder="0" className={field()} />
                          </div>
                        ))}
                      </div>
                    </div>
                    {/* Non-AC card */}
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                      <div className="flex items-center justify-between mb-4">
                        <p className="text-sm font-extrabold text-gray-500 uppercase tracking-widest">Non-AC</p>
                        <div className="flex rounded-2xl p-1" style={{ background: "#f9fafb", border: "1.5px solid #e5e7eb" }}>
                          <button onClick={() => setNonAcTab("lt")} className="px-4 py-1.5 rounded-xl text-sm font-bold transition-all"
                            style={nonAcTab === "lt" ? { background: "linear-gradient(135deg,#6b7280,#9ca3af)", color: "#fff", boxShadow: "0 2px 6px rgba(107,114,128,0.3)" } : { color: "#9ca3af" }}>
                            {"< "}{km} km
                          </button>
                          <button onClick={() => setNonAcTab("gt")} className="px-4 py-1.5 rounded-xl text-sm font-bold transition-all"
                            style={nonAcTab === "gt" ? { background: "linear-gradient(135deg,#6b7280,#9ca3af)", color: "#fff", boxShadow: "0 2px 6px rgba(107,114,128,0.3)" } : { color: "#9ca3af" }}>
                            {">"} {km} km
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        {(nonAcTab === "lt"
                          ? [["Per KM (₹)", "s3b_perKm"], ["Per Day Price (₹)", "s3b_perDayPrice"], ["Driver Allowance (₹)", "s3b_driverAllowance"], ["Hills Charges (₹)", "s3b_hillsCharges"], ["Toll & Parking (₹)", "s3b_tollParking"], ["Sightseeing (₹)", "s3b_sightseeing"]]
                          : [["Per KM (₹)", "s3_perKm"],  ["Driver Allowance (₹)", "s3_driverAllowance"],  ["Hills Charges (₹)", "s3_hillsCharges"],  ["Toll & Parking (₹)", "s3_tollParking"], ["Sightseeing (₹)", "s3_sightseeing"]]
                        ).map(([lbl, key]) => (
                          <div key={key}>
                            <label className="flex items-center gap-1.5 text-sm font-bold text-gray-600 mb-1.5">
                              {lbl}
                              {lbl === "Sightseeing (₹)" && (
                                <span className="text-[0.6rem] font-bold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200">Important</span>
                              )}
                            </label>
                            <input type="number" min={0} step="0.01" value={pricing[key as keyof PricingState]} onChange={e => setP(key as keyof PricingState, e.target.value)} placeholder="0" className={field()} />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Screen 2: Local — AC + Non-AC ── */}
                {step === 2 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4">
                      <div className="flex items-center justify-between mb-4">
                        <p className="text-xs font-extrabold text-blue-500 uppercase tracking-widest">Local · AC</p>
                        <span className="px-3 py-1 rounded-full text-xs font-bold" style={{ background: "linear-gradient(135deg,#3b82f6,#6366f1)", color: "#fff" }}>AC</span>
                      </div>
                      <div className="grid grid-cols-1 gap-3">
                        {([["KM Range", "s6_kmRange"], ["Minimum Fare (₹)", "s6_minFare"], ["Additional KM Range", "s6_additionalKmRange"]] as const).map(([lbl, key]) => (
                          <div key={key}>
                            <label className="block text-sm font-bold text-gray-600 mb-1.5">{lbl}</label>
                            <input type="number" min={0} step="0.01" value={pricing[key]} onChange={e => setP(key, e.target.value)} placeholder="0" className={field()} />
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                      <div className="flex items-center justify-between mb-4">
                        <p className="text-xs font-extrabold text-gray-500 uppercase tracking-widest">Local · Non-AC</p>
                        <span className="px-3 py-1 rounded-full text-xs font-bold bg-gray-200 text-gray-600">Non-AC</span>
                      </div>
                      <div className="grid grid-cols-1 gap-3">
                        {([["KM Range", "s6b_kmRange"], ["Minimum Fare (₹)", "s6b_minFare"], ["Additional KM Range", "s6b_additionalKmRange"]] as const).map(([lbl, key]) => (
                          <div key={key}>
                            <label className="block text-sm font-bold text-gray-600 mb-1.5">{lbl}</label>
                            <input type="number" min={0} step="0.01" value={pricing[key]} onChange={e => setP(key, e.target.value)} placeholder="0" className={field()} />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Screen 3: Package (dynamic) ── */}
                {step === 3 && (
                  <div className="space-y-4">
                    {packages.map((pkg, i) => (
                      <div key={i} className="rounded-xl border border-purple-200 bg-purple-50/40 p-4">
                        <div className="flex items-center justify-between mb-4">
                          <p className="text-xs font-extrabold text-purple-500 uppercase tracking-widest">
                            Package {packages.length > 1 ? `#${i + 1}` : ""}
                          </p>
                          {packages.length > 1 && (
                            <button onClick={() => removePkg(i)}
                              className="w-7 h-7 rounded-lg bg-red-50 hover:bg-red-100 flex items-center justify-center transition-colors"
                              title="Remove">
                              <svg className="w-3.5 h-3.5 text-red-400" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          )}
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                          <div>
                            <label className="block text-sm font-bold text-gray-600 mb-1.5">From</label>
                            <input type="text" value={pkg.from} onChange={e => setPkg(i, "from", e.target.value)} placeholder="City A" className={field()} />
                          </div>
                          <div>
                            <label className="block text-sm font-bold text-gray-600 mb-1.5">To</label>
                            <input type="text" value={pkg.to} onChange={e => setPkg(i, "to", e.target.value)} placeholder="City B" className={field()} />
                          </div>
                          {([ ["1 Day (₹)", "day1"], ["2 Days (₹)", "day2"], ["3 Days (₹)", "day3"], ["Toll & Parking (₹)", "tollParking"] ] as [string, keyof Pkg][]).map(([lbl, f]) => (
                            <div key={f}>
                              <label className="block text-sm font-bold text-gray-600 mb-1.5">{lbl}</label>
                              <input type="number" min={0} step="0.01" value={pkg[f]} onChange={e => setPkg(i, f, e.target.value)} placeholder="0" className={field()} />
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}

                    <button onClick={addPkg}
                      className="flex items-center gap-2 px-5 py-3 rounded-xl border-2 border-dashed border-purple-300 text-sm font-bold text-purple-500 hover:bg-purple-50 transition-all w-full justify-center">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                      </svg>
                      Add Package
                    </button>
                  </div>
                )}
              </div>

              {/* Navigation */}
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={onClose}
                  className="px-5 py-3.5 rounded-xl border-2 border-gray-200 text-base font-bold text-gray-600 hover:bg-gray-50 transition-colors">
                  Skip
                </button>
                <button type="button" disabled={step === 1} onClick={() => setStep(s => s - 1)}
                  className="px-5 py-3.5 rounded-xl border-2 border-gray-200 text-base font-bold text-black hover:bg-gray-50 disabled:opacity-30 transition-all">
                  ← Back
                </button>
                <button type="button" onClick={() => setStep(s => s + 1)}
                  className={`flex-1 py-3.5 rounded-xl text-base font-extrabold text-white transition-all hover:opacity-90 ${step >= total ? "hidden" : ""}`}
                  style={{ background: "linear-gradient(135deg,#f97316,#fb923c)" }}>
                  Next →
                </button>
                <button type="button" disabled={saving} onClick={handleSave}
                  className={`flex-1 py-3.5 rounded-xl text-base font-extrabold text-white transition-all hover:opacity-90 hover:shadow-lg disabled:opacity-60 ${step < total ? "hidden" : ""}`}
                  style={{ background: "linear-gradient(135deg,#f97316,#fb923c)" }}>
                  {saving ? "Saving…" : "Save Fare Details"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Doc Button + Popup ────────────────────────────────────────────────────────
function DocTile({ label, date, doc }: { label: string; date?: string; doc?: string }) {
  const [open, setOpen] = useState(false);

  const status = useMemo(() => {
    if (!date && !doc) return { label: "Not added", dot: "#9ca3af", btnBg: "bg-gray-100", btnBorder: "border-gray-200", btnText: "text-gray-400", days: null };
    if (!date)         return { label: "No date",   dot: "#60a5fa", btnBg: "bg-blue-50",  btnBorder: "border-blue-200", btnText: "text-blue-500", days: null };
    const diff = Math.ceil((new Date(date).getTime() - new Date().getTime()) / 86400000);
    if (diff < 0)   return { label: "Expired",       dot: "#ef4444", btnBg: "bg-red-50",    btnBorder: "border-red-200",    btnText: "text-red-500",   days: diff };
    if (diff <= 30) return { label: `${diff}d left`, dot: "#f59e0b", btnBg: "bg-amber-50",  btnBorder: "border-amber-200",  btnText: "text-amber-600", days: diff };
    return              { label: "Valid",             dot: "#22c55e", btnBg: "bg-green-50",  btnBorder: "border-green-200",  btnText: "text-green-600", days: diff };
  }, [date, doc]);

  return (
    <>
      {/* ── Button ── */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg border text-[10px] font-bold transition-all hover:shadow-sm active:scale-95 ${status.btnBg} ${status.btnBorder} ${status.btnText}`}
      >
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: status.dot }} />
        {label}
      </button>

      {/* ── Popup (portalled to body so it escapes overflow:hidden) ── */}
      {open && createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-black/50 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center">
                  <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div>
                  <p className="font-extrabold text-gray-900 text-base">{label}</p>
                  <p className="text-xs text-gray-400 mt-0.5">Document Details</p>
                </div>
              </div>
              <button onClick={() => setOpen(false)} className="w-8 h-8 rounded-xl bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors">
                <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 space-y-5">

              {/* Status + Date row — hidden for RC Book (date === undefined) */}
              {date !== undefined && (
                <div className="grid grid-cols-2 gap-4">
                  <div className={`rounded-2xl border p-4 ${status.btnBg} ${status.btnBorder}`}>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Status</p>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: status.dot }} />
                      <span className={`text-sm font-extrabold ${status.btnText}`}>{status.label}</span>
                    </div>
                    {status.days !== null && (
                      <p className={`text-xs font-semibold ${status.btnText} opacity-80`}>
                        {status.days < 0
                          ? `${Math.abs(status.days)} days ago`
                          : `${status.days} days remaining`}
                      </p>
                    )}
                  </div>
                  <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Expiry Date</p>
                    <p className="text-sm font-extrabold text-gray-800">
                      {date
                        ? new Date(date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
                        : "—"}
                    </p>
                  </div>
                </div>
              )}

              {/* Document image */}
              {doc ? (
                <div className="rounded-2xl overflow-hidden border border-gray-100 shadow-sm">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={doc} alt={label} className="w-full object-cover max-h-64" />
                </div>
              ) : (
                <div className="h-32 rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50 flex flex-col items-center justify-center gap-2">
                  <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <p className="text-sm text-gray-400 font-medium">No document uploaded</p>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// ── Vehicle Card ──────────────────────────────────────────────────────────────
function VehicleCard({ vehicle, onEdit, onDelete }: { vehicle: Vehicle; onEdit: () => void; onDelete: () => void }) {
  const isDiesel  = vehicle.fuel === "Diesel";
  const images    = vehicle.images ?? [];
  const hasImages = images.length > 0;

  const [idx, setIdx] = useState(0);
  const [showDetail, setShowDetail] = useState(false);

  useEffect(() => {
    if (images.length <= 1) return;
    const timer = setInterval(() => setIdx(i => (i + 1) % images.length), 3000);
    return () => clearInterval(timer);
  }, [images.length]);

  return (
    <div className="bg-white rounded-2xl overflow-hidden shadow-[0_2px_12px_rgba(0,0,0,0.07)] hover:shadow-[0_6px_24px_rgba(0,0,0,0.12)] transition-all duration-300 hover:-translate-y-0.5 border border-gray-100 flex flex-col">

      {/* Card header — carousel or gradient */}
      <div
        className="relative h-44 overflow-hidden"
        style={!hasImages ? { background: `linear-gradient(135deg, ${vehicle.color}f0, ${vehicle.color}a0)` } : {}}
      >
        {/* ── Carousel slides ── */}
        {hasImages && images.map((img, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={i}
            src={img}
            alt={`${vehicle.name} photo ${i + 1}`}
            className="absolute inset-0 w-full h-full object-cover transition-all duration-700 ease-in-out"
            style={{ opacity: i === idx ? 1 : 0, transform: `scale(${i === idx ? 1 : 1.04})` }}
          />
        ))}

        {/* Gradient overlay — always shown for text legibility */}
        <div
          className="absolute inset-0"
          style={{ background: `linear-gradient(to top, ${vehicle.color}dd 0%, ${vehicle.color}22 50%, transparent 100%)` }}
        />

        {/* SVG wave */}
        <svg className="absolute bottom-0 left-0 w-full z-10" viewBox="0 0 400 40" preserveAspectRatio="none">
          <path d="M0,20 C100,40 300,0 400,20 L400,40 L0,40 Z" fill="white" />
        </svg>

        {/* Decorative circles — no-image only */}
        {!hasImages && (
          <>
            <div className="absolute -top-4 -right-4 w-24 h-24 rounded-full bg-white/10" />
            <div className="absolute top-6 right-8 w-10 h-10 rounded-full bg-white/10" />
          </>
        )}

        {/* Vehicle icon */}
        <div className="absolute top-4 left-4 z-20 w-10 h-10 rounded-xl bg-white/25 backdrop-blur-sm flex items-center justify-center">
          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 6H5a2 2 0 00-2 2v6a2 2 0 002 2h1m10-10h3a2 2 0 012 2v6a2 2 0 01-2 2h-1M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M8 6h8m-8 8h8" />
          </svg>
        </div>

        {/* Status + Edit */}
        <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold backdrop-blur-sm ${vehicle.available ? "bg-green-500/20 text-white border border-green-400/50" : "bg-red-500/20 text-white border border-red-400/50"}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${vehicle.available ? "bg-green-300" : "bg-red-300"}`} />
            {vehicle.available ? "Available" : "On Trip"}
          </span>
          <button onClick={onEdit} className="w-7 h-7 rounded-full bg-white/25 hover:bg-white/40 backdrop-blur-sm flex items-center justify-center transition-all" title="Edit vehicle">
            <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button onClick={onDelete} className="w-7 h-7 rounded-full bg-red-500/30 hover:bg-red-500/60 backdrop-blur-sm flex items-center justify-center transition-all" title="Delete vehicle">
            <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>

        {/* Dot indicators */}
        {images.length > 1 && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5">
            {images.map((_, i) => (
              <button
                key={i}
                onClick={() => setIdx(i)}
                className="rounded-full transition-all duration-300"
                style={{
                  width:           i === idx ? 16 : 6,
                  height:          6,
                  backgroundColor: i === idx ? "#fff" : "rgba(255,255,255,0.45)",
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Card body */}
      <div className="px-4 pt-2 pb-4 flex-1 flex flex-col gap-3">

        {/* Name + plate */}
        <div>
          <h3 className="font-extrabold text-gray-900 text-[15px] leading-snug truncate">{vehicle.name}</h3>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] font-mono font-semibold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-md tracking-wide">{vehicle.plate}</span>
            <span className="text-[10px] text-gray-300">·</span>
            <span className="text-[10px] text-gray-400 font-semibold">{vehicle.model}</span>
          </div>
        </div>

        {/* Spec chips */}
        <div className="flex flex-wrap gap-1.5">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold text-sky-700 bg-sky-50 border border-sky-100">
            <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0" /></svg>
            {vehicle.seater} Seats
          </span>
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold ${isDiesel ? "text-amber-700 bg-amber-50 border border-amber-100" : "text-emerald-700 bg-emerald-50 border border-emerald-100"}`}>
            <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d={isDiesel ? DIESEL_PATH : PETROL_PATH} /></svg>
            {vehicle.fuel}
          </span>
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold ${vehicle.ac ? "text-violet-700 bg-violet-50 border border-violet-100" : "text-gray-400 bg-gray-50 border border-gray-100"}`}>
            <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17H3a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2h-2" /></svg>
            {vehicle.ac ? "AC" : "Non-AC"}
          </span>
        </div>

        {/* Specialist */}
        <div className="flex items-center gap-2.5 bg-gray-50 rounded-xl px-3 py-2 border border-gray-100">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${vehicle.color}18` }}>
            <svg className="w-3.5 h-3.5" fill="none" stroke={vehicle.color} strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[8px] font-bold uppercase tracking-widest text-gray-400">Owner</p>
            <p className="text-xs font-extrabold text-gray-700 truncate">{vehicle.specialist}</p>
          </div>
          <span className="text-[9px] font-mono text-gray-300 bg-white px-1.5 py-0.5 rounded border border-gray-100 shrink-0">{vehicle.id}</span>
        </div>

        {/* Document buttons */}
        <div>
          <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-1.5">Documents</p>
          <div className="flex gap-2">
            <DocTile label="FC" date={vehicle.fcEndDate} doc={vehicle.fcDocument} />
            <DocTile label="Insurance" date={vehicle.insuranceEndDate} doc={vehicle.insuranceDocument} />
            <DocTile label="RC Book" doc={vehicle.rcBook} />
          </div>
        </div>

      </div>

      {/* Details popup */}
      {showDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setShowDetail(false)}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm max-h-[90dvh] overflow-y-auto" onClick={e => e.stopPropagation()}>

            {/* Popup header image */}
            <div className="relative h-40 rounded-t-3xl overflow-hidden"
              style={!hasImages ? { background: `linear-gradient(135deg,${vehicle.color}ee,${vehicle.color}99)` } : {}}>
              {hasImages && images.map((img, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={img} alt="" className="absolute inset-0 w-full h-full object-cover"
                  style={{ opacity: i === idx ? 1 : 0 }} />
              ))}
              <div className="absolute inset-0" style={{ background: `linear-gradient(to top,${vehicle.color}cc,transparent 60%)` }} />
              <div className="absolute bottom-3 left-4 right-12">
                <p className="text-white font-black text-lg leading-tight drop-shadow">{vehicle.name}</p>
                <p className="text-white/70 text-xs font-mono mt-0.5">{vehicle.plate} · {vehicle.model}</p>
              </div>
              <button onClick={() => setShowDetail(false)}
                className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/30 hover:bg-black/50 flex items-center justify-center transition-colors">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-5 space-y-4">

              {/* Specs */}
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-2">Specifications</p>
                <div className={`grid gap-2 ${vehicle.perKmPrice !== undefined ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"}`}>
                  {[
                    { label: "Seats", val: `${vehicle.seater}`, color: "text-sky-700", bg: "bg-sky-50", border: "border-sky-100" },
                    { label: "Fuel",  val: vehicle.fuel, color: isDiesel ? "text-amber-700" : "text-emerald-700", bg: isDiesel ? "bg-amber-50" : "bg-emerald-50", border: isDiesel ? "border-amber-100" : "border-emerald-100" },
                    { label: "AC",    val: vehicle.ac ? "Yes" : "No", color: vehicle.ac ? "text-violet-700" : "text-gray-500", bg: vehicle.ac ? "bg-violet-50" : "bg-gray-50", border: vehicle.ac ? "border-violet-100" : "border-gray-100" },
                    ...(vehicle.perKmPrice !== undefined ? [{ label: "Per KM", val: `₹${vehicle.perKmPrice}`, color: "text-rose-700", bg: "bg-rose-50", border: "border-rose-100" }] : []),
                  ].map(s => (
                    <div key={s.label} className={`rounded-xl border ${s.bg} ${s.border} p-2.5 text-center`}>
                      <p className={`text-sm font-black ${s.color}`}>{s.val}</p>
                      <p className="text-[9px] text-gray-400 font-semibold mt-0.5">{s.label}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Specialist */}
              <div className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2.5 border border-gray-100">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${vehicle.color}18` }}>
                  <svg className="w-4 h-4" fill="none" stroke={vehicle.color} strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                </div>
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400">Owner&apos;s Name</p>
                  <p className="text-sm font-extrabold text-gray-800">{vehicle.specialist}</p>
                </div>
                <span className="ml-auto text-[10px] font-mono text-gray-300 bg-white px-1.5 py-0.5 rounded border border-gray-100">{vehicle.id}</span>
              </div>

              {/* Documents */}
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-2">Documents</p>
                <div className="flex gap-2">
                  <DocTile label="FC" date={vehicle.fcEndDate} doc={vehicle.fcDocument} />
                  <DocTile label="Insurance" date={vehicle.insuranceEndDate} doc={vehicle.insuranceDocument} />
                  <DocTile label="RC Book" doc={vehicle.rcBook} />
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex gap-2 pt-1">
                <button onClick={() => { setShowDetail(false); onEdit(); }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl border-2 border-blue-200 text-blue-600 text-xs font-bold hover:bg-blue-50 transition-colors">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                  Edit
                </button>
                <button onClick={() => { setShowDetail(false); onDelete(); }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl border-2 border-red-200 text-red-500 text-xs font-bold hover:bg-red-50 transition-colors">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Home Page ─────────────────────────────────────────────────────────────────
export default function HomePage() {
  const router = useRouter();
  const [user]         = useState<AuthUser | null>(() => getUser());
  const [activeMenu, setActiveMenu] = useState<"fleet" | "accommodation">("fleet");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [travelsName,   setTravelsName]   = useState("");
  const [operatorId,  setOperatorCode]  = useState("");
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [search,   setSearch]   = useState("");
  const [filter,   setFilter]   = useState<FilterKey>("All");
  const [mounted,  setMounted]  = useState(false);
  const [modal, setModal]         = useState<{ mode: "add" | "edit"; vehicle?: Vehicle } | null>(null);
  const [showPerKm, setShowPerKm] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [successVehicle, setSuccessVehicle] = useState<Vehicle | null>(null);
  const [fareVehicle, setFareVehicle] = useState<Vehicle | null | "picker">(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showMenuPicker,   setShowMenuPicker]   = useState(false);
  const accAutoOpenAddRef = useRef(false);

  async function openModal(opts: { mode: "add" | "edit"; vehicle?: Vehicle }) {
    if (opts.mode === "add" && vehicles.length >= 3) { setShowUpgrade(true); return; }
    try {
      const res  = await fetch(GQL_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: SHOW_PER_KM_QUERY }) });
      const json = await res.json();
      setShowPerKm(json?.data?.setting === "true");
    } catch { setShowPerKm(false); }
    setModal(opts);
  }
  useEffect(() => {
    if (!user) { router.replace("/login"); return; }
    fetch(GQL_URL, { method: "POST", headers: { "Content-Type": "application/json", ...getAuthHeaders() }, body: JSON.stringify({ query: ME_QUERY }) })
      .then(r => r.json())
      .then(j => {
        if (j?.data?.me?.travelsName)   setTravelsName(j.data.me.travelsName);
        if (j?.data?.me?.operatorId)  setOperatorCode(j.data.me.operatorId);
      })
      .catch(() => {});
    fetch(GQL_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: SHOW_PER_KM_QUERY }) })
      .then(r => r.json())
      .then(j => setShowPerKm(j?.data?.setting === "true"))
      .catch(() => {});
    fetchFleetFromDB()
      .then(list => backfillPriority(list))
      .then(list => startTransition(() => {
        setVehicles(list);
        setMounted(true);
        if (!sessionStorage.getItem("menuPickerShown")) {
          setShowMenuPicker(true);
          sessionStorage.setItem("menuPickerShown", "1");
        }
      }))
      .catch(() => startTransition(() => setMounted(true)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleLogout() { setShowLogoutConfirm(true); }
  function confirmLogout() { logout(); sessionStorage.removeItem("menuPickerShown"); router.push("/login"); }

  function handleDelete(id: string) {
    setDeleteId(id);
  }

  async function confirmDelete() {
    if (!deleteId) return;
    const id = deleteId;
    setVehicles(prev => prev.filter(v => v.id !== id));
    setDeleteId(null);
    await fetch(GQL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({ query: `mutation { softDeleteVehicle(id: "${id}") }` }),
    }).catch(() => {});
  }

  function handleSave(v: Vehicle) {
    const isAdd = modal?.mode === "add";
    setVehicles(prev =>
      isAdd ? [...prev, v] : prev.map(x => x.id === v.id ? v : x)
    );
    setModal(null);
    if (isAdd) setSuccessVehicle(v);
  }

  const nextId = `V${String(vehicles.length + 1).padStart(3, "0")}`;

  const counts: Record<FilterKey, number> = {
    All:       vehicles.length,
    Available: vehicles.filter(v => v.available).length,
    Diesel:    vehicles.filter(v => v.fuel === "Diesel").length,
    Petrol:    vehicles.filter(v => v.fuel === "Petrol").length,
  };

  const filtered = vehicles.filter(v => {
    const q = search.toLowerCase();
    const match = v.name.toLowerCase().includes(q) || v.plate.toLowerCase().includes(q) || v.specialist.toLowerCase().includes(q);
    if (!match) return false;
    if (filter === "Available") return v.available;
    if (filter === "Diesel")    return v.fuel === "Diesel";
    if (filter === "Petrol")    return v.fuel === "Petrol";
    return true;
  });

  if (!mounted || !user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4" style={{ background: "linear-gradient(135deg,#ff6b2b,#f97316,#fbbf24)" }}>
        <div className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
          <svg className="w-8 h-8 text-white animate-pulse" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 6H5a2 2 0 00-2 2v6a2 2 0 002 2h1m10-10h3a2 2 0 012 2v6a2 2 0 01-2 2h-1M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M8 6h8m-8 8h8" />
          </svg>
        </div>
        <p className="text-white/80 text-sm font-semibold">Loading your fleet…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f7fa]">


      <style>{`
        @keyframes nav-slide-in {
          from { opacity:0; transform:translateX(-8px); }
          to   { opacity:1; transform:translateX(0); }
        }
        @keyframes nav-pop {
          0%   { transform:scale(0.8); opacity:0; }
          60%  { transform:scale(1.15); }
          100% { transform:scale(1);   opacity:1; }
        }
        @keyframes shimmer-bg {
          0%,100% { background-position:0% 50%; }
          50%      { background-position:100% 50%; }
        }
        @keyframes dot-ping {
          0%    { transform:scale(1);   opacity:1; }
          75%,100% { transform:scale(2); opacity:0; }
        }
        .nav-item-enter { animation: nav-slide-in 0.25s cubic-bezier(.22,1,.36,1) both; }
        .nav-icon-pop   { animation: nav-pop 0.3s cubic-bezier(.34,1.56,.64,1) both; }
        .nav-shimmer    { background-size:200% 200%; animation:shimmer-bg 3s ease infinite; }
        .dot-ping-ring  { animation:dot-ping 1.2s cubic-bezier(0,0,.2,1) infinite; }
      `}</style>

      <header className="bg-white/80 backdrop-blur-md sticky top-0 z-20 border-b border-gray-100/80" style={{boxShadow:"0 1px 20px rgba(0,0,0,0.06)"}}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between h-16">
          {/* Brand + Nav */}
          <div className="flex items-center gap-1 nav-item-enter">
            <button onClick={() => setActiveMenu("fleet")} className="flex items-center gap-2.5 pr-4 hover:opacity-80 transition-all duration-200 active:scale-95">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/payanam.jpeg" alt="Payanam" className="h-11 w-auto max-w-[140px] object-contain" />
              <span className="text-[10px] font-bold text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded-md border border-blue-100 hidden sm:inline">Operator</span>
            </button>

            {/* Divider */}
            <div className="w-px h-5 bg-gray-200 mx-2" />

            {/* Accommodation nav item */}
            <button
              onClick={() => setActiveMenu("accommodation")}
              className="relative group flex items-center gap-2 px-4 py-2 rounded-xl active:scale-95"
              style={{
                transition: "all 0.3s cubic-bezier(.22,1,.36,1)",
                ...(activeMenu === "accommodation" ? {
                  background: "linear-gradient(135deg,#7c3aed,#6d28d9,#4f46e5)",
                  boxShadow: "0 4px 20px rgba(124,58,237,0.35), 0 0 0 1px rgba(124,58,237,0.2)",
                } : {})
              }}
            >
              {/* Hover background */}
              <span
                className="absolute inset-0 rounded-xl transition-opacity duration-300"
                style={{
                  background: "linear-gradient(135deg,#f5f3ff,#ede9fe)",
                  opacity: activeMenu === "accommodation" ? 0 : undefined,
                }}
              />
              <style>{`.group:not([data-active]):hover > .nav-hover-bg { opacity:1; }`}</style>

              {/* Animated ring when active */}
              {activeMenu === "accommodation" && (
                <span className="absolute inset-0 rounded-xl opacity-30"
                  style={{background:"linear-gradient(135deg,#a78bfa,#818cf8,#a78bfa)",backgroundSize:"200% 200%",animation:"shimmer-bg 2s ease infinite"}}/>
              )}

              {/* Icon */}
              <span
                className={`relative flex items-center justify-center shrink-0 rounded-lg transition-all duration-300 ${activeMenu === "accommodation" ? "nav-icon-pop" : "group-hover:scale-110 group-hover:-rotate-3"}`}
                style={{
                  width: 26, height: 26,
                  background: activeMenu === "accommodation" ? "rgba(255,255,255,0.2)" : "#f3f4f6",
                  boxShadow: activeMenu === "accommodation" ? "inset 0 1px 1px rgba(255,255,255,0.3)" : "none",
                  transition: "all 0.3s cubic-bezier(.34,1.56,.64,1)",
                }}>
                <svg className="w-3.5 h-3.5" fill="none"
                  stroke={activeMenu === "accommodation" ? "#fff" : "#9ca3af"}
                  strokeWidth={2} viewBox="0 0 24 24"
                  style={{transition:"stroke 0.2s ease"}}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
              </span>

              {/* Label */}
              <span
                className="relative text-sm font-semibold"
                style={{
                  color: activeMenu === "accommodation" ? "#fff" : "#6b7280",
                  transition: "color 0.2s ease, transform 0.2s ease",
                  transform: "translateX(0)",
                }}>
                Accommodation
              </span>

              {/* Active pulsing dot */}
              {activeMenu === "accommodation" && (
                <span className="relative flex h-2 w-2">
                  <span className="dot-ping-ring absolute inline-flex h-full w-full rounded-full bg-white/60" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-white/90" />
                </span>
              )}
            </button>
          </div>

          {/* User + Logout */}
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-2.5 bg-gray-50 border border-gray-200 rounded-full px-3 py-1.5">
              <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-black shrink-0" style={{ background: "linear-gradient(135deg,#1d4ed8,#3b82f6)" }}>
                {(travelsName || user.phone).slice(0, 1).toUpperCase()}
              </div>
              <div className="flex flex-col leading-tight">
                <span className="text-xs font-semibold text-gray-700">{travelsName || `+91 ${user.phone}`}</span>
                {operatorId && <span className="text-[10px] font-bold text-blue-500 tracking-wide">{operatorId}</span>}
              </div>
            </div>
            <button onClick={handleLogout} className="flex items-center gap-1.5 text-xs font-bold text-red-500 hover:text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 px-3 py-2 rounded-full transition-all">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>
      </header>


      {/* ── Sidebar drawer ── */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-[500] flex">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />

          {/* Drawer */}
          <div className="relative w-72 bg-white h-full shadow-2xl flex flex-col z-10">
            {/* Drawer header */}
            <div className="flex items-center justify-between px-5 py-5 border-b border-gray-100" style={{background:"linear-gradient(135deg,#0f172a,#1e3a8a)"}}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 6H5a2 2 0 00-2 2v6a2 2 0 002 2h1m10-10h3a2 2 0 012 2v6a2 2 0 01-2 2h-1M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M8 6h8m-8 8h8" />
                  </svg>
                </div>
                <div>
                  <p className="text-white font-black text-base tracking-tight">Payanam</p>
                  <p className="text-blue-300 text-xs font-semibold">Operator Portal</p>
                </div>
              </div>
              <button onClick={() => setSidebarOpen(false)} className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Menu items */}
            <nav className="flex-1 overflow-y-auto py-4 px-3">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-3 mb-2">Main</p>
              {([
                { key: "fleet",         label: "Fleet Management",      desc: "Vehicles & fare details",     icon: "M8 6H5a2 2 0 00-2 2v6a2 2 0 002 2h1m10-10h3a2 2 0 012 2v6a2 2 0 01-2 2h-1M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M8 6h8m-8 8h8",  color:"#1d4ed8" },
                { key: "accommodation", label: "Accommodation",         desc: "Hotels, villas & resorts",    icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6", color:"#7c3aed" },
              ] as const).map(({ key, label, desc, icon, color }) => {
                const active = activeMenu === key;
                return (
                  <button key={key} onClick={() => { setActiveMenu(key); setSidebarOpen(false); }}
                    className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl mb-1 transition-all text-left group ${active ? "shadow-sm" : "hover:bg-gray-50"}`}
                    style={active ? { background: `${color}12`, border: `1.5px solid ${color}30` } : {}}>
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-all"
                      style={{ background: active ? color : "#f3f4f6" }}>
                      <svg className="w-4 h-4" fill="none" stroke={active ? "#fff" : "#6b7280"} strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-bold ${active ? "text-gray-900" : "text-gray-700"}`}>{label}</p>
                      <p className="text-xs text-gray-400 font-medium truncate">{desc}</p>
                    </div>
                    {active && (
                      <div className="w-1.5 h-6 rounded-full shrink-0" style={{ background: color }} />
                    )}
                  </button>
                );
              })}
            </nav>

            {/* Drawer footer — user info */}
            <div className="px-4 py-4 border-t border-gray-100 bg-gray-50">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-black shrink-0" style={{ background: "linear-gradient(135deg,#1d4ed8,#4f46e5)" }}>
                  {(travelsName || user.phone).slice(0, 1).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-800 truncate">{travelsName || `+91 ${user.phone}`}</p>
                  {operatorId && <p className="text-xs font-bold text-blue-500">{operatorId}</p>}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeMenu === "accommodation" && (
        <AccommodationPage
          authHeaders={getAuthHeaders()}
          autoOpenAdd={accAutoOpenAddRef.current}
          onAutoOpenConsumed={() => { accAutoOpenAddRef.current = false; }}
        />
      )}


      <div style={{ display: activeMenu === "fleet" ? "block" : "none" }}>
      <div className="relative overflow-hidden" style={{ background: "linear-gradient(135deg,#1d4ed8 0%,#2563eb 40%,#3b82f6 100%)" }}>
        {/* Decorative blobs */}
        <div className="absolute top-0 right-0 w-96 h-96 rounded-full opacity-20 -translate-y-1/2 translate-x-1/3" style={{ background: "radial-gradient(circle,#fff,transparent)" }} />
        <div className="absolute bottom-0 left-20 w-64 h-64 rounded-full opacity-10" style={{ background: "radial-gradient(circle,#fff,transparent)" }} />
        {/* Route dots decoration */}
        <div className="absolute top-8 left-1/2 flex items-center gap-2 opacity-20">
          {[...Array(8)].map((_, i) => <div key={i} className="w-1.5 h-1.5 rounded-full bg-white" />)}
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-10 pb-14 sm:pb-16">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-6">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <svg className="w-4 h-4 text-white/70" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="text-white/70 text-xs font-semibold uppercase tracking-widest">Fleet Management Portal</span>
              </div>
              <h1 className="text-2xl sm:text-4xl font-black text-white drop-shadow-sm tracking-tight">Vehicle Details</h1>
              <p className="text-white/70 mt-1.5 text-xs sm:text-sm font-medium">{vehicles.length} vehicle{vehicles.length !== 1 ? "s" : ""} · Tamil Nadu Fleet</p>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-3">
              {[
                { label: "Total",     val: counts.All,       icon: "M8 6H5a2 2 0 00-2 2v6a2 2 0 002 2h1m10-10h3a2 2 0 012 2v6a2 2 0 01-2 2h-1M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M8 6h8m-8 8h8" },
                { label: "Available", val: counts.Available, icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" },
                { label: "Diesel",    val: counts.Diesel,    icon: DIESEL_PATH },
                { label: "Petrol",    val: counts.Petrol,    icon: PETROL_PATH },
              ].map(s => (
                <div key={s.label} className="bg-white/15 backdrop-blur-sm border border-white/20 rounded-2xl px-4 py-3 flex items-center gap-3">
                  <svg className="w-5 h-5 text-white/80 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d={s.icon} />
                  </svg>
                  <div>
                    <p className="text-2xl font-black text-white leading-none">{s.val}</p>
                    <p className="text-[10px] text-white/60 font-bold uppercase tracking-wider mt-0.5">{s.label}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom wave */}
        <svg className="absolute bottom-0 w-full" viewBox="0 0 1440 48" preserveAspectRatio="none">
          <path d="M0,32 C360,0 1080,48 1440,16 L1440,48 L0,48 Z" fill="#f5f7fa" />
        </svg>
      </div>


      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">

        {/* Toolbar */}
        <div className="flex flex-col gap-3 mb-8">
          {/* Search */}
          <div className="relative w-full">
            <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input type="text" placeholder="Search vehicle, plate number, or specialist…" value={search} onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-3 rounded-xl border-2 border-gray-200 bg-white text-sm text-gray-700 font-medium focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all" />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            )}
          </div>

          {/* Filter pills + Add button */}
          <div className="flex items-center gap-2">
            <div className="flex gap-2 overflow-x-auto pb-0.5 flex-1 min-w-0">
              {(["All","Available","Diesel","Petrol"] as FilterKey[]).map(f => (
                <button key={f} onClick={() => setFilter(f)}
                  className={`flex items-center gap-1.5 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl text-xs font-bold whitespace-nowrap border-2 transition-all ${filter === f ? "text-white border-blue-500 shadow-md shadow-blue-200" : "bg-white border-gray-200 text-gray-500 hover:border-blue-300 hover:text-blue-600"}`}
                  style={filter === f ? { background: "linear-gradient(135deg,#1d4ed8,#3b82f6)" } : {}}>
                  {f}
                  <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-black ${filter === f ? "bg-white/25 text-white" : "bg-gray-100 text-gray-500"}`}>{counts[f]}</span>
                </button>
              ))}
            </div>
            <button onClick={() => setFareVehicle("picker")}
              className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold text-white shrink-0 transition-all hover:shadow-lg hover:shadow-orange-200"
              style={{ background: "linear-gradient(135deg,#f97316,#fb923c)" }}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 11h.01M12 11h.01M15 11h.01M4 19h16a2 2 0 002-2V7a2 2 0 00-2-2H4a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <span className="hidden sm:inline">Add Fare Details</span>
              <span className="sm:hidden">Fare</span>
            </button>
            <button onClick={() => openModal({ mode: "add" })}
              className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold text-white shrink-0 transition-all hover:shadow-lg hover:shadow-blue-200"
              style={{ background: "linear-gradient(135deg,#1d4ed8,#3b82f6)" }}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              <span className="hidden sm:inline">Add Vehicle</span>
              <span className="sm:hidden">Add</span>
            </button>
          </div>
        </div>

        {/* Result label */}
        {search || filter !== "All" ? (
          <p className="text-xs text-gray-400 font-medium mb-4">
            Showing <span className="font-bold text-gray-600">{filtered.length}</span> result{filtered.length !== 1 ? "s" : ""}
            {filter !== "All" && <> for <span className="text-blue-500 font-bold">{filter}</span></>}
            {search && <> matching <span className="text-gray-700 font-bold">{search}</span></>}
          </p>
        ) : null}

        {/* Cards */}
        {filtered.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {filtered.map(v => (
              <VehicleCard key={v.id} vehicle={v} onEdit={() => openModal({ mode: "edit", vehicle: v })} onDelete={() => handleDelete(v.id)} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-28">
            <div className="w-20 h-20 rounded-3xl bg-blue-50 border-2 border-blue-100 flex items-center justify-center mb-4">
              <svg className="w-10 h-10 text-blue-300" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 6H5a2 2 0 00-2 2v6a2 2 0 002 2h1m10-10h3a2 2 0 012 2v6a2 2 0 01-2 2h-1M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M8 6h8m-8 8h8" />
              </svg>
            </div>
            <p className="font-bold text-gray-600 text-lg">No vehicles found</p>
            <p className="text-sm text-gray-400 mt-1">Try a different search or filter.</p>
            <button onClick={() => { setSearch(""); setFilter("All"); }} className="mt-4 text-sm font-bold text-blue-500 hover:text-blue-600 underline-offset-2 hover:underline">
              Clear filters
            </button>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="mt-16 border-t border-gray-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg,#1d4ed8,#3b82f6)" }}>
              <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 6H5a2 2 0 00-2 2v6a2 2 0 002 2h1m10-10h3a2 2 0 012 2v6a2 2 0 01-2 2h-1M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M8 6h8m-8 8h8" />
              </svg>
            </div>
            <span className="text-sm font-bold text-gray-500">Payanam Operator Portal</span>
          </div>
          <p className="text-xs text-gray-400">© {new Date().getFullYear()} Payanam. All rights reserved.</p>
        </div>
      </footer>

      {/* Modal */}
      {modal && (
        <VehicleModal
          mode={modal.mode}
          initial={modal.vehicle}
          nextId={nextId}
          onClose={() => setModal(null)}
          onSave={handleSave}
          showPerKm={showPerKm}
        />
      )}

      {/* Success popup */}
      {successVehicle && (
        <div className="fixed inset-0 z-[400] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden text-center px-8 py-10">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: "linear-gradient(135deg,#22c55e,#16a34a)" }}>
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-lg font-extrabold text-gray-900">Vehicle Added!</p>
            <p className="text-sm text-gray-400 mt-1 mb-6">{successVehicle.name} · {successVehicle.plate}</p>
            <div className="flex gap-3">
              <button onClick={() => setSuccessVehicle(null)}
                className="flex-1 py-3 rounded-xl border-2 border-gray-200 text-sm font-bold text-gray-600 hover:bg-gray-50 transition-colors">
                Done
              </button>
              <button onClick={() => { const v = successVehicle; setSuccessVehicle(null); setFareVehicle(v); }}
                className="flex-1 py-3 rounded-xl text-sm font-extrabold text-white transition-all hover:opacity-90"
                style={{ background: "linear-gradient(135deg,#f97316,#fb923c)" }}>
                Fare Details
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fare Details modal */}
      {fareVehicle && (
        <FareDetailsModal
          vehicle={fareVehicle === "picker" ? null : fareVehicle}
          fleet={vehicles}
          onClose={() => setFareVehicle(null)}
        />
      )}

      {/* Delete confirmation popup */}
      {deleteId && (
        <div className="fixed inset-0 z-[350] flex items-center justify-center p-6 bg-black/50 backdrop-blur-sm" onClick={() => setDeleteId(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-6 pt-6 pb-2 flex flex-col items-center text-center">
              <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mb-4">
                <svg className="w-7 h-7 text-red-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7h6m2 0a1 1 0 00-1-1h-4a1 1 0 00-1 1m-4 0h10" />
                </svg>
              </div>
              <h3 className="text-lg font-extrabold text-gray-900">Remove Vehicle?</h3>
              <p className="text-sm text-gray-500 mt-1.5 mb-5">This will remove the vehicle from your list. The vehicle will remain in the database and can be restored later.</p>
            </div>
            <div className="px-6 pb-6 flex gap-3">
              <button
                onClick={() => setDeleteId(null)}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-sm font-semibold text-white transition-colors"
              >
                Yes, Remove
              </button>
            </div>
          </div>
        </div>
      )}

      </div>{/* end fleet content wrapper */}

      {/* Logout confirmation popup */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 z-[350] flex items-center justify-center p-6 bg-black/50 backdrop-blur-sm" onClick={() => setShowLogoutConfirm(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-6 pt-6 pb-2 flex flex-col items-center text-center">
              <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mb-4">
                <svg className="w-7 h-7 text-red-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </div>
              <h3 className="text-lg font-extrabold text-gray-900">Log out?</h3>
              <p className="text-sm text-gray-500 mt-1.5 mb-5">You will be signed out of your account and redirected to the login page.</p>
            </div>
            <div className="px-6 pb-6 flex gap-3">
              <button
                onClick={() => setShowLogoutConfirm(false)}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmLogout}
                className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-sm font-semibold text-white transition-colors"
              >
                Yes, Log out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upgrade popup */}
      {showUpgrade && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-6 bg-black/50 backdrop-blur-sm" onClick={() => setShowUpgrade(false)}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="px-8 pt-8 pb-6 text-center" style={{ background: "linear-gradient(135deg,#1d4ed8,#3b82f6)" }}>
              <div className="w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
              </div>
              <h3 className="text-xl font-extrabold text-white">Download the Operator App</h3>
              <p className="text-blue-100 text-sm mt-2">Manage unlimited vehicles and more with the Payanam Operator App</p>
            </div>
            {/* Body */}
            <div className="px-8 py-6 space-y-3">
              {[
                "Add unlimited vehicles",
                "Full document management",
                "Real-time fleet tracking",
              ].map(f => (
                <div key={f} className="flex items-center gap-3">
                  <span className="w-5 h-5 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                    <svg className="w-3 h-3 text-blue-600" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                  <span className="text-sm text-gray-700 font-medium">{f}</span>
                </div>
              ))}
            </div>
            {/* Actions */}
            <div className="px-8 pb-8 flex flex-col gap-2">
              <button className="w-full py-3 rounded-2xl text-sm font-extrabold text-white transition-all hover:opacity-90 hover:shadow-lg" style={{ background: "linear-gradient(135deg,#1d4ed8,#3b82f6)" }}>
                Download Now
              </button>
              <button onClick={() => setShowUpgrade(false)} className="w-full py-3 rounded-2xl text-sm font-bold text-gray-400 hover:text-gray-600 transition-colors">
                Maybe Later
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Section picker popup — shown once per session after login ── */}
      {showMenuPicker && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center p-4" style={{background:"rgba(0,0,0,0.55)",backdropFilter:"blur(6px)"}}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden">
            {/* Header */}
            <div className="px-6 pt-7 pb-5 text-center" style={{background:"linear-gradient(135deg,#0f172a,#1e3a8a)"}}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/payanam.jpeg" alt="Payanam" className="h-9 mx-auto mb-3 object-contain rounded-lg"/>
              <h2 className="text-xl font-black text-white">Welcome back!</h2>
              <p className="text-blue-200 text-sm mt-1">Where would you like to go?</p>
            </div>
            {/* Options */}
            <div className="p-4 flex flex-col gap-3">
              <button
                onClick={() => { setActiveMenu("fleet"); setShowMenuPicker(false); openModal({ mode: "add" }); }}
                className="flex items-center gap-4 p-4 rounded-2xl border-2 border-gray-100 hover:border-blue-200 hover:bg-blue-50/50 transition-all text-left group"
              >
                <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0" style={{background:"linear-gradient(135deg,#1d4ed8,#3b82f6)"}}>
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 6H5a2 2 0 00-2 2v6a2 2 0 002 2h1m10-10h3a2 2 0 012 2v6a2 2 0 01-2 2h-1M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M8 6h8m-8 8h8"/>
                  </svg>
                </div>
                <div className="flex-1">
                  <p className="font-extrabold text-gray-900">Vehicle Details</p>
                  <p className="text-sm text-gray-400">Manage your fleet &amp; fare details</p>
                </div>
                <svg className="w-5 h-5 text-gray-300 group-hover:text-blue-400 transition-colors shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
                </svg>
              </button>

              <button
                onClick={() => { accAutoOpenAddRef.current = true; setActiveMenu("accommodation"); setShowMenuPicker(false); }}
                className="flex items-center gap-4 p-4 rounded-2xl border-2 border-gray-100 hover:border-purple-200 hover:bg-purple-50/50 transition-all text-left group"
              >
                <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0" style={{background:"linear-gradient(135deg,#7c3aed,#6d28d9)"}}>
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/>
                  </svg>
                </div>
                <div className="flex-1">
                  <p className="font-extrabold text-gray-900">Accommodation</p>
                  <p className="text-sm text-gray-400">Hotels, villas, resorts &amp; more</p>
                </div>
                <svg className="w-5 h-5 text-gray-300 group-hover:text-purple-400 transition-colors shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// ── Accommodation Management Page ─────────────────────────────────────────────

const ROOM_TYPE_OPTIONS = ["Single","Double","Twin","Deluxe","Suite","Family Room","Executive Room","Presidential Suite","Dormitory"];
const ROOM_AMENITY_OPTIONS = [
  "AC","WiFi","TV","Hot Water","Balcony","Bathtub",
  "Room Service","Mini Bar","Safe","Hair Dryer","Wardrobe","Heater",
  "Swimming Pool","Gym","Restaurant","Bar","Spa","Laundry",
];
const VILLA_AMENITY_OPTIONS = [
  "WiFi","AC","TV","Parking","Hot Water","Heater",
  "Washing Machine","Kitchen Appliances","BBQ Area",
  "Garden","Terrace","CCTV","Security","Generator",
  "Caretaker","Elevator","Pet Friendly","Gym",
];
const WHOLE_PROPERTY_CATS = new Set(["Villa","Homestay","Guest House"]);

const GQL_ACCOMMODATIONS = `query { myAccommodations { id category propertyName address description starRating totalRooms parkingAvailable parkingSpaces photos rooms { roomType price hours beds maxGuests amenities } bedrooms bathrooms beds maxGuests hasHall hasKitchen hasPrivatePool propertySize villaAmenities villaPrice villaHours } }`;
const GQL_SAVE_ACC = `mutation Save($id: ID, $input: AccommodationInput!) { saveAccommodation(id: $id, input: $input) { id category propertyName address description starRating totalRooms parkingAvailable parkingSpaces photos rooms { roomType price hours beds maxGuests amenities } bedrooms bathrooms beds maxGuests hasHall hasKitchen hasPrivatePool propertySize villaAmenities villaPrice villaHours } }`;
const GQL_DELETE_ACC = `mutation Del($id: ID!) { deleteAccommodation(id: $id) }`;

type RoomRecord    = { roomType:string; price:number|null; hours:number|null; beds:number|null; maxGuests:number|null; amenities:string[]; };
type RoomFormEntry = { roomType:string; price:string; hours:string; beds:string; maxGuests:string; amenities:string[]; };
type HotelRecord   = { id:string; category:string; propertyName:string; address:string; description:string; starRating:number|null; totalRooms:number|null; parkingAvailable:boolean; parkingSpaces:number|null; rooms:RoomRecord[]; photos:string[]; bedrooms:number|null; bathrooms:number|null; beds:number|null; maxGuests:number|null; hasHall:boolean; hasKitchen:boolean; hasPrivatePool:boolean; propertySize:string; villaAmenities:string[]; villaPrice:number|null; villaHours:number|null; };
type HotelForm     = { category:string; propertyName:string; address:string; description:string; starRating:string; totalRooms:string; parkingAvailable:boolean; parkingSpaces:string; rooms:RoomFormEntry[]; photos:string[]; bedrooms:string; bathrooms:string; beds:string; maxGuests:string; hasHall:boolean; hasKitchen:boolean; hasPrivatePool:boolean; propertySize:string; villaAmenities:string[]; villaPrice:string; villaHours:string; };

const emptyRoom = (): RoomFormEntry => ({ roomType:"Double", price:"", hours:"", beds:"", maxGuests:"", amenities:[] });
const emptyHotelForm = (): HotelForm => ({ category:"Hotel", propertyName:"", address:"", description:"", starRating:"", totalRooms:"", parkingAvailable:false, parkingSpaces:"", rooms:[], photos:[], bedrooms:"", bathrooms:"", beds:"", maxGuests:"", hasHall:false, hasKitchen:false, hasPrivatePool:false, propertySize:"", villaAmenities:[], villaPrice:"", villaHours:"" });
function recordToForm(r: HotelRecord): HotelForm { return { category:r.category, propertyName:r.propertyName, address:r.address, description:r.description, starRating:r.starRating!=null?String(r.starRating):"", totalRooms:r.totalRooms!=null?String(r.totalRooms):"", parkingAvailable:r.parkingAvailable, parkingSpaces:r.parkingSpaces!=null?String(r.parkingSpaces):"", rooms:(r.rooms??[]).map(rm=>({roomType:rm.roomType??"",price:rm.price!=null?String(rm.price):"",hours:rm.hours!=null?String(rm.hours):"",beds:rm.beds!=null?String(rm.beds):"",maxGuests:rm.maxGuests!=null?String(rm.maxGuests):"",amenities:[...(rm.amenities??[])]})), photos:[...(r.photos??[])], bedrooms:r.bedrooms!=null?String(r.bedrooms):"", bathrooms:r.bathrooms!=null?String(r.bathrooms):"", beds:r.beds!=null?String(r.beds):"", maxGuests:r.maxGuests!=null?String(r.maxGuests):"", hasHall:r.hasHall??false, hasKitchen:r.hasKitchen??false, hasPrivatePool:r.hasPrivatePool??false, propertySize:r.propertySize??"", villaAmenities:[...(r.villaAmenities??[])], villaPrice:r.villaPrice!=null?String(r.villaPrice):"", villaHours:r.villaHours!=null?String(r.villaHours):"" }; }

const CAT_BADGE: Record<string,string> = {
  Hotel:"bg-blue-100 text-blue-700", Villa:"bg-emerald-100 text-emerald-700",
  Resort:"bg-purple-100 text-purple-700", Homestay:"bg-orange-100 text-orange-700",
  "Guest House":"bg-gray-100 text-gray-700", "Service Apartment":"bg-cyan-100 text-cyan-700",
};

const CAT_COLORS: Record<string,[string,string,string]> = {
  Hotel:              ["#1d4ed8","#4f46e5","#6366f1"],
  Villa:              ["#059669","#0d9488","#14b8a6"],
  Resort:             ["#7c3aed","#6d28d9","#8b5cf6"],
  Homestay:           ["#ea580c","#dc2626","#f97316"],
  "Guest House":      ["#475569","#334155","#64748b"],
  "Service Apartment":["#0284c7","#0369a1","#38bdf8"],
};

function HotelCardImage({ photos, propertyName, c1, c2, c3, onOpen }: {
  photos: string[]; propertyName: string;
  c1:string; c2:string; c3:string;
  onOpen: ()=>void;
}) {
  const [idx, setIdx]     = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (photos.length <= 1) return;
    if (paused) return;
    const t = setInterval(() => setIdx(i => (i + 1) % photos.length), 3500);
    return () => clearInterval(t);
  }, [photos.length, paused]);

  return (
    <div className="relative overflow-hidden shrink-0" style={{height:200,borderRadius:"24px 24px 0 0",cursor:"pointer"}}
      onClick={onOpen}
      onMouseEnter={()=>setPaused(true)}
      onMouseLeave={()=>setPaused(false)}>

      {/* Slides */}
      {photos.length > 0 ? (
        photos.map((url, i) => (
          <img key={url} src={url} alt={propertyName}
            className="absolute inset-0 w-full h-full object-cover"
            style={{
              opacity: i === idx ? 1 : 0,
              transition: "opacity 0.7s ease",
              pointerEvents: "none",
            }}/>
        ))
      ) : (
        <div className="w-full h-full" style={{background:`linear-gradient(145deg,${c1},${c2},${c3})`}}>
          <div className="absolute inset-0 flex items-center justify-center">
            <svg className="w-14 h-14 text-white/20" fill="none" stroke="currentColor" strokeWidth={1.2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
            </svg>
          </div>
        </div>
      )}

      {/* Dot indicators */}
      {photos.length > 1 && (
        <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5 pointer-events-none">
          {photos.map((_,i) => (
            <div key={i} className="rounded-full transition-all duration-400"
              style={{
                width: i === idx ? 16 : 5,
                height: 5,
                background: i === idx ? "#fff" : "rgba(255,255,255,0.5)",
                boxShadow: i === idx ? "0 1px 4px rgba(0,0,0,0.3)" : "none",
              }}/>
          ))}
        </div>
      )}

      {/* Hover overlay */}
      {photos.length > 0 && (
        <div className="img-overlay absolute inset-0 flex items-center justify-center">
          <div className="flex items-center gap-2 bg-black/50 backdrop-blur-sm text-white text-xs font-semibold px-4 py-2 rounded-full border border-white/20">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
            </svg>
            View {photos.length} Photo{photos.length > 1 ? "s" : ""}
          </div>
        </div>
      )}
    </div>
  );
}

function AccommodationPage({ authHeaders, autoOpenAdd, onAutoOpenConsumed }: { authHeaders: Record<string,string>; autoOpenAdd?: boolean; onAutoOpenConsumed?: () => void }) {
  const GQL = process.env.NEXT_PUBLIC_GRAPHQL_URL ?? "http://localhost:4000/graphql";
  const [hotels,   setHotels]  = useState<HotelRecord[]>([]);
  const [expandedAmenities, setExpandedAmenities] = useState<Set<string>>(new Set());
  const [loading,  setLoading] = useState(true);
  const [modal,    setModal]   = useState<{open:boolean; editing:HotelRecord|null}>({open:false,editing:null});
  const [lightbox, setLightbox]= useState<{photos:string[]; idx:number}|null>(null);

  useEffect(()=>{
    if (!lightbox) return;
    const onKey = (e:KeyboardEvent) => {
      if (e.key==="Escape") setLightbox(null);
      if (e.key==="ArrowRight") setLightbox(lb=>lb&&lb.idx<lb.photos.length-1?{...lb,idx:lb.idx+1}:lb);
      if (e.key==="ArrowLeft")  setLightbox(lb=>lb&&lb.idx>0?{...lb,idx:lb.idx-1}:lb);
    };
    window.addEventListener("keydown",onKey);
    return ()=>window.removeEventListener("keydown",onKey);
  },[lightbox]);
  const [form,    setForm]    = useState<HotelForm>(emptyHotelForm());
  const [saving,       setSaving]       = useState(false);
  const [saveError,    setSaveError]    = useState("");
  const [delId,        setDelId]        = useState<string|null>(null);
  const [deleting,     setDeleting]     = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const photoUrlMap = useRef<Map<string,string>>(new Map());

  const UPLOAD_URL = (process.env.NEXT_PUBLIC_GRAPHQL_URL ?? "http://localhost:4000/graphql").replace("/graphql", "/upload");

  async function handlePhotoUpload(file: File) {
    setUploadingPhoto(true);
    try {
      const reader = new FileReader();
      const dataUri = await new Promise<string>((res, rej) => {
        reader.onload = () => res(reader.result as string);
        reader.onerror = rej;
        reader.readAsDataURL(file);
      });
      const base64 = dataUri.split(",")[1];
      // Show data URI as thumbnail immediately (always works, no server dependency)
      setForm(f => ({ ...f, photos: [...f.photos, dataUri] }));
      const ext = file.name.split(".").pop() ?? "jpg";
      const resp = await fetch(UPLOAD_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64, ext }),
      });
      const { url } = await resp.json();
      if (url) {
        // Store the mapping — data URI stays in form for display, server URL used on save
        photoUrlMap.current.set(dataUri, url);
      } else {
        setForm(f => ({ ...f, photos: f.photos.filter(p => p !== dataUri) }));
      }
    } catch {
      setForm(f => ({ ...f, photos: f.photos.slice(0, -1) }));
    } finally { setUploadingPhoto(false); }
  }

  const gqlFetch = (query:string, variables?:object) =>
    fetch(GQL, { method:"POST", headers:{"Content-Type":"application/json",...authHeaders}, body:JSON.stringify({query,variables}) }).then(r=>r.json());

  function load() { setLoading(true); gqlFetch(GQL_ACCOMMODATIONS).then(j=>setHotels(j?.data?.myAccommodations??[])).catch(()=>{}).finally(()=>setLoading(false)); }
  useEffect(()=>{ load(); },[]); // eslint-disable-line react-hooks/exhaustive-deps

  const openAdd  = () => { photoUrlMap.current.clear(); setForm(emptyHotelForm()); setSaveError(""); setModal({open:true,editing:null}); };
  const openEdit = (r:HotelRecord) => { photoUrlMap.current.clear(); setForm(recordToForm(r)); setSaveError(""); setModal({open:true,editing:r}); };
  const closeModal = () => { photoUrlMap.current.clear(); setModal({open:false,editing:null}); setSaveError(""); };

  useEffect(() => {
    if (autoOpenAdd) { openAdd(); onAutoOpenConsumed?.(); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  function setF<K extends keyof HotelForm>(k:K,v:HotelForm[K]) { setForm(f=>({...f,[k]:v})); }
  function addRoom() { setForm(f=>({...f,rooms:[...f.rooms,emptyRoom()]})); }
  function removeRoom(i:number) { setForm(f=>({...f,rooms:f.rooms.filter((_,idx)=>idx!==i)})); }
  function setRoom<K extends keyof RoomFormEntry>(i:number,k:K,v:RoomFormEntry[K]) { setForm(f=>({...f,rooms:f.rooms.map((r,idx)=>idx===i?{...r,[k]:v}:r)})); }
  function toggleRoomAmenity(i:number,a:string) { setForm(f=>({...f,rooms:f.rooms.map((r,idx)=>idx===i?{...r,amenities:r.amenities.includes(a)?r.amenities.filter(x=>x!==a):[...r.amenities,a]}:r)})); }
  function toggleVillaAmenity(a:string) { setForm(f=>({...f,villaAmenities:f.villaAmenities.includes(a)?f.villaAmenities.filter(x=>x!==a):[...f.villaAmenities,a]})); }

  async function handleSave() {
    if (!form.propertyName.trim()) return;
    setSaving(true);
    setSaveError("");
    try {
      const input = {
        category: form.category,
        propertyName: form.propertyName.trim(),
        address: form.address.trim() || null,
        description: form.description.trim() || null,
        starRating: form.starRating ? Number(form.starRating) : null,
        totalRooms: form.totalRooms ? Number(form.totalRooms) : null,
        parkingAvailable: form.parkingAvailable,
        parkingSpaces: form.parkingSpaces ? Number(form.parkingSpaces) : null,
        photos: form.photos.map(p => photoUrlMap.current.get(p) ?? p),
        rooms: WHOLE_PROPERTY_CATS.has(form.category) ? [] : form.rooms.map(r => ({
          roomType: r.roomType || null,
          price: r.price ? Number(r.price) : null,
          hours: r.hours ? Number(r.hours) : null,
          beds: r.beds ? Number(r.beds) : null,
          maxGuests: r.maxGuests ? Number(r.maxGuests) : null,
          amenities: r.amenities,
        })),
        bedrooms:      form.bedrooms      ? Number(form.bedrooms)      : null,
        bathrooms:     form.bathrooms     ? Number(form.bathrooms)     : null,
        beds:          form.beds          ? Number(form.beds)          : null,
        maxGuests:     form.maxGuests     ? Number(form.maxGuests)     : null,
        hasHall:       form.hasHall,
        hasKitchen:    form.hasKitchen,
        hasPrivatePool:form.hasPrivatePool,
        propertySize:  form.propertySize  || null,
        villaAmenities:WHOLE_PROPERTY_CATS.has(form.category) ? form.villaAmenities : [],
        villaPrice:    form.villaPrice    ? Number(form.villaPrice)    : null,
        villaHours:    form.villaHours    ? Number(form.villaHours)    : null,
      };
      const j = await gqlFetch(GQL_SAVE_ACC, { id: modal.editing?.id ?? null, input });
      if (j?.errors?.length) {
        setSaveError(j.errors[0]?.message ?? "Save failed. Please try again.");
        return;
      }
      const saved = j?.data?.saveAccommodation;
      if (saved) {
        modal.editing
          ? setHotels(h => h.map(x => x.id === saved.id ? saved : x))
          : setHotels(h => [saved, ...h]);
        closeModal();
      } else {
        setSaveError("Save failed. Please check your connection and try again.");
      }
    } catch (err) {
      setSaveError("Network error. Please try again.");
      console.error("saveAccommodation error:", err);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!delId) return; setDeleting(true);
    try { await gqlFetch(GQL_DELETE_ACC,{id:delId}); setHotels(h=>h.filter(x=>x.id!==delId)); setDelId(null); }
    catch {} finally { setDeleting(false); }
  }

  const inp = "w-full px-4 py-3 rounded-xl text-sm font-medium text-gray-800 bg-white border border-gray-200 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all placeholder-gray-400";
  const lbl = "block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2";

  return (
    <div className="min-h-screen" style={{background:"#f1f5f9"}}>

      {/* ── Hero banner ── */}
      <div className="relative overflow-hidden" style={{background:"linear-gradient(135deg,#0f172a 0%,#1e3a5f 50%,#1e40af 100%)"}}>
        <div className="absolute inset-0 opacity-10" style={{backgroundImage:"radial-gradient(circle at 1px 1px,white 1px,transparent 0)",backgroundSize:"28px 28px"}}/>
        <div className="absolute top-0 right-0 w-80 h-80 rounded-full opacity-10" style={{background:"radial-gradient(circle,#818cf8,transparent)",transform:"translate(30%,-30%)"}}/>
        <div className="absolute bottom-0 left-0 w-64 h-64 rounded-full opacity-10" style={{background:"radial-gradient(circle,#60a5fa,transparent)",transform:"translate(-30%,30%)"}}/>
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-10 pb-16">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
                  <svg className="w-4 h-4 text-blue-300" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>
                </div>
                <span className="text-blue-300 text-xs font-bold uppercase tracking-widest">Accommodation Management</span>
              </div>
              <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight">Hotel Details</h1>
              <p className="text-blue-200 text-sm mt-2">{hotels.length} {hotels.length===1?"property":"properties"} registered</p>
            </div>
            <div className="flex items-center gap-4">
              {hotels.length>0 && (
                <div className="hidden sm:flex items-center gap-4">
                  {[["Total",hotels.length],["Parking",hotels.filter(h=>h.parkingAvailable).length],["Avg Rooms", hotels.filter(h=>h.totalRooms).length>0?Math.round(hotels.filter(h=>h.totalRooms).reduce((s,h)=>s+(h.totalRooms??0),0)/hotels.filter(h=>h.totalRooms).length):0]].map(([l,v])=>(
                    <div key={String(l)} className="text-center">
                      <p className="text-2xl font-black text-white">{v}</p>
                      <p className="text-blue-300 text-xs font-medium">{l}</p>
                    </div>
                  ))}
                </div>
              )}
              <button onClick={openAdd} className="flex items-center gap-2 px-5 py-3 rounded-2xl text-sm font-bold text-white border border-white/20 hover:bg-white/10 transition-all backdrop-blur-sm" style={{background:"rgba(255,255,255,0.12)"}}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/></svg>
                Add Hotel Details
              </button>
            </div>
          </div>
        </div>
        <svg className="absolute bottom-0 left-0 w-full" viewBox="0 0 1440 32" preserveAspectRatio="none" fill="#f1f5f9"><path d="M0,32 C360,0 1080,0 1440,32 L1440,32 L0,32 Z"/></svg>
      </div>

      {/* ── Content ── */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 -mt-2">

        {loading && (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <svg className="animate-spin w-10 h-10 text-indigo-400" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
            <p className="text-gray-400 text-sm font-medium">Loading properties...</p>
          </div>
        )}

        {!loading && hotels.length===0 && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-24 h-24 rounded-3xl flex items-center justify-center mb-6 shadow-lg" style={{background:"linear-gradient(135deg,#1e3a5f,#1e40af)"}}>
              <svg className="w-12 h-12 text-blue-200" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>
            </div>
            <h3 className="text-xl font-black text-gray-800 mb-2">No properties yet</h3>
            <p className="text-gray-500 text-sm mb-8 max-w-xs">Add your first hotel, villa or resort to start managing your accommodation portfolio.</p>
            <button onClick={openAdd} className="flex items-center gap-2 px-6 py-3 rounded-2xl text-sm font-bold text-white shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all" style={{background:"linear-gradient(135deg,#1e40af,#4f46e5)"}}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/></svg>
              Add Your First Property
            </button>
          </div>
        )}

        {!loading && hotels.length>0 && (
          <>
          <style>{`
            @keyframes card-in {
              from { opacity:0; transform:translateY(32px) scale(0.95); }
              to   { opacity:1; transform:translateY(0)    scale(1); }
            }
            @keyframes lb-in {
              from { opacity:0; transform:scale(0.92); }
              to   { opacity:1; transform:scale(1); }
            }
            @keyframes lb-bg { from{opacity:0} to{opacity:1} }
            .hotel-card { animation:card-in 0.5s cubic-bezier(.22,1,.36,1) both; }
            .hotel-card:nth-child(1){animation-delay:0s}
            .hotel-card:nth-child(2){animation-delay:0.08s}
            .hotel-card:nth-child(3){animation-delay:0.14s}
            .hotel-card:nth-child(4){animation-delay:0.20s}
            .hotel-card:nth-child(5){animation-delay:0.26s}
            .hotel-card:nth-child(6){animation-delay:0.30s}
            .hotel-img { transition:transform 0.6s cubic-bezier(.22,1,.36,1); }
            .hotel-card:hover .hotel-img { transform:scale(1.06); }
            .img-overlay { opacity:0; transition:opacity 0.3s ease; }
            .hotel-card:hover .img-overlay { opacity:1; }
            .card-actions { opacity:0; transform:translateY(8px); transition:all 0.3s cubic-bezier(.22,1,.36,1); }
            .hotel-card:hover .card-actions { opacity:1; transform:translateY(0); }
            .lb-img { animation:lb-in 0.3s cubic-bezier(.22,1,.36,1) both; }
          `}</style>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {hotels.map((h,idx)=>{
              const [c1,c2,c3] = CAT_COLORS[h.category]??["#475569","#334155","#64748b"];
              return (
                <div key={h.id} className="hotel-card relative rounded-3xl overflow-hidden flex flex-col cursor-pointer"
                  style={{
                    background:"#fff",
                    boxShadow:"0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.06)",
                    transition:"box-shadow 0.3s ease, transform 0.3s cubic-bezier(.22,1,.36,1)",
                    animationDelay:`${idx*0.07}s`,
                  }}
                  onMouseEnter={e=>{
                    (e.currentTarget as HTMLElement).style.boxShadow=`0 8px 40px rgba(0,0,0,0.13), 0 0 0 1px ${c1}22`;
                    (e.currentTarget as HTMLElement).style.transform="translateY(-6px)";
                  }}
                  onMouseLeave={e=>{
                    (e.currentTarget as HTMLElement).style.boxShadow="0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.06)";
                    (e.currentTarget as HTMLElement).style.transform="translateY(0)";
                  }}
                >
                  {/* ── Auto-sliding carousel image ── */}
                  <div className="relative">
                    <HotelCardImage
                      photos={h.photos??[]}
                      propertyName={h.propertyName}
                      c1={c1} c2={c2} c3={c3}
                      onOpen={()=>h.photos?.length&&setLightbox({photos:h.photos,idx:0})}
                    />
                    {/* Category + star rating overlaid on image */}
                    <div className="absolute top-3 left-3 right-3 flex justify-between pointer-events-none z-10">
                      <span className="bg-black/45 backdrop-blur-md text-white text-[11px] font-bold px-3 py-1.5 rounded-full border border-white/15">{h.category}</span>
                      {h.starRating!=null&&h.starRating>0&&(
                        <span className="flex items-center gap-1 bg-black/45 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/15">
                          <svg className="w-3 h-3 fill-amber-300" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>
                          <span className="text-amber-300 text-[11px] font-bold">{h.starRating}.0</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* ── Content (seamlessly connected to image) ── */}
                  <div className="px-5 pt-4 pb-5 flex-1 flex flex-col">

                    {/* Name + location + price — grouped tightly */}
                    <h3 className="text-lg font-black text-gray-900 leading-tight tracking-tight">{h.propertyName||"Unnamed Property"}</h3>
                    {h.address&&(
                      <p className="flex items-center gap-1 text-gray-400 text-xs mt-0.5 mb-1">
                        <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                        <span className="truncate">{h.address}</span>
                      </p>
                    )}

                    {/* Starting price */}
                    {(()=>{
                      const isWhole = WHOLE_PROPERTY_CATS.has(h.category);
                      if (isWhole) {
                        if (!h.villaPrice) return null;
                        return (
                          <div className="flex items-baseline gap-1.5 mb-2">
                            <span className="text-xs text-gray-400 font-medium">From</span>
                            <span className="text-xl font-black" style={{color:c1}}>₹{h.villaPrice.toLocaleString("en-IN")}</span>
                            {h.villaHours!=null&&h.villaHours>0&&(
                              <span className="text-xs text-gray-400 font-medium">· {h.villaHours} hr{h.villaHours!==1?"s":""}</span>
                            )}
                          </div>
                        );
                      }
                      const priced=h.rooms?.filter(r=>r.price!=null)??[];
                      const prices=priced.map(r=>r.price!);
                      if (!prices.length) return null;
                      const minPrice=Math.min(...prices);
                      const minHrs=priced.find(r=>r.price===minPrice)?.hours;
                      return (
                        <div className="flex items-baseline gap-1.5 mb-2">
                          <span className="text-xs text-gray-400 font-medium">From</span>
                          <span className="text-xl font-black" style={{color:c1}}>₹{minPrice.toLocaleString("en-IN")}</span>
                          {minHrs!=null&&minHrs>0&&(
                            <span className="text-xs text-gray-400 font-medium">· {minHrs} hr{minHrs!==1?"s":""}</span>
                          )}
                        </div>
                      );
                    })()}

                    {/* Villa facility chips */}
                    {WHOLE_PROPERTY_CATS.has(h.category)&&(
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {h.hasHall&&<span className="px-2.5 py-1 rounded-lg text-[11px] font-bold" style={{background:`${c1}12`,color:c1}}>Hall</span>}
                        {h.hasKitchen&&<span className="px-2.5 py-1 rounded-lg text-[11px] font-bold" style={{background:`${c1}12`,color:c1}}>Kitchen</span>}
                        {h.hasPrivatePool&&<span className="px-2.5 py-1 rounded-lg text-[11px] font-bold" style={{background:`${c1}12`,color:c1}}>Private Pool</span>}
                      </div>
                    )}

                    {/* Room type badges (hotels only) */}
                    {!WHOLE_PROPERTY_CATS.has(h.category)&&(h.rooms?.length??0)>0&&(
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {h.rooms.slice(0,3).map((r,i)=>(
                          <span key={i} className="px-2.5 py-1 rounded-lg text-[11px] font-bold" style={{background:`${c1}12`,color:c1}}>{r.roomType||"Room"}</span>
                        ))}
                        {h.rooms.length>3&&<span className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-gray-100 text-gray-400">+{h.rooms.length-3} more</span>}
                      </div>
                    )}

                    {/* Stats */}
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      {(()=>{
                        const isWhole=WHOLE_PROPERTY_CATS.has(h.category);
                        const stats: {v:string|number;l:string}[] = [];
                        if (isWhole) {
                          if (h.bedrooms!=null) stats.push({v:h.bedrooms,l:"Bed"+(h.bedrooms!==1?"rooms":"room")});
                          if (h.bathrooms!=null) stats.push({v:h.bathrooms,l:"Bath"+(h.bathrooms!==1?"rooms":"room")});
                          if (h.maxGuests!=null) stats.push({v:`Up to ${h.maxGuests}`,l:"Guests"});
                        } else {
                          if (h.totalRooms!=null) stats.push({v:h.totalRooms,l:"Rooms"});
                          if ((h.rooms?.length??0)>0) stats.push({v:h.rooms.length,l:"Type"+(h.rooms.length!==1?"s":"")});
                          const maxG=(h.rooms?.length??0)>0?Math.max(...h.rooms.filter(r=>r.maxGuests!=null).map(r=>r.maxGuests!)):null;
                          if (maxG!=null&&maxG>0) stats.push({v:`Up to ${maxG}`,l:"Guests"});
                        }
                        return stats.map((s,i)=>(
                          <div key={s.l} className="flex items-center gap-1.5">
                            {i>0&&<span className="w-1 h-1 rounded-full bg-gray-200"/>}
                            <span className="text-sm font-black" style={{color:c1}}>{s.v}</span>
                            <span className="text-xs text-gray-400 font-medium">{s.l}</span>
                          </div>
                        ));
                      })()}
                    </div>


                    {/* Amenity chips */}
                    {(()=>{
                      const all=WHOLE_PROPERTY_CATS.has(h.category)
                        ?(h.villaAmenities??[])
                        :[...new Set(h.rooms?.flatMap(r=>r.amenities??[])??[])];
                      if (!all.length) return null;
                      const expanded=expandedAmenities.has(h.id);
                      const visible=expanded?all:all.slice(0,4);
                      return (
                        <div className="flex flex-wrap gap-1.5 mb-5">
                          {visible.map(a=>(
                            <span key={a} className="px-2.5 py-1 rounded-lg text-[11px] font-semibold" style={{background:`${c1}0f`,color:c1}}>{a}</span>
                          ))}
                          {!expanded&&all.length>4&&(
                            <button onClick={e=>{e.stopPropagation();setExpandedAmenities(s=>{const n=new Set(s);n.add(h.id);return n;});}}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors cursor-pointer">
                              +{all.length-4} more
                            </button>
                          )}
                          {expanded&&all.length>4&&(
                            <button onClick={e=>{e.stopPropagation();setExpandedAmenities(s=>{const n=new Set(s);n.delete(h.id);return n;});}}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors cursor-pointer">
                              Show less
                            </button>
                          )}
                        </div>
                      );
                    })()}

                    {/* Actions — always visible, at the bottom */}
                    <div className="flex gap-2 mt-auto">
                      <button onClick={()=>openEdit(h)}
                        className="flex-1 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all active:scale-95 border"
                        style={{background:`${c1}0a`,color:c1,borderColor:`${c1}20`}}
                        onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background=`${c1}18`;}}
                        onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background=`${c1}0a`;}}>
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                        Edit Details
                      </button>
                      <button onClick={()=>setDelId(h.id)}
                        className="w-10 h-10 rounded-xl flex items-center justify-center text-gray-300 hover:text-red-500 hover:bg-red-50 border border-gray-100 hover:border-red-200 transition-all active:scale-95 shrink-0">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          </>
        )}
      </div>

      {/* ── Add / Edit Modal ── */}
      {modal.open && createPortal(
        <>
        <style>{`
          @keyframes modal-bg   { from{opacity:0} to{opacity:1} }
          @keyframes modal-in   { from{opacity:0;transform:scale(0.94) translateY(16px)} to{opacity:1;transform:scale(1) translateY(0)} }
          @keyframes section-in { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
          .modal-wrap  { animation:modal-bg 0.2s ease both; }
          .modal-card  { animation:modal-in 0.35s cubic-bezier(.22,1,.36,1) both; }
          .form-section{ animation:section-in 0.3s cubic-bezier(.22,1,.36,1) both; }
          .form-section:nth-child(2){animation-delay:.04s}
          .form-section:nth-child(3){animation-delay:.08s}
          .form-section:nth-child(4){animation-delay:.12s}
          .form-section:nth-child(5){animation-delay:.16s}
          .form-section:nth-child(6){animation-delay:.20s}
          .acc-inp { width:100%; padding:12px 16px; border-radius:14px; font-size:14px; font-weight:500; color:#1e293b; border:1.5px solid #e2e8f0; background:#f8fafc; outline:none; transition:all 0.2s ease; }
          .acc-inp:focus { border-color:#6366f1; background:#fff; box-shadow:0 0 0 3px rgba(99,102,241,0.12); }
          .acc-inp::placeholder { color:#94a3b8; }
          .acc-lbl { display:block; font-size:11px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:.06em; margin-bottom:8px; }
        `}</style>
        <div className="modal-wrap fixed inset-0 z-[400] flex items-end sm:items-center justify-center sm:p-6" style={{background:"rgba(2,6,23,0.8)",backdropFilter:"blur(16px)"}}>
          <div className="modal-card bg-white w-full sm:max-w-2xl max-h-[96dvh] sm:max-h-[92dvh] flex flex-col"
            style={{borderRadius:"28px 28px 28px 28px",boxShadow:"0 40px 100px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.06)"}}>

            {/* ── Gradient header ── */}
            <div className="relative shrink-0 overflow-hidden" style={{
              background: `linear-gradient(135deg,${(CAT_COLORS[form.category]??["#4f46e5","#7c3aed","#6366f1"])[0]},${(CAT_COLORS[form.category]??["#4f46e5","#7c3aed","#6366f1"])[2]})`,
              borderRadius:"28px 28px 0 0",
              padding:"24px 28px 20px",
            }}>
              <div className="absolute inset-0 opacity-10" style={{backgroundImage:"radial-gradient(circle at 1px 1px,rgba(255,255,255,0.6) 1px,transparent 0)",backgroundSize:"20px 20px"}}/>
              <div className="absolute top-0 right-0 w-48 h-48 rounded-full opacity-10" style={{background:"radial-gradient(circle,white,transparent)",transform:"translate(30%,-30%)"}}/>
              <div className="relative flex items-start justify-between">
                <div>
                  <div className="inline-flex items-center gap-2 bg-white/15 backdrop-blur-sm border border-white/20 rounded-full px-3 py-1 mb-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-white/70 animate-pulse"/>
                    <span className="text-white/80 text-xs font-semibold">{form.category}</span>
                  </div>
                  <h2 className="text-2xl font-black text-white tracking-tight leading-tight">
                    {modal.editing ? "Edit Property" : "Add Hotel Details"}
                  </h2>
                  <p className="text-white/60 text-sm mt-1">Fill in your property information below</p>
                </div>
                <button onClick={closeModal}
                  className="w-9 h-9 rounded-full bg-white/15 hover:bg-white/25 border border-white/20 flex items-center justify-center transition-all active:scale-90 hover:rotate-90 shrink-0"
                  style={{transition:"all 0.2s ease"}}>
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
                  </svg>
                </button>
              </div>
            </div>

            {/* ── Scrollable body ── */}
            <div className="flex-1 overflow-y-auto px-7 py-6 space-y-5" style={{background:"#f8fafc"}}>

              {/* Property type */}
              <div className="form-section">
                <p className="acc-lbl">Property Type</p>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {([
                    {c:"Hotel",icon:"M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"},
                    {c:"Villa",icon:"M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"},
                    {c:"Resort",icon:"M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"},
                    {c:"Homestay",icon:"M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"},
                    {c:"Guest House",icon:"M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"},
                    {c:"Service Apartment",icon:"M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5"},
                  ]).map(({c,icon})=>{
                    const active=form.category===c;
                    const [cc1,,cc3]=CAT_COLORS[c]??["#4f46e5","#6366f1","#818cf8"];
                    return (
                      <button key={c} onClick={()=>setF("category",c)}
                        className="shrink-0 flex flex-col items-center gap-2 px-4 py-3 rounded-2xl transition-all active:scale-95"
                        style={{
                          background:active?`linear-gradient(135deg,${cc1},${cc3})`:"#fff",
                          border:active?"none":"1.5px solid #e2e8f0",
                          boxShadow:active?`0 6px 20px ${cc1}40`:"0 1px 3px rgba(0,0,0,0.05)",
                          minWidth:80,
                          transition:"all 0.25s cubic-bezier(.22,1,.36,1)",
                        }}>
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{background:active?"rgba(255,255,255,0.2)":"#f1f5f9"}}>
                          <svg className="w-4.5 h-4.5" style={{width:18,height:18}} fill="none" stroke={active?"#fff":cc1} strokeWidth={1.8} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d={icon}/>
                          </svg>
                        </div>
                        <span className="text-[11px] font-bold text-center leading-tight" style={{color:active?"#fff":cc1}}>{c}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Photos */}
              <div className="form-section bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <p className="acc-lbl" style={{marginBottom:0}}>Images</p>
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{background:"#eef2ff",color:"#4f46e5"}}>{form.photos.length} uploaded</span>
                </div>
                <div className="flex gap-3 overflow-x-auto pb-1">
                  {form.photos.map((url,i)=>(
                    <div key={i} className="relative group shrink-0 rounded-2xl overflow-hidden shadow-sm" style={{width:112,height:80}}>
                      <img src={url} alt="" className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"/>
                      <button onClick={()=>setF("photos",form.photos.filter((_,j)=>j!==i))}
                        className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center">
                        <div className="w-8 h-8 rounded-full bg-white/20 backdrop-blur-sm border border-white/30 flex items-center justify-center">
                          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                        </div>
                      </button>
                    </div>
                  ))}
                  <label className={`shrink-0 rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-2 cursor-pointer transition-all ${uploadingPhoto?"border-indigo-300 bg-indigo-50":"border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/50"}`} style={{width:112,height:80}}>
                    <input type="file" accept="image/*" className="hidden" disabled={uploadingPhoto}
                      onChange={e=>{const f=e.target.files?.[0];if(f)handlePhotoUpload(f);e.target.value="";}}/>
                    {uploadingPhoto
                      ? <svg className="animate-spin w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                      : <>
                          <div className="w-8 h-8 rounded-xl bg-indigo-50 flex items-center justify-center">
                            <svg className="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/></svg>
                          </div>
                          <span className="text-[10px] font-bold text-indigo-400">Add Photo</span>
                        </>
                    }
                  </label>
                </div>
              </div>

              {/* Property details */}
              <div className="form-section bg-white rounded-2xl p-5 border border-gray-100 shadow-sm space-y-4">
                <p className="acc-lbl" style={{marginBottom:0}}>Property Details</p>
                <div>
                  <label className="acc-lbl">Property Name <span style={{color:"#f87171",fontWeight:400,textTransform:"none"}}>*</span></label>
                  <input type="text" value={form.propertyName} onChange={e=>setF("propertyName",e.target.value)} placeholder="e.g. Green Valley Resort" className="acc-inp"/>
                </div>
                <div>
                  <label className="acc-lbl">Address</label>
                  <input type="text" value={form.address} onChange={e=>setF("address",e.target.value)} placeholder="Full address of the property" className="acc-inp"/>
                </div>
                <div>
                  <label className="acc-lbl">Description</label>
                  <textarea value={form.description} onChange={e=>setF("description",e.target.value)} rows={2} placeholder="What makes this property special?" className="acc-inp" style={{resize:"none"}}/>
                </div>
              </div>

              {/* Rating + Rooms + Times */}
              <div className="form-section grid grid-cols-2 gap-4">
                <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
                  <label className="acc-lbl">Star Rating</label>
                  <div className="flex gap-1.5 mt-1">
                    {[1,2,3,4,5].map(s=>{
                      const active=Number(form.starRating)===s;
                      return (
                        <button key={s} onClick={()=>setF("starRating",form.starRating===String(s)?"":String(s))}
                          className="flex-1 h-10 rounded-xl text-xs font-black transition-all active:scale-90"
                          style={active?{background:"linear-gradient(135deg,#f59e0b,#f97316)",color:"#fff",boxShadow:"0 3px 10px rgba(245,158,11,0.4)"}:{background:"#f8fafc",color:"#e2e8f0",border:"1.5px solid #e2e8f0"}}>
                          ★
                        </button>
                      );
                    })}
                  </div>
                  {form.starRating&&<p className="text-center text-xs font-semibold mt-2" style={{color:"#f59e0b"}}>{form.starRating} Star{Number(form.starRating)>1?"s":""}</p>}
                </div>
                <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
                  <label className="acc-lbl">Total Rooms</label>
                  <input type="number" min={0} value={form.totalRooms} onChange={e=>setF("totalRooms",e.target.value)} placeholder="e.g. 20" className="acc-inp"/>
                </div>
              </div>

              {/* Parking */}
              <div className="form-section bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
                <div className="grid grid-cols-1 gap-4">
                  <div>
                    <label className="acc-lbl">Parking</label>
                    <button onClick={()=>setF("parkingAvailable",!form.parkingAvailable)}
                      className="w-full h-[46px] rounded-xl text-xs font-bold border-2 transition-all active:scale-95"
                      style={form.parkingAvailable
                        ?{background:"linear-gradient(135deg,#10b981,#059669)",color:"#fff",border:"none",boxShadow:"0 3px 10px rgba(16,185,129,0.35)"}
                        :{background:"#f8fafc",color:"#94a3b8",border:"1.5px solid #e2e8f0"}}>
                      {form.parkingAvailable?"✓ Available":"Not Available"}
                    </button>
                  </div>
                </div>
                {form.parkingAvailable&&(
                  <div className="mt-4">
                    <label className="acc-lbl">Parking Spaces</label>
                    <input type="number" min={0} value={form.parkingSpaces} onChange={e=>setF("parkingSpaces",e.target.value)} placeholder="Number of spaces" className="acc-inp"/>
                  </div>
                )}
              </div>

              {/* ── Villa / Whole-property config ── */}
              {WHOLE_PROPERTY_CATS.has(form.category) && (()=>{
                const [cc1,,cc3]=CAT_COLORS[form.category]??["#4f46e5","#7c3aed","#6366f1"];
                return (
                  <div className="form-section space-y-4">

                    {/* Bedroom / Bathroom / Beds / Max Guests */}
                    <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
                      <p className="acc-lbl" style={{marginBottom:12}}>Property Configuration</p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {([
                          {label:"Bedrooms",   key:"bedrooms",  ph:"e.g. 3"},
                          {label:"Bathrooms",  key:"bathrooms", ph:"e.g. 2"},
                          {label:"Beds",       key:"beds",      ph:"e.g. 4"},
                          {label:"Max Guests", key:"maxGuests", ph:"e.g. 8"},
                        ] as {label:string;key:keyof HotelForm;ph:string}[]).map(({label,key,ph})=>(
                          <div key={key} className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                            <label className="acc-lbl" style={{marginBottom:6}}>{label}</label>
                            <input type="number" min={0} value={form[key] as string}
                              onChange={e=>setF(key,e.target.value)} placeholder={ph}
                              className="w-full bg-transparent text-base font-black text-gray-800 outline-none placeholder-gray-300"/>
                          </div>
                        ))}
                      </div>

                      {/* Property Size */}
                      <div className="mt-3">
                        <label className="acc-lbl">Property Size (optional)</label>
                        <input type="text" value={form.propertySize} onChange={e=>setF("propertySize",e.target.value)}
                          placeholder="e.g. 2000 sq ft" className="acc-inp"/>
                      </div>
                    </div>

                    {/* Facilities toggles */}
                    <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
                      <p className="acc-lbl" style={{marginBottom:12}}>Facilities</p>
                      <div className="grid grid-cols-3 gap-3">
                        {([
                          {label:"Hall / Living Room", key:"hasHall"},
                          {label:"Kitchen",            key:"hasKitchen"},
                          {label:"Private Pool",       key:"hasPrivatePool"},
                        ] as {label:string;key:"hasHall"|"hasKitchen"|"hasPrivatePool"}[]).map(({label,key})=>(
                          <button key={key} onClick={()=>setF(key,!form[key])}
                            className="py-3 rounded-xl text-xs font-bold border-2 transition-all active:scale-95"
                            style={form[key]
                              ?{background:`linear-gradient(135deg,${cc1},${cc3})`,color:"#fff",border:"none",boxShadow:`0 3px 10px ${cc1}40`}
                              :{background:"#f8fafc",color:"#64748b",border:"1.5px solid #e2e8f0"}}>
                            {form[key]?"✓ ":""}{label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Pricing */}
                    <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
                      <p className="acc-lbl" style={{marginBottom:12}}>Pricing</p>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                          <label className="acc-lbl" style={{marginBottom:6}}>Price (₹)</label>
                          <input type="number" min={0} value={form.villaPrice} onChange={e=>setF("villaPrice",e.target.value)}
                            placeholder="e.g. 5000" className="w-full bg-transparent text-base font-black text-gray-800 outline-none placeholder-gray-300"/>
                        </div>
                        <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                          <label className="acc-lbl" style={{marginBottom:6}}>Hours</label>
                          <input type="number" min={0} value={form.villaHours} onChange={e=>setF("villaHours",e.target.value)}
                            placeholder="e.g. 24" className="w-full bg-transparent text-base font-black text-gray-800 outline-none placeholder-gray-300"/>
                        </div>
                      </div>
                    </div>

                    {/* Amenities */}
                    <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
                      <div className="flex items-center justify-between mb-4">
                        <p className="acc-lbl" style={{marginBottom:0}}>Amenities</p>
                        {form.villaAmenities.length>0&&<span className="text-[10px] font-bold px-2.5 py-1 rounded-full" style={{background:`${cc1}15`,color:cc1}}>{form.villaAmenities.length} selected</span>}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {VILLA_AMENITY_OPTIONS.map(a=>{
                          const on=form.villaAmenities.includes(a);
                          return (
                            <button key={a} onClick={()=>toggleVillaAmenity(a)}
                              className="px-3.5 py-2 rounded-xl text-xs font-semibold transition-all active:scale-95"
                              style={on?{background:`linear-gradient(135deg,${cc1},${cc3})`,color:"#fff",boxShadow:`0 2px 8px ${cc1}30`,border:"none"}:{background:"#f8fafc",color:"#64748b",border:"1.5px solid #e2e8f0"}}>
                              {on&&<span className="mr-1">✓</span>}{a}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* ── Room Types (Hotel / Resort / Service Apartment) ── */}
              {!WHOLE_PROPERTY_CATS.has(form.category) && (
              <div className="form-section">
                <div className="flex items-center justify-between mb-3">
                  <p className="acc-lbl" style={{marginBottom:0}}>Room Types</p>
                  <button onClick={addRoom}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all active:scale-95"
                    style={{background:`linear-gradient(135deg,${(CAT_COLORS[form.category]??["#4f46e5","#7c3aed","#6366f1"])[0]},${(CAT_COLORS[form.category]??["#4f46e5","#7c3aed","#6366f1"])[2]})`,color:"#fff",boxShadow:`0 3px 10px ${(CAT_COLORS[form.category]??["#4f46e5"])[0]}40`}}>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/></svg>
                    Add Room Type
                  </button>
                </div>

                {form.rooms.length===0&&(
                  <div className="bg-white rounded-2xl border-2 border-dashed border-gray-200 p-8 text-center">
                    <div className="w-12 h-12 rounded-2xl bg-gray-50 flex items-center justify-center mx-auto mb-3">
                      <svg className="w-6 h-6 text-gray-300" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>
                    </div>
                    <p className="text-sm font-bold text-gray-400">No room types added yet</p>
                    <p className="text-xs text-gray-300 mt-1">Click Add Room Typ to add rooms with pricing and details</p>
                  </div>
                )}

                <div className="space-y-4">
                  {form.rooms.map((room,ri)=>{
                    const [cc1,,cc3]=CAT_COLORS[form.category]??["#4f46e5","#7c3aed","#6366f1"];
                    return (
                      <div key={ri} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                        {/* Room card header */}
                        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100" style={{background:`${cc1}08`}}>
                          <span className="text-xs font-black uppercase tracking-widest" style={{color:cc1}}>
                            Room Type {form.rooms.length>1?`#${ri+1}`:""}
                          </span>
                          <button onClick={()=>removeRoom(ri)}
                            className="w-7 h-7 rounded-lg bg-red-50 hover:bg-red-100 flex items-center justify-center transition-colors">
                            <svg className="w-3.5 h-3.5 text-red-400" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                          </button>
                        </div>

                        <div className="p-5 space-y-4">
                          {/* Room type selector */}
                          <div>
                            <label className="acc-lbl">Room Type</label>
                            <div className="flex flex-wrap gap-2">
                              {ROOM_TYPE_OPTIONS.map(t=>{
                                const active=room.roomType===t;
                                return (
                                  <button key={t} onClick={()=>setRoom(ri,"roomType",active?"":t)}
                                    className="px-3 py-1.5 rounded-xl text-xs font-bold transition-all active:scale-95"
                                    style={active?{background:`linear-gradient(135deg,${cc1},${cc3})`,color:"#fff",border:"none",boxShadow:`0 2px 8px ${cc1}40`}:{background:"#f8fafc",color:"#64748b",border:"1.5px solid #e2e8f0"}}>
                                    {t}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          {/* Price / Min Hours / Beds / Max Guests */}
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {([
                              {label:"Price (₹)",  key:"price", ph:"e.g. 2500"},
                              {label:"Hours",      key:"hours", ph:"e.g. 24"},
                              {label:"Beds",              key:"beds",          ph:"e.g. 2"},
                              {label:"Max Guests",        key:"maxGuests",     ph:"e.g. 3"},
                            ] as {label:string;key:keyof RoomFormEntry;ph:string}[]).map(({label,key,ph})=>(
                              <div key={key} className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                                <label className="acc-lbl" style={{marginBottom:6}}>{label}</label>
                                <input type="number" min={0} value={room[key] as string}
                                  onChange={e=>setRoom(ri,key,e.target.value)}
                                  placeholder={ph}
                                  className="w-full bg-transparent text-base font-black text-gray-800 outline-none placeholder-gray-300"/>
                              </div>
                            ))}
                          </div>

                          {/* Amenities */}
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <label className="acc-lbl" style={{marginBottom:0}}>Amenities</label>
                              {room.amenities.length>0&&<span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{background:`${cc1}15`,color:cc1}}>{room.amenities.length} selected</span>}
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {ROOM_AMENITY_OPTIONS.map(a=>{
                                const on=room.amenities.includes(a);
                                return (
                                  <button key={a} onClick={()=>toggleRoomAmenity(ri,a)}
                                    className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all active:scale-95"
                                    style={on?{background:`linear-gradient(135deg,${cc1},${cc3})`,color:"#fff",boxShadow:`0 2px 6px ${cc1}30`,border:"none"}:{background:"#f8fafc",color:"#64748b",border:"1.5px solid #e2e8f0"}}>
                                    {on&&<span className="mr-1">✓</span>}{a}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              )}

            </div>

            {/* ── Footer ── */}
            {saveError&&(
              <div className="mx-6 px-4 py-3 rounded-xl bg-red-50 border border-red-200 flex items-center gap-2 mb-0">
                <svg className="w-4 h-4 text-red-500 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd"/></svg>
                <p className="text-sm font-medium text-red-600">{saveError}</p>
              </div>
            )}
            <div className="shrink-0 flex items-center gap-3 px-6 py-4 bg-white border-t border-gray-100" style={{borderRadius:"0 0 28px 28px"}}>
              <button onClick={closeModal}
                className="px-6 py-3 rounded-2xl text-sm font-bold text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-all active:scale-95">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving||!form.propertyName.trim()}
                className="flex-1 py-3.5 rounded-2xl text-sm font-bold text-white flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background:`linear-gradient(135deg,${(CAT_COLORS[form.category]??["#4f46e5","#7c3aed","#6366f1"])[0]},${(CAT_COLORS[form.category]??["#4f46e5","#7c3aed","#6366f1"])[2]})`,
                  boxShadow:(saving||!form.propertyName.trim())?"none":`0 6px 20px ${(CAT_COLORS[form.category]??["#4f46e5"])[0]}50`,
                }}>
                {saving&&<svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
                {saving?"Saving...":modal.editing?"Save Changes":"Add Property"}
              </button>
            </div>
          </div>
        </div>
        </>,
        document.body
      )}

      {/* ── Delete confirm ── */}
      {delId && createPortal(
        <div className="fixed inset-0 z-[400] flex items-center justify-center p-6 bg-black/60 backdrop-blur-md">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="p-6 text-center">
              <div className="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
              </div>
              <h3 className="text-xl font-black text-gray-900 mb-1">Delete Property?</h3>
              <p className="text-gray-500 text-sm mb-6">This action is permanent and cannot be undone.</p>
              <div className="flex gap-3">
                <button onClick={()=>setDelId(null)} className="flex-1 py-3 rounded-xl border-2 border-gray-200 text-sm font-bold text-gray-600 hover:bg-gray-50">Keep It</button>
                <button onClick={handleDelete} disabled={deleting} className="flex-1 py-3 rounded-xl bg-gradient-to-r from-red-500 to-rose-500 text-sm font-bold text-white hover:shadow-lg disabled:opacity-50 transition-all">{deleting?"Deleting...":"Yes, Delete"}</button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Lightbox ── */}
      {lightbox && createPortal(
        <div className="fixed inset-0 z-[500] flex flex-col"
          style={{background:"rgba(0,0,0,0.92)",backdropFilter:"blur(20px)",animation:"lb-bg 0.25s ease both"}}>

          {/* Top bar */}
          <div className="flex items-center justify-between px-6 py-4 shrink-0">
            <span className="text-white/60 text-sm font-medium">
              {lightbox.idx + 1} / {lightbox.photos.length}
            </span>
            <div className="flex gap-1">
              {lightbox.photos.map((_,i)=>(
                <button key={i} onClick={()=>setLightbox(lb=>lb?{...lb,idx:i}:lb)}
                  className="w-2 h-2 rounded-full transition-all"
                  style={{background:i===lightbox.idx?"#fff":"rgba(255,255,255,0.3)",transform:i===lightbox.idx?"scale(1.3)":"scale(1)"}}/>
              ))}
            </div>
            <button onClick={()=>setLightbox(null)}
              className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-all border border-white/20 hover:rotate-90"
              style={{transition:"all 0.2s ease"}}>
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
          </div>

          {/* Image + nav arrows */}
          <div className="flex-1 flex items-center justify-center relative px-16 min-h-0">
            {/* Prev */}
            <button onClick={()=>setLightbox(lb=>lb&&lb.idx>0?{...lb,idx:lb.idx-1}:lb)}
              disabled={lightbox.idx===0}
              className="absolute left-4 w-12 h-12 rounded-full bg-white/10 hover:bg-white/25 border border-white/20 flex items-center justify-center transition-all disabled:opacity-20 disabled:cursor-not-allowed active:scale-90 z-10">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/>
              </svg>
            </button>

            {/* Image */}
            <img key={lightbox.idx} src={lightbox.photos[lightbox.idx]} alt=""
              className="lb-img max-w-full max-h-full object-contain rounded-2xl"
              style={{maxHeight:"calc(100vh - 180px)",boxShadow:"0 32px 80px rgba(0,0,0,0.5)"}}/>

            {/* Next */}
            <button onClick={()=>setLightbox(lb=>lb&&lb.idx<lb.photos.length-1?{...lb,idx:lb.idx+1}:lb)}
              disabled={lightbox.idx===lightbox.photos.length-1}
              className="absolute right-4 w-12 h-12 rounded-full bg-white/10 hover:bg-white/25 border border-white/20 flex items-center justify-center transition-all disabled:opacity-20 disabled:cursor-not-allowed active:scale-90 z-10">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
              </svg>
            </button>
          </div>

          {/* Thumbnail strip */}
          {lightbox.photos.length > 1 && (
            <div className="shrink-0 px-6 py-4 flex justify-center gap-2 overflow-x-auto">
              {lightbox.photos.map((url,i)=>(
                <button key={i} onClick={()=>setLightbox(lb=>lb?{...lb,idx:i}:lb)}
                  className="shrink-0 w-16 h-11 rounded-xl overflow-hidden transition-all"
                  style={{
                    outline: i===lightbox.idx?"2.5px solid #fff":"2.5px solid transparent",
                    outlineOffset:"2px",
                    opacity: i===lightbox.idx?1:0.5,
                    transform: i===lightbox.idx?"scale(1.05)":"scale(1)",
                  }}>
                  <img src={url} alt="" className="w-full h-full object-cover"/>
                </button>
              ))}
            </div>
          )}

          {/* Hint */}
          <p className="text-center text-white/25 text-xs pb-4 shrink-0">
            ← → arrow keys to navigate &nbsp;·&nbsp; Esc to close
          </p>
        </div>,
        document.body
      )}
    </div>
  );
}
