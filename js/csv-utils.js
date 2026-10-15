(function (global) {
  // Hints in parentheses / brackets are not part of the column name:
  // "Login (FOULENFOULENI)" -> "login", "N° abonnement [optionnel]" -> "n abonnement".
  function normalizeCsvHeader(value) {
    return String(value || "")
      .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, "");
  }

  function csvField(row, names) {
    const aliases = new Set(names.map(normalizeCsvHeader));
    const key = Object.keys(row || {}).find(candidate => aliases.has(normalizeCsvHeader(candidate)));
    return key ? String(row[key] ?? "").trim() : "";
  }

  function countDelimiterOutsideQuotes(line, delimiter) {
    let quoted = false;
    let count = 0;
    for (let i = 0; i < line.length; i += 1) {
      if (line[i] === '"') {
        if (quoted && line[i + 1] === '"') i += 1;
        else quoted = !quoted;
      } else if (!quoted && line[i] === delimiter) {
        count += 1;
      }
    }
    return count;
  }

  // Returns { headers, records }: headers exactly as written (duplicates kept),
  // records as objects keyed by header.
  function parseCsvTable(text) {
    const source = String(text ?? "").charCodeAt(0) === 0xFEFF ? String(text).slice(1) : String(text ?? "");
    const firstLine = source.split(/\r?\n/, 1)[0] || "";
    const delimiter = countDelimiterOutsideQuotes(firstLine, ";") > countDelimiterOutsideQuotes(firstLine, ",") ? ";" : ",";
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;

    for (let i = 0; i < source.length; i += 1) {
      const char = source[i];
      const next = source[i + 1];

      if (char === '"') {
        if (quoted && next === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = !quoted;
        }
      } else if (char === delimiter && !quoted) {
        row.push(field);
        field = "";
      } else if ((char === "\n" || char === "\r") && !quoted) {
        if (char === "\r" && next === "\n") i += 1;
        row.push(field);
        if (row.some(value => value.trim() !== "")) rows.push(row);
        row = [];
        field = "";
      } else {
        field += char;
      }
    }

    if (quoted) throw new Error("CSV contains an unclosed quoted field.");
    if (field !== "" || row.length) {
      row.push(field);
      if (row.some(value => value.trim() !== "")) rows.push(row);
    }
    if (!rows.length) return { headers: [], records: [] };

    const headers = rows.shift().map(header => header.trim());
    return {
      headers,
      records: rows.map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])))
    };
  }

  function parseCsv(text) {
    return parseCsvTable(text).records;
  }

  // Member import columns: field -> accepted header names (compared after
  // normalizeCsvHeader). Single source for the import page and the tests.
  const MEMBER_CSV_FIELDS = Object.freeze({
    email: ["mail", "email", "e-mail", "adresse email", "adresse mail", "البريد الإلكتروني", "البريد الالكتروني"],
    nom: ["nom", "name", "last name", "lastname", "اللقب", "اسم العائلة", "الاسم العائلي"],
    prenom: ["prenom", "prénom", "first name", "firstname", "الاسم", "الإسم", "الاسم الأول", "الاسم الشخصي"],
    numero_abonnement: ["numero d abonnement", "numero abonnement", "n abonnement", "no abonnement", "numero", "abonnement", "رقم الاشتراك", "رقم المنخرط"],
    login: ["login", "identifiant", "username", "nom d utilisateur", "اسم الدخول"],
    cin: ["cin", "numero cin", "n cin", "بطاقة التعريف الوطنية", "رقم بطاقة التعريف"],
    gender: ["sexe", "gender", "genre", "الجنس"],
    phone: ["telephone", "téléphone", "phone", "tel", "gsm", "الهاتف", "رقم الهاتف"],
    adresse: ["address", "adresse", "العنوان"],
    faculty: ["faculte", "faculté", "faculty", "etablissement", "الكلية", "المؤسسة"],
    zone: ["zone", "المنطقة"]
  });
  const MEMBER_REQUIRED_FIELDS = Object.freeze(["nom", "prenom", "cin", "gender"]);

  const memberAliasIndex = new Map();
  for (const [field, aliases] of Object.entries(MEMBER_CSV_FIELDS)) {
    for (const alias of aliases) memberAliasIndex.set(normalizeCsvHeader(alias), field);
  }

  // Maps headers to fields. A field claimed by two columns is ambiguous (the
  // file is refused rather than guessing which column wins).
  function analyzeMemberHeaders(headers) {
    const columns = {};
    const duplicates = [];
    const unknown = [];
    (headers || []).forEach(header => {
      const field = memberAliasIndex.get(normalizeCsvHeader(header));
      if (!field) {
        if (String(header).trim()) unknown.push(String(header).trim());
        return;
      }
      if (columns[field] !== undefined) {
        const existing = duplicates.find(d => d.field === field);
        if (existing) existing.headers.push(header);
        else duplicates.push({ field, headers: [columns[field], header] });
      } else {
        columns[field] = header;
      }
    });
    const missing = MEMBER_REQUIRED_FIELDS.filter(field => columns[field] === undefined);
    return { columns, missing, duplicates, unknown, ok: missing.length === 0 && duplicates.length === 0 };
  }

  // Parses a member CSV into rows carrying their file row number (header = 1).
  function parseMemberCsv(text) {
    const { headers, records } = parseCsvTable(text);
    const analysis = analyzeMemberHeaders(headers);
    const rows = records.map((record, index) => {
      const row = { line: index + 2 };
      for (const field of Object.keys(MEMBER_CSV_FIELDS)) {
        const header = analysis.columns[field];
        row[field] = header === undefined ? "" : String(record[header] ?? "").trim();
      }
      return row;
    });
    return { headers, analysis, rows };
  }

  global.UE_CSV = Object.freeze({
    normalizeCsvHeader, csvField, parseCsv, parseCsvTable,
    MEMBER_CSV_FIELDS, MEMBER_REQUIRED_FIELDS, analyzeMemberHeaders, parseMemberCsv
  });
})(window);
