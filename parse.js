// parse.js: receipt text parsing + transaction matching.
// Shared by the browser (window.ReceiptMatch) and node (module.exports).
(function (root) {
  "use strict";

  // A price at the end of a line: "4.99", "$18.74", "13.98 F" (trailing tax flag letter allowed).
  // OCR sometimes reads the decimal point as a comma, so accept both.
  var PRICE_AT_END = /(-?\$?\s?\d{1,5}\s?[.,]\s?\d{2})\s*[A-Z]?\s*$/i;
  // Any price anywhere in a line, used for the "largest amount" fallback.
  var PRICE_ANY = /\$?\d{1,5}[.,]\d{2}(?!\d)/g;

  var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  function toNumber(s) {
    return parseFloat(String(s).replace(/[$\s]/g, "").replace(",", "."));
  }

  function cleanLines(text) {
    return String(text)
      .split(/\r?\n/)
      .map(function (l) { return l.replace(/\s+/g, " ").trim(); })
      .filter(Boolean);
  }

  // Rule: merchant = first line that has letters and no price, skipping greeting lines.
  function parseMerchant(lines) {
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (/[A-Za-z]{2,}/.test(l) && !PRICE_AT_END.test(l) && !/^(welcome|thank|receipt|survey)/i.test(l)) return l;
    }
    return null;
  }

  function iso(y, m, d) {
    if (y < 100) y += 2000;
    if (m < 1 || m > 12 || d < 1 || d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return null;
    return y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
  }

  // Rule: date = first match of a common US format, scanning top to bottom.
  // Supported: MM/DD/YYYY, MM/DD/YY, YYYY-MM-DD, "Mon DD, YYYY". Dashes also accepted for MM-DD-YYYY.
  function parseDate(lines) {
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i], m;
      if ((m = l.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/))) return iso(+m[1], +m[2], +m[3]);
      if ((m = l.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{4}|\d{2})\b/))) return iso(+m[3], +m[1], +m[2]);
      if ((m = l.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/i)))
        return iso(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
    }
    return null;
  }

  // Rule: total = amount on the LAST line containing "total" but not "subtotal".
  // Fallback: the largest amount anywhere on the receipt.
  function parseTotal(lines) {
    for (var i = lines.length - 1; i >= 0; i--) {
      var l = lines[i];
      if (/total/i.test(l) && !/sub\s*-?\s*total/i.test(l)) {
        var m = l.match(PRICE_AT_END);
        if (m) return toNumber(m[1]);
      }
    }
    var max = null;
    lines.forEach(function (l) {
      (l.match(PRICE_ANY) || []).forEach(function (p) {
        var n = toNumber(p);
        if (max === null || n > max) max = n;
      });
    });
    return max;
  }

  // Rule: line items = lines ending in a price that are NOT summary or payment lines.
  var NOT_AN_ITEM = /\b(sub\s*-?\s*total|total|tax|change|cash|visa|mastercard|amex|debit|credit|balance|tender|due|auth|approved|savings|discount|coupon)\b/i;

  function parseItems(lines) {
    var items = [];
    lines.forEach(function (l) {
      var m = l.match(PRICE_AT_END);
      if (!m || NOT_AN_ITEM.test(l)) return;
      var name = l.slice(0, m.index).trim();
      var price = toNumber(m[1]);
      if (!/[A-Za-z]{2,}/.test(name) || price <= 0) return; // a bare number or a credit is not an item
      items.push({ name: name, price: price });
    });
    return items;
  }

  function parseReceipt(text) {
    var lines = cleanLines(text);
    return {
      merchant: parseMerchant(lines),
      date: parseDate(lines),
      total: parseTotal(lines),
      items: parseItems(lines),
    };
  }

  // Transactions CSV: "date,description,amount" (header optional). Amount sign ignored for matching.
  function parseTransactions(csv) {
    return cleanLines(csv)
      .map(function (l) { return l.split(",").map(function (c) { return c.trim(); }); })
      .filter(function (c) { return c.length >= 3 && !isNaN(parseFloat(c[c.length - 1])); })
      .map(function (c) {
        return { date: c[0], description: c.slice(1, -1).join(","), amount: parseFloat(c[c.length - 1]) };
      });
  }

  // Merchant words: lowercase letter words of 3+ chars, minus generic store words.
  var GENERIC = { mkt: 1, market: 1, store: 1, inc: 1, llc: 1, the: 1, and: 1, pos: 1, purchase: 1, debit: 1, card: 1 };
  function words(s) {
    return (String(s || "").toLowerCase().match(/[a-z]{3,}/g) || []).filter(function (w) { return !GENERIC[w]; });
  }

  function daysApart(a, b) {
    var t1 = Date.parse(a + "T00:00:00Z"), t2 = Date.parse(b + "T00:00:00Z");
    if (isNaN(t1) || isNaN(t2)) return Infinity;
    return Math.abs(t1 - t2) / 86400000;
  }

  // Matching: a candidate must have an amount within 0.02 AND a date within 3 days.
  // If the date could not be read, the store name has to match instead.
  // Score = 40 for the amount, up to 30 for the date (closer is higher), +10 per shared merchant word (max 30).
  // Best score wins, so a same amount charge at another store loses to the one whose name matches.
  function matchTransaction(receipt, txns) {
    var best = null;
    txns.forEach(function (t) {
      var diff = Math.abs(Math.abs(t.amount) - Math.abs(receipt.total || 0));
      if (receipt.total == null || diff > 0.02) return;
      var days = receipt.date ? daysApart(receipt.date, t.date) : Infinity;
      var dateOk = days <= 3, noDate = !receipt.date;
      var rw = words(receipt.merchant), tw = words(t.description);
      var shared = rw.filter(function (w) { return tw.indexOf(w) !== -1; });
      if (!dateOk && !(noDate && shared.length)) return;
      var score = 40 + (dateOk ? 30 - days * 5 : 0) + Math.min(30, shared.length * 10);
      if (!best || score > best.score) {
        best = { txn: t, score: score, amountDiff: diff, days: days, dateOk: dateOk, sharedWords: shared };
      }
    });
    return best;
  }

  // One plain sentence explaining why the match was made.
  function confidenceLine(m) {
    var parts = [];
    parts.push(m.amountDiff < 0.005 ? "amount matches to the cent" : "amount within $" + m.amountDiff.toFixed(2));
    parts.push(m.dateOk ? "date within 3 days (" + (m.days === 0 ? "same day" : Math.round(m.days) + " apart") + ")" : "date not readable");
    parts.push(m.sharedWords.length ? "merchant words match (" + m.sharedWords.join(", ") + ")" : "merchant words differ");
    return parts.join(", ");
  }

  // Sample bank export used to prefill the page (and by the node test).
  var SAMPLE_TRANSACTIONS = [
    "date,description,amount",
    "2026-10-26,SPOTIFY USA,-11.99",
    "2026-10-27,CHEVRON 0091245,-48.12",
    "2026-10-28,AMAZON MKTPL*2K4L19,-54.37",
    "2026-10-29,WHOLE FOODS MKT #123,-54.37",
    "2026-10-30,STARBUCKS STORE 08812,-6.45",
    "2026-10-31,TRADER JOE S #552,-37.80",
    "2026-11-01,PAYROLL ACME CORP,1250.00",
    "2026-11-02,NETFLIX.COM,-15.49",
  ].join("\n");

  var api = {
    SAMPLE_TRANSACTIONS: SAMPLE_TRANSACTIONS,
    parseReceipt: parseReceipt, parseTransactions: parseTransactions,
    matchTransaction: matchTransaction, confidenceLine: confidenceLine,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ReceiptMatch = api;
})(this);
