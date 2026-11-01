
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

type Profile = {
  id: string;
  full_name: string | null;
  role: "citizen" | "admin";
};

type AuthContextType = {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, role")
      .eq("id", userId)
      .single();

    if (error) {
      setProfile(null);
      throw error;
    }

    if (data.role !== "citizen" && data.role !== "admin") {
      setProfile(null);
      throw new Error("Invalid account role.");
    }

    setProfile(data as Profile);
  }, []);

  const refreshProfile = useCallback(async () => {
    const { data } = await supabase.auth.getSession();

    if (!data.session) {
      setSession(null);
      setProfile(null);
      return;
    }

    setSession(data.session);
    await loadProfile(data.session.user.id);
  }, [loadProfile]);

  useEffect(() => {
    let active = true;

    async function initialise() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!active) return;

        setSession(session);

        if (session) {
          await loadProfile(session.user.id);
        }
      } catch (error) {
        console.error("Authentication initialisation failed:", error);
      } finally {
        if (active) setLoading(false);
      }
    }

    void initialise();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!active) return;

      setSession(newSession);

      if (!newSession) {
        setProfile(null);
        setLoading(false);
        return;
      }

      // Load the protected profile outside the auth callback.
      setTimeout(() => {
        if (active) {
          void loadProfile(newSession.user.id)
            .catch((error) =>
              console.error("Could not load user profile:", error)
            )
            .finally(() => {
              if (active) setLoading(false);
            });
        }
      }, 0);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();

    if (error) throw error;

    setSession(null);
    setProfile(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        session,
        profile,
        loading,
        refreshProfile,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }

  return context;
}
