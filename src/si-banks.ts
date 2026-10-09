// Generated from the Bank of Slovenia's list of national identification codes of Slovenian IBAN issuers
// ("Seznam BIC kod in dvo- oziroma petmestnih (nacionalnih) identifikacijskih oznak slovenskih dodeljevalcev
// IBAN", https://www.bsi.si/sl/d/seznam-identifikacijskih-oznak-pps), retrieved 2026-10-09. The list is
// public and free to reuse. Banks get a two-digit code (the next three digits are their own); payment and
// e-money institutions get a five-digit code starting with 91. A merged bank keeps the codes it took over.
// Refresh it when banks merge.

export const SI_BANKS_SOURCE = "Banka Slovenije, list of IBAN issuer identification codes, retrieved 2026-10-09";

/** Issuer name by two-digit bank code or five-digit institution code (IBAN characters 5-6 or 5-9). */
export const SI_BANKS: Readonly<Record<string, string>> = {
  "01": "BANKA SLOVENIJE",
  "02": "NLB D.D.",
  "04": "OTP BANKA D.D.",
  "07": "GORENJSKA BANKA D.D., KRANJ",
  "10": "BANKA INTESA SANPAOLO D.D.",
  "19": "DEZELNA BANKA SLOVENIJE D.D.",
  "29": "UNICREDIT BANKA SLOVENIJA D.D.",
  "30": "NLB D.D.",
  "33": "ADDIKO BANK D.D.",
  "34": "BANKA SPARKASSE D.D.",
  "35": "BKS BANK AG, BANČNA PODRUŽNICA",
  "38": "SID BANKA D.D.",
  "60": "HRANILNICA LON D.D.",
  "61": "DELAVSKA HRANILNICA D.D. LJUBLJANA",
  "64": "PRIMORSKA HRANILNICA VIPAVA D.D.",
  "79": "KDD-CENTRALNA KLIRINŠKO DEPOTNA DRUŽBA, D.O.O.",
  "91002": "DINARO D.O.O.",
};
