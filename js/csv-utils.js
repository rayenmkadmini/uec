(function (global) {
  function normalizeCsvHeader(value) {
    return String(value || "")
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

  function parseCsv(text) {
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
    if (!rows.length) return [];

    const headers = rows.shift().map(header => header.trim());
    return rows.map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
  }

  global.UE_CSV = Object.freeze({ normalizeCsvHeader, csvField, parseCsv });
})(window);
