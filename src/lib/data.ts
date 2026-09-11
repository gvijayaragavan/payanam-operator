export interface VehiclePricing {
  s1?: { baseFare?: number; perDay?: number; driverCharges?: number; hillsCharges?: number } | null;
  s2?:  { perKm?: number; perDayPrice?: number; driverAllowance?: number; hillsCharges?: number; tollParking?: number; sightseeing?: number } | null;
  s2b?: { perKm?: number; perDayPrice?: number; driverAllowance?: number; hillsCharges?: number; tollParking?: number; sightseeing?: number } | null;
  s3?:  { perKm?: number; perDayPrice?: number; driverAllowance?: number; hillsCharges?: number; tollParking?: number; sightseeing?: number } | null;
  s3b?: { perKm?: number; perDayPrice?: number; driverAllowance?: number; hillsCharges?: number; tollParking?: number; sightseeing?: number } | null;
  s4?:  { perDayRent?: number; perKmRate?: number; driverAllowance?: number; hillsCharges?: number; tollParking?: number } | null;
  s4b?: { perDayRent?: number; perKmRate?: number; driverAllowance?: number; hillsCharges?: number; tollParking?: number } | null;
  s5?:  { perDayRent?: number; perKmRate?: number; driverCharges?: number; hillsCharges?: number; tollParking?: number } | null;
  s5b?: { perDayRent?: number; perKmRate?: number; driverCharges?: number; hillsCharges?: number; tollParking?: number } | null;
  s6?:  { kmRange?: number; minFare?: number; additionalKmRange?: number } | null;
  s6b?: { kmRange?: number; minFare?: number; additionalKmRange?: number } | null;
  s7?: Array<{ from?: string; to?: string; day1?: number; day2?: number; day3?: number; tollParking?: number }> | null;
}

export interface Vehicle {
  id: string;
  name: string;
  model: string;
  category?: "Economy" | "Premium" | "Platinum";
  seater: number;
  fuel: "Diesel" | "Petrol";
  specialist: string;
  ac: boolean;
  available: boolean;
  plate: string;
  color: string;
  images?: string[];
  perKmPrice?: number;
  minKm?: number;
  fcEndDate?: string;
  fcDocument?: string;
  insuranceEndDate?: string;
  insuranceDocument?: string;
  rcBook?: string;
  pricing?: VehiclePricing;
  priority?: number;
}

export const fleet: Vehicle[] = [
  { id: "V001", name: "Toyota Innova Crysta",  model: "2022", seater: 7,  fuel: "Diesel", specialist: "Rajan Kumar",  ac: true, available: true,  plate: "TN 33 AX 4521", color: "#1a6fe8" },
  { id: "V002", name: "Maruti Ertiga",          model: "2023", seater: 7,  fuel: "Petrol", specialist: "Suresh Babu",  ac: true, available: true,  plate: "TN 33 BK 7834", color: "#16a34a" },
  { id: "V003", name: "Force Traveller 12",     model: "2021", seater: 12, fuel: "Diesel", specialist: "Murugan R",    ac: true, available: false, plate: "TN 33 CJ 2290", color: "#d97706" },
  { id: "V004", name: "Tempo Traveller 17",     model: "2020", seater: 17, fuel: "Diesel", specialist: "Anand Pandi",  ac: true, available: true,  plate: "TN 33 DM 6601", color: "#7c3aed" },
  { id: "V005", name: "Kia Carens",             model: "2023", seater: 6,  fuel: "Petrol", specialist: "Vijay Selvam", ac: true, available: true,  plate: "TN 33 EP 3378", color: "#f97316" },
];
