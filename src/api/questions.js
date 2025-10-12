import { mockQuestions } from "../api/mockQuestions.js";

// Feature-Flag: Mock oder Supabase
const USE_SUPABASE = false;

// Hauptfunktion zum Abrufen von Fragen
export async function fetchQuestions() {
  if (USE_SUPABASE) {
    // --- Supabase-Aufruf ---
    /*
    import { createClient } from "@supabase/supabase-js";
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    const { data, error } = await supabase.from("questions").select("*");
    if (error) throw new Error(error.message);
    return data || [];
    */
    return []; // Platzhalter, bis Supabase-Zugang vorhanden ist
  } else {
    // --- Mock-Daten ---
    return mockQuestions;
  }
}

// Separate Funktion nur für Mock
export async function fetchQuestionsMock() {
  return mockQuestions;
}
