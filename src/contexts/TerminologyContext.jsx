import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { getTerms } from "../lib/terminology";
import { useAuth } from "./AuthContext";

const TerminologyContext = createContext(getTerms(null));

export function TerminologyProvider({ children }) {
  const { user } = useAuth();
  const [terms, setTerms] = useState(getTerms(null));

  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from("tutors")
      .select("user_type")
      .eq("id", user.id)
      .single()
      .then(({ data }) => {
        setTerms(getTerms(data?.user_type));
      });
  }, [user?.id]);

  return (
    <TerminologyContext.Provider value={terms}>
      {children}
    </TerminologyContext.Provider>
  );
}

export function useTerms() {
  return useContext(TerminologyContext);
}
