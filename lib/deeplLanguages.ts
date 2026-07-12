/**
 * DeepL target languages offered in the UI. Kept free of any server-only
 * imports so both the settings UI (client) and the translate route (server)
 * can share the list and validation.
 */
export type DeeplTargetLanguage = { code: string; label: string };

export const DEEPL_TARGET_LANGUAGES: DeeplTargetLanguage[] = [
  { code: "EN-US", label: "English (American)" },
  { code: "EN-GB", label: "English (British)" },
  { code: "DE", label: "German" },
  { code: "FR", label: "French" },
  { code: "ES", label: "Spanish" },
  { code: "IT", label: "Italian" },
  { code: "NL", label: "Dutch" },
  { code: "PL", label: "Polish" },
  { code: "PT-PT", label: "Portuguese" },
  { code: "PT-BR", label: "Portuguese (Brazilian)" },
  { code: "RU", label: "Russian" },
  { code: "JA", label: "Japanese" },
  { code: "ZH", label: "Chinese" },
  { code: "KO", label: "Korean" },
  { code: "TR", label: "Turkish" },
  { code: "UK", label: "Ukrainian" },
  { code: "AR", label: "Arabic" }
];

export const DEFAULT_DEEPL_TARGET_LANG = "EN-US";

export function isSupportedDeeplTargetLang(code: string): boolean {
  return DEEPL_TARGET_LANGUAGES.some((language) => language.code === code);
}

/** Falls back to the default when the code is missing or not in the list. */
export function normalizeDeeplTargetLang(code: string | null | undefined): string {
  if (code && isSupportedDeeplTargetLang(code)) return code;
  return DEFAULT_DEEPL_TARGET_LANG;
}

export function deeplTargetLanguageLabel(code: string): string {
  return DEEPL_TARGET_LANGUAGES.find((language) => language.code === code)?.label ?? code;
}
