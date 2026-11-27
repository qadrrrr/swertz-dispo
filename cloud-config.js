// Swertz Dispo – Verbindung zu Supabase
//
// Hier kommen NUR die zwei öffentlichen Angaben aus Supabase hinein:
//   Supabase → Projekt → „Project Settings“ → „API“
//     url     = „Project URL“          (z. B. https://abcdefgh.supabase.co)
//     anonKey = „anon public“-Schlüssel (beginnt meist mit „eyJ…“)
//
// NIEMALS den „service_role“-Schlüssel hier eintragen!
//
// Solange beide Felder leer sind, läuft das Programm wie bisher
// (nur auf diesem Gerät bzw. in Claude).
window.SWERTZ_CLOUD_CONFIG = {
  url: "",
  anonKey: ""
};
