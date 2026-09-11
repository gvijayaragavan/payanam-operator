export const AUTH_KEY = "payanam_auth";

export interface AuthUser {
  phone: string;
  token: string;
  loggedInAt: number;
}

export function getUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(AUTH_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function setUser(phone: string, token: string) {
  const user: AuthUser = { phone, token, loggedInAt: Date.now() };
  localStorage.setItem(AUTH_KEY, JSON.stringify(user));
}

export function getAuthHeaders(): Record<string, string> {
  const user = getUser();
  if (!user?.token) return {};
  return { Authorization: `Bearer ${user.token}` };
}

export function logout() {
  localStorage.removeItem(AUTH_KEY);
}
