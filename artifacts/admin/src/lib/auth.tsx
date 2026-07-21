import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { setAuthTokenGetter } from "@workspace/api-client-react";

interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  tenantId: string;
  roles: string[];
}

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  setAuth: (token: string, user: AuthUser) => void;
  clearAuth: () => void;
}

const AuthContext = createContext<AuthState>({
  user: null,
  token: null,
  setAuth: () => {},
  clearAuth: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem("pn_token"));
  const [user, setUser] = useState<AuthUser | null>(() => {
    const raw = sessionStorage.getItem("pn_user");
    return raw ? JSON.parse(raw) : null;
  });

  useEffect(() => {
    setAuthTokenGetter(() => token);
  }, [token]);

  function setAuth(newToken: string, newUser: AuthUser) {
    setToken(newToken);
    setUser(newUser);
    sessionStorage.setItem("pn_token", newToken);
    sessionStorage.setItem("pn_user", JSON.stringify(newUser));
  }

  function clearAuth() {
    setToken(null);
    setUser(null);
    sessionStorage.removeItem("pn_token");
    sessionStorage.removeItem("pn_user");
  }

  return (
    <AuthContext.Provider value={{ user, token, setAuth, clearAuth }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
