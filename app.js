// app.js: the Transactions screen. Receipt parsing and matching rules live in parse.js.
(function () {
  "use strict";
  var RM = window.ReceiptMatch;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var money = function (n) { return (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var title = function (s) { return String(s).toLowerCase().replace(/(^|\s)([a-z])/g, function (_, a, b) { return a + b.toUpperCase(); }); };
  var dayLabel = function (iso) { return new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" }); };

  // Friendly names for the sample bank descriptions, the way the app would show them.
  var MERCHANTS = [
    [/whole foods/i, "Whole Foods", "Groceries", "#2f7d57"], [/amazon/i, "Amazon", "Shopping", "#e8831c"],
    [/spotify/i, "Spotify", "Subscriptions", "#25a65a"], [/chevron/i, "Chevron", "Gas", "#2c6fb0"],
    [/starbucks/i, "Starbucks", "Coffee", "#1f6b4a"], [/trader joe/i, "Trader Joe's", "Groceries", "#b5392d"],
    [/payroll/i, "Payroll", "Income", "#5b5f97"], [/netflix/i, "Netflix", "Subscriptions", "#c9252d"],
  ];
  // What each receipt line counts as. First hit wins, anything else lands in Other.
  var CATS = [
    ["Snacks and drinks", "#8e6bbf", /chip|cracker|goldfish|cookie|soda|juice|\bwater\b|coffee|\btea\b|chocolate|candy|dr\.? pepper|peanut butter/i],
    ["Protein", "#d9694f", /salmon|chicken|beef|turkey|pork|shrimp|\bfish\b|tuna|steak|\beggs?\b|tofu|sausage|bacon|pepperoni/i],
    ["Dairy and alternatives", "#3f7fd6", /milk|yogurt|cheese|butter|cream/i],
    ["Produce", "#3bb273", /banana|spinach|apple|berry|berries|lettuce|tomato|onion|avocado|kale|carrot|\bpeppers?\b|grape|orange|lemon|lime|eggplant|watermelon/i],
    ["Bakery", "#c79a3b", /bread|bagel|sourdough|muffin|tortilla|croissant|\bbuns?\b/i],
  ];
  var OTHER = ["Other", "#9a948a"], REST = ["Tax and other", "#c9c3b8"], OFF = "Savings and other";
  var catOf = function (name) { for (var i = 0; i < CATS.length; i++) if (CATS[i][2].test(name)) return CATS[i]; return OTHER; };

  var txns = RM.parseTransactions(RM.SAMPLE_TRANSACTIONS).map(function (t) {
    var hit = MERCHANTS.filter(function (m) { return m[0].test(t.description); })[0] || [null, t.description, "Other", "#8a857c"];
    return { raw: t, name: hit[1], cat: hit[2], color: hit[3], receipt: null };
  }).reverse();

  var open = null, busy = false, failed = false; // open = the row in the panel, or a { pending } / { unmatched } placeholder
  var settle = false; // true when the panel redraws for an Ask chip, so old content does not animate again

  $("today").textContent = new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

  function logo(t) { return '<span class="logo" style="background:' + t.color + '">' + esc(t.name[0]) + "</span>"; }

  // Turns parsed receipt data into everything the screen shows.
  function build(r, text, imgUrl) {
    var items = r.items.map(function (it) {
      var c = catOf(it.name);
      return { name: title(it.name), price: it.price, cat: c[0], color: c[1] };
    });
    var sum = items.reduce(function (a, b) { return a + b.price; }, 0);
    var total = r.total != null ? r.total : sum;
    var rest = Math.round((total - sum) * 100) / 100;
    var groups = {};
    items.forEach(function (it) { (groups[it.cat] = groups[it.cat] || { name: it.cat, color: it.color, amt: 0 }).amt += it.price; });
    var flows = Object.keys(groups).map(function (k) { return groups[k]; }).sort(function (a, b) { return b.amt - a.amt; });
    if (rest > 0.004) flows.push({ name: REST[0], color: REST[1], amt: rest });
    return { merchant: r.merchant, date: r.date, total: total, items: items, rest: rest, flows: flows, text: text, img: imgUrl, why: null, ruledOut: [], asked: [] };
  }

  function renderList() {
    var byDay = {};
    txns.forEach(function (t) { (byDay[t.raw.date] = byDay[t.raw.date] || []).push(t); });
    $("list").innerHTML = "";
    Object.keys(byDay).sort().reverse().forEach(function (d) {
      var g = document.createElement("div"); g.className = "group"; g.textContent = dayLabel(d);
      var c = document.createElement("div"); c.className = "card";
      byDay[d].forEach(function (t) {
        var b = document.createElement("button");
        b.type = "button"; b.className = "row" + (open === t ? " sel" : "");
        var sub = t.receipt
          ? '<span class="row-sub got">' + t.receipt.items.length + " items from receipt</span>" + strip(t.receipt)
          : '<span class="row-sub">' + esc(t.cat) + "</span>";
        b.innerHTML = logo(t) + '<span class="row-mid"><span class="row-name">' + esc(t.name) + "</span>" + sub + "</span>" +
          '<span class="row-amt' + (t.raw.amount > 0 ? " in" : "") + '">' + (t.raw.amount > 0 ? "+" : "") + money(Math.abs(t.raw.amount)) + "</span>";
        b.addEventListener("click", function () { open = t; failed = false; renderAll(); });
        c.appendChild(b);
      });
      $("list").appendChild(g); $("list").appendChild(c);
    });
  }

  function strip(rc) {
    var cls = rc.stripShown ? "strip still" : "strip"; rc.stripShown = true;
    return '<span class="' + cls + '">' + rc.flows.map(function (f) { return '<i style="flex:' + f.amt + ";background:" + f.color + '"></i>'; }).join("") + "</span>";
  }

  function renderPanel() {
    var p = $("panel");
    if (!open) { p.hidden = true; return; }
    p.hidden = false;
    var t = open, rc = t.receipt, head = t.pending
      ? '<div class="panel-top"><span class="logo" style="background:#b98a45">↑</span><div class="panel-name">New receipt<small>' + (failed ? "Photo not read" : "Finding the charge it belongs to") + '</small></div><button class="x" type="button" aria-label="Close">×</button></div>'
      : t.unmatched
      ? '<div class="panel-top"><span class="logo" style="background:#8a857c">?</span><div class="panel-name">' + esc(title(rc.merchant || "Unknown store")) + "<small>" + esc(rc.date ? dayLabel(rc.date) : "No date found") + '</small></div><button class="x" type="button" aria-label="Close">×</button></div><div class="big">' + (rc.total ? money(rc.total) : "No total found") + "</div>"
      : '<div class="panel-top">' + logo(t) + '<div class="panel-name">' + esc(t.name) + "<small>" + esc(dayLabel(t.raw.date)) + " · " + esc(t.cat) + '</small></div><button class="x" type="button" aria-label="Close">×</button></div><div class="big">' + money(Math.abs(t.raw.amount)) + "</div>";
    var h = head;

    if (busy) {
      h += '<div class="sec">Receipt</div><div class="scan"><img src="' + busy.img + '" alt="Receipt being read"></div><div class="scan-status" id="scan-status">Reading receipt...</div>';
    } else if (!rc) {
      h += '<div class="sec">Receipt</div><label class="drop" id="drop" for="file"><strong>' + (failed ? "Could not read that photo. Try another one." : "Add a receipt photo") + '</strong>Drop it here or tap to choose one</label>';
      if (/whole foods/i.test(t.name)) h += '<div class="or"><button class="link" id="panel-sample" type="button">Use the sample receipt</button></div>';
    } else {
      h += proofHtml(t, rc) + itemsHtml(rc) + insightHtml(rc) + askHtml(rc);
      h += '<details><summary>Raw text read from the photo</summary><pre>' + esc(rc.text) + "</pre></details>";
    }
    p.classList.toggle("settled", settle); settle = false;
    p.innerHTML = h;

    p.querySelector(".x").addEventListener("click", function () { open = null; failed = false; renderAll(); });
    var s = $("panel-sample"); if (s) s.addEventListener("click", useSample);
    var rm = $("remove"); if (rm) rm.addEventListener("click", function () { t.receipt = null; if (t.unmatched) open = null; renderAll(); });
    var d = $("drop");
    if (d) {
      ["dragenter", "dragover"].forEach(function (ev) { d.addEventListener(ev, function (e) { e.preventDefault(); d.classList.add("over"); }); });
      ["dragleave", "drop"].forEach(function (ev) { d.addEventListener(ev, function (e) { e.preventDefault(); d.classList.remove("over"); }); });
      d.addEventListener("drop", function (e) { var f = e.dataTransfer.files[0]; if (f && f.type.indexOf("image/") === 0) read(f); });
    }
    p.querySelectorAll(".chip").forEach(function (c) {
      c.addEventListener("click", function () {
        if (rc.asked.indexOf(c.dataset.q) === -1) rc.asked.push(c.dataset.q);
        settle = true;
        renderPanel();
        p.scrollTop = p.scrollHeight;
      });
    });
  }

  function proofHtml(t, rc) {
    if (t.unmatched) {
      return '<div class="sec">Receipt</div><div class="proof none"><div class="tick">!</div><div><b>No matching charge in this sample list</b><span>Nothing here is within 2 cents and 3 days of this receipt. In the app it would check your real transactions.</span></div></div>';
    }
    var on = rc.closer; // what actually separated this charge from the others
    var off = rc.ruledOut.map(function (o) { return esc(o.name) + " was also " + money(Math.abs(o.raw.amount)) + ", but this is the closer match on " + on + "."; }).join(" ");
    return '<div class="sec">Receipt</div><div class="proof"><div class="tick">✓</div><div><b>Matched to this charge</b><span>' + esc(rc.why) + "." + (off ? "<br>" + off : "") + "</span></div></div>";
  }

  function itemsHtml(rc) {
    var rows = rc.items.map(function (it, i) {
      return '<div class="item" style="animation-delay:' + i * 70 + 'ms"><span class="dot" style="background:' + it.color + '"></span><span class="item-name">' + esc(it.name) + '<span class="item-cat">' + esc(it.cat) + '</span></span><span class="item-amt">' + money(it.price) + "</span></div>";
    }).join("");
    if (!rows) rows = '<div class="item">No line items could be read from this photo.</div>';
    if (Math.abs(rc.rest) > 0.004) rows += '<div class="item rest"><span class="dot" style="background:' + REST[1] + '"></span><span class="item-name">' + (rc.rest > 0 ? REST[0] : OFF) + '</span><span class="item-amt">' + money(rc.rest) + "</span></div>";
    rows += '<div class="item sum"><span class="item-name">Total</span><span class="item-amt">' + money(rc.total) + "</span></div>";
    return '<div class="sec"><span>' + rc.items.length + ' items</span><button class="link" id="remove" type="button">Remove receipt</button></div><div class="card">' + rows + "</div>";
  }

  function biggest(rc) { return rc.items.slice().sort(function (a, b) { return b.price - a.price; })[0]; }

  function insightHtml(rc) {
    if (!rc.items.length || !rc.total) return "";
    var top = biggest(rc), pct = Math.round(top.price / rc.total * 100);
    var cats = rc.flows.filter(function (f) { return f.name !== REST[0]; }).length;
    return '<div class="sec"></div><section class="insight"><div class="insight-label"><span class="spark">✦</span>TREASURY INSIGHT</div><p><em>' + esc(top.name) + "</em> was the biggest item at <em>" + money(top.price) + "</em>" + (pct <= 100 ? ", " + pct + "% of this trip" : "") + ". This trip now counts as " + rc.items.length + " items across " + cats + (cats === 1 ? " category" : " categories") + " instead of one line.</p></section>";
  }

  var QS = { flow: "Where did this money go?", top: "What was the priciest item?" };

  function askHtml(rc) {
    if (!rc.items.length) return "";
    var h = '<div class="sec">Ask Treasury</div><div class="chips">';
    Object.keys(QS).forEach(function (k) { if (rc.asked.indexOf(k) === -1) h += '<button class="chip" type="button" data-q="' + k + '">' + QS[k] + "</button>"; });
    h += "</div>";
    rc.asked.forEach(function (k, i) {
      var fresh = i === rc.asked.length - 1 ? " fresh" : "";
      h += '<div class="q' + fresh + '">' + QS[k] + '</div><div class="answer' + fresh + '">' + (k === "flow" ? flowAnswer(rc) : topAnswer(rc)) + "</div>";
    });
    return h;
  }

  function flowAnswer(rc) {
    var f = rc.flows[0];
    return '<div class="card flow"><div class="flow-head">Money Flow<span>' + money(rc.total) + "</span></div>" + sankey(rc) + "</div>" +
      "<p><em>" + esc(f.name) + "</em> took the most, " + money(f.amt) + " of the " + money(rc.total) + ".</p>";
  }

  function topAnswer(rc) {
    var a = biggest(rc), cat = rc.flows.filter(function (f) { return f.name === a.cat; })[0];
    var rest = cat.amt - a.price > 0.004 ? ". " + esc(a.cat) + " came to " + money(cat.amt) + " on this trip." : ", the only item in " + esc(a.cat) + ".";
    return "<p><em>" + esc(a.name) + "</em> at " + money(a.price) + rest + "</p>";
  }

  // A small money flow chart: one source bar on the left, one band per category on the right.
  function sankey(rc) {
    var W = 360, top = 4, gap = 8, rowMin = 22, nodeX = 10, endX = 196, flows = rc.flows;
    var scale = 150 / rc.total, y = top, leftY = top, leftH = rc.flows.reduce(function (a, f) { return a + f.amt * scale; }, 0);
    var parts = [], labels = [];
    flows.forEach(function (f) {
      var h = Math.max(f.amt * scale, 2), rowH = Math.max(h, rowMin);
      var y0 = leftY, y1 = y + (rowH - h) / 2, mid = (nodeX + endX) / 2;
      parts.push('<path d="M' + nodeX + " " + y0 + " C" + mid + " " + y0 + " " + mid + " " + y1 + " " + endX + " " + y1 + " L" + endX + " " + (y1 + h) + " C" + mid + " " + (y1 + h) + " " + mid + " " + (y0 + h) + " " + nodeX + " " + (y0 + h) + ' Z" fill="' + f.color + '" opacity=".32"/>');
      parts.push('<rect x="' + endX + '" y="' + y1 + '" width="5" height="' + h + '" rx="2" fill="' + f.color + '"/>');
      var ty = y + rowH / 2;
      labels.push('<text x="' + (endX + 11) + '" y="' + (ty - 1) + '" font-size="10.5" fill="#2a2724">' + esc(f.name) + '</text><text x="' + (endX + 11) + '" y="' + (ty + 11) + '" font-size="9.5" fill="#77726a">' + money(f.amt) + "</text>");
      leftY += h; y += rowH + gap;
    });
    var H = Math.max(y - gap, leftH + top) + 4;
    return '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Money flow by category"><rect x="4" y="' + top + '" width="6" height="' + leftH + '" rx="2" fill="#2fb36d"/>' + parts.join("") + labels.join("") + "</svg>";
  }

  function renderAll() {
    renderList(); renderPanel();
  }

  function useSample() {
    fetch("sample_receipt.png").then(function (r) { if (!r.ok) throw new Error(r.status); return r.blob(); }).then(read).catch(function () {
      showFailed();
    });
  }

  // Nothing usable came back. Stay on the open row if it is still empty, otherwise show a new receipt panel.
  function showFailed() {
    busy = false; failed = true;
    if (!open || open.receipt) open = { pending: true };
    renderAll();
  }

  // Read the photo, then let the receipt find its own charge.
  function read(file) {
    if (busy) return;
    var url = URL.createObjectURL(file);
    busy = { img: url };
    $("intro").hidden = true;
    failed = false;
    if (!open) open = { pending: true };
    renderAll();
    Promise.resolve().then(function () {
      return Tesseract.recognize(file, "eng", {
        logger: function (m) {
          if (m.status === "recognizing text") { var s = $("scan-status"); if (s) s.textContent = "Reading receipt... " + Math.round(m.progress * 100) + "%"; }
        },
      });
    }).then(function (res) {
      busy = false;
      attach(res.data.text, url);
    }).catch(function (err) {
      showFailed();
      window.console.warn(err);
    });
  }

  // Plain words for why this charge won.
  function whyLine(m) {
    var amount = m.amountDiff < 0.005 ? "Same amount to the cent" : "Amount within " + money(m.amountDiff);
    var day = !m.dateOk ? "date not readable" : m.days === 0 ? "same day" : Math.round(m.days) + (Math.round(m.days) === 1 ? " day apart" : " days apart");
    return amount + ", " + day + ", " + (m.sharedWords.length ? "same store" : "store name differs");
  }

  function attach(text, url) {
    var r = RM.parseReceipt(text), rc = build(r, text, url);
    if (!r.items.length && r.total == null) return showFailed();
    var m = RM.matchTransaction(r, txns.map(function (t) { return t.raw; }));
    if (m) {
      var hit = txns.filter(function (t) { return t.raw === m.txn; })[0];
      rc.why = whyLine(m);
      rc.closer = m.dateOk && m.sharedWords.length ? "date and store" : m.dateOk ? "date" : "store";
      failed = false;
      rc.ruledOut = txns.filter(function (t) { return t !== hit && Math.abs(Math.abs(t.raw.amount) - Math.abs(hit.raw.amount)) <= 0.02; });
      hit.receipt = rc; open = hit;
    } else {
      open = { unmatched: true, receipt: rc };
    }
    renderAll();
  }

  $("file").addEventListener("change", function (e) { if (e.target.files[0]) read(e.target.files[0]); e.target.value = ""; });
  $("sample").addEventListener("click", useSample);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && open && !busy) { open = null; renderAll(); } });

  renderAll();
})();
