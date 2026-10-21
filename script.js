/* =========================================================
   領収書 作成ツール — script.js
   純粋なフロントエンドのみ。外部通信は行いません。
   ========================================================= */
(function () {
  'use strict';

  /* ---------------------------------------------------------
     ユーティリティ
     --------------------------------------------------------- */

  // 全角英数字・記号を半角に正規化
  function toHalfWidth(str) {
    return String(str)
      .replace(/[！-～]/g, function (ch) {
        return String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
      })
      .replace(/　/g, ' ');
  }

  // 通貨文字列 → 数値
  function parseMoney(str) {
    if (str === null || str === undefined) return 0;
    var cleaned = toHalfWidth(String(str)).replace(/[^\d.-]/g, '');
    var n = parseFloat(cleaned);
    return isFinite(n) ? n : 0;
  }

  // 0以上の整数円にまるめる
  function toAmount(str) {
    var n = Math.round(parseMoney(str));
    if (!isFinite(n) || n < 0) return 0;
    return n;
  }

  // 数値 → 千分位カンマ
  function comma(n) {
    var rounded = Math.round(n);
    var neg = rounded < 0;
    var s = String(Math.abs(rounded));
    s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + s;
  }

  // 数値 → ¥1,234
  function yen(n) {
    return '¥' + comma(n);
  }

  // 元号と改元日（YYYY-MM-DD）。新しい元号から順に判定する。
  var ERA_LIST = [
    { name: '令和', start: '2019-05-01', year: 2019 },
    { name: '平成', start: '1989-01-08', year: 1989 },
    { name: '昭和', start: '1926-12-25', year: 1926 },
    { name: '大正', start: '1912-07-30', year: 1912 },
    { name: '明治', start: '1868-01-01', year: 1868 }
  ];

  // "2026-10-11" → "令和8年10月11日"（明治より前は null）
  function toWareki(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return null;

    for (var i = 0; i < ERA_LIST.length; i++) {
      var era = ERA_LIST[i];
      // ゼロ埋めされた ISO 文字列は辞書順比較で日付比較になる
      if (iso < era.start) continue;
      var n = Number(m[1]) - era.year + 1;
      var eraYear = n === 1 ? '元' : String(n);
      return era.name + eraYear + '年' + Number(m[2]) + '月' + Number(m[3]) + '日';
    }
    return null;
  }

  // "2026-10-11" → "2026年10月11日" / era が 'wareki' なら和暦
  function formatDate(iso, era) {
    if (!iso) return '';
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return iso;

    if (era === 'wareki') {
      var wareki = toWareki(iso);
      if (wareki) return wareki;
    }
    return Number(m[1]) + '年' + Number(m[2]) + '月' + Number(m[3]) + '日';
  }

  var KANJI_DIGITS = ['零', '壱', '弐', '参', '肆', '伍', '陸', '漆', '捌', '玖'];
  var KANJI_SMALL = ['', '拾', '百', '千'];
  var KANJI_BIG = ['', '萬', '億', '兆'];

  // 整数 → 大字（漢数字）表記。例: 330000 → "参拾参萬"
  function kanjiNumber(n) {
    var num = Math.floor(Math.abs(Number(n) || 0));
    if (num === 0) return '零';

    var out = '';
    var groupIndex = 0;

    while (num > 0) {
      var group = num % 10000;
      if (group > 0) {
        var groupStr = '';
        var g = group;
        var unitIndex = 0;
        while (g > 0) {
          var digit = g % 10;
          if (digit > 0) groupStr = KANJI_DIGITS[digit] + KANJI_SMALL[unitIndex] + groupStr;
          g = Math.floor(g / 10);
          unitIndex += 1;
        }
        out = groupStr + KANJI_BIG[groupIndex] + out;
      }
      num = Math.floor(num / 10000);
      groupIndex += 1;
    }

    return out;
  }

  // 税込金額 → 内消費税額（1円未満切り捨て）
  function includedTax(amount, rate) {
    return Math.floor(amount * rate / (100 + rate));
  }

  function $(id) { return document.getElementById(id); }

  // 名前付きラジオの選択値（未選択なら空文字）
  function checkedValue(name) {
    var el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : '';
  }

  function setRadio(name, value) {
    var nodes = document.querySelectorAll('input[name="' + name + '"]');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].checked = nodes[i].value === value;
    }
  }

  function todayISO() {
    var d = new Date();
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + mm + '-' + dd;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function placeholder(text) {
    return '<span class="ph">' + text + '</span>';
  }

  /* ---------------------------------------------------------
     状態
     --------------------------------------------------------- */

  // 紙の領収書は記載金額 5万円以上で印紙税の課税文書（第17号文書）になる
  var STAMP_THRESHOLD = 50000;

  var DEFAULTS = {
    clientName: '株式会社サンプル',
    clientHonorific: '様',
    receiptNo: 'R-2026-001',
    proviso: 'WEBサイト制作費として',
    amountMode: 'single',
    amountTotal: 330000,
    amount10: 300000,
    amount8: 30000,
    showTax: true,
    taxRateIncluded: '10',
    useDaiji: true,
    issuerName: '山田 太郎',
    issuerAddress: '〒150-0001 東京都渋谷区神宮前1-2-3 サンプルビル5F',
    issuerTel: '03-1234-5678',
    regNumber: 'T1234567890123',
    notes: '本書は領収書として発行するものです。\n再発行はいたしかねますので、大切に保管してください。',
    docFont: 'gothic',
    docWeight: 'normal',
    dateEra: 'seireki'
  };

  // 既定のゴシックは紙面が元から使っている書体（--font）のままにするため、
  // ユーザーがフォントを切り替えるまでは class を付けない。
  var docFontTouched = false;

  /* ---------------------------------------------------------
     登録番号の検証
     --------------------------------------------------------- */

  function normalizeRegNumber(value) {
    return toHalfWidth(value).replace(/[\s　-]/g, '').toUpperCase();
  }

  // 空なら null、正しければ正規化文字列、誤りなら false
  function validateRegNumber(value) {
    var normalized = normalizeRegNumber(value);
    if (normalized === '') return null;
    return /^T\d{13}$/.test(normalized) ? normalized : false;
  }

  /* ---------------------------------------------------------
     金額の取り出し
     --------------------------------------------------------- */

  function getAmounts() {
    var mode = $('amountMode').value;

    if (mode === 'split') {
      var a10 = toAmount($('amount10').value);
      var a8 = toAmount($('amount8').value);
      return {
        mode: 'split',
        amount10: a10,
        amount8: a8,
        total: a10 + a8,
        tax: includedTax(a10, 10) + includedTax(a8, 8)
      };
    }

    var total = toAmount($('amountTotal').value);
    var rate = $('taxRateIncluded').value === '8' ? 8 : 10;
    return {
      mode: 'single',
      amount10: 0,
      amount8: 0,
      total: total,
      rate: rate,
      tax: includedTax(total, rate)
    };
  }

  /* ---------------------------------------------------------
     書式（フォント・太字）の適用
     紙面の class を切り替えるだけで、印刷時の CSS にもそのまま乗る
     --------------------------------------------------------- */

  function applyDocStyle() {
    var paper = $('paper');
    var font = checkedValue('docFont');

    paper.classList.toggle('font-mincho', font === 'mincho');
    paper.classList.toggle('font-gothic', font === 'gothic' && docFontTouched);
    paper.classList.toggle('is-bold', checkedValue('docWeight') === 'bold');
  }

  /* ---------------------------------------------------------
     プレビューの描画
     --------------------------------------------------------- */

  function renderPreview() {
    var amounts = getAmounts();
    var useDaiji = $('useDaiji').checked;
    var showTax = $('showTax').checked;

    /* --- 金額 --- */
    var amountEl = $('pvAmount');
    if (useDaiji) {
      amountEl.className = 'amount-value daiji';
      amountEl.textContent = '金 ' + kanjiNumber(amounts.total) + '円 也';
    } else {
      amountEl.className = 'amount-value num';
      amountEl.textContent = yen(amounts.total) + '-';
    }

    /* --- 宛名 --- */
    var honorific = $('clientHonorific').value;
    var clientName = $('clientName').value.trim();
    var isAtesama = honorific === '上様';

    // 宛名が「上様」のときは宛名欄を使わない
    $('clientName').disabled = isAtesama;

    if (isAtesama) {
      $('pvClientName').textContent = '';
      $('pvHonorific').textContent = '上様';
    } else {
      $('pvClientName').innerHTML = clientName
        ? escapeHtml(clientName)
        : placeholder('宛名を入力');
      $('pvHonorific').textContent = honorific;
    }

    /* --- 発行日・番号 --- */
    var dateISO = $('issueDate').value;
    $('pvDate').innerHTML = dateISO
      ? escapeHtml(formatDate(dateISO, checkedValue('dateEra')))
      : placeholder('未入力');

    var receiptNo = $('receiptNo').value.trim();
    $('pvNoLine').hidden = !receiptNo;
    $('pvNo').textContent = receiptNo;

    /* --- 但書 --- */
    var proviso = $('proviso').value.trim();
    $('pvProviso').innerHTML = proviso ? escapeHtml(proviso) : placeholder('但書を入力');

    /* --- 消費税の内訳 --- */
    var taxRows = $('pvTaxRows');
    var taxBlock = $('pvTaxBlock');
    taxRows.innerHTML = '';
    var hasTaxRows = false;

    if (amounts.mode === 'split') {
      // 適格簡易請求書にあわせて税率ごとの合計額を区分表示する
      var groups = [
        { rate: 10, label: '10% 対象（標準税率・税込）', value: amounts.amount10 },
        { rate: 8, label: '8% 対象（軽減税率・税込）', value: amounts.amount8 }
      ];
      groups.forEach(function (g) {
        if (g.value <= 0) return;
        hasTaxRows = true;
        var tr = document.createElement('tr');
        tr.innerHTML = '<td>' + g.label + '</td><td class="num">' + yen(g.value) + '</td>';
        taxRows.appendChild(tr);
      });
      if (showTax && amounts.total > 0) {
        hasTaxRows = true;
        var trTax = document.createElement('tr');
        trTax.className = 'breakdown-sub';
        trTax.innerHTML = '<td>（うち消費税額）</td><td class="num">' + yen(amounts.tax) + '</td>';
        taxRows.appendChild(trTax);
      }
    } else if (showTax && amounts.total > 0) {
      hasTaxRows = true;
      var trIncluded = document.createElement('tr');
      trIncluded.className = 'breakdown-sub';
      trIncluded.innerHTML =
        '<td>（うち消費税額 ' + amounts.rate + '%）</td>' +
        '<td class="num">' + yen(amounts.tax) + '</td>';
      taxRows.appendChild(trIncluded);
    }

    taxBlock.hidden = !hasTaxRows;

    /* --- 収入印紙の注意喚起（画面のみ） --- */
    var needsStamp = amounts.total >= STAMP_THRESHOLD;
    $('stampAlert').hidden = !needsStamp;
    $('stampBadge').hidden = !needsStamp;
    if (needsStamp) $('stampAmount').textContent = yen(amounts.total);

    /* --- 発行元 --- */
    var issuerName = $('issuerName').value.trim();
    $('pvIssuerName').innerHTML = issuerName
      ? escapeHtml(issuerName)
      : placeholder('屋号・氏名を入力');

    var address = $('issuerAddress').value.trim();
    $('pvIssuerAddressLine').hidden = !address;
    $('pvIssuerAddress').textContent = address;

    var tel = $('issuerTel').value.trim();
    $('pvIssuerTelLine').hidden = !tel;
    $('pvIssuerTel').textContent = tel;

    var regResult = validateRegNumber($('regNumber').value);
    var regLine = $('pvRegLine');
    var regOut = $('pvRegNumber');
    if (regResult === false) {
      regLine.hidden = false;
      regOut.innerHTML = '<span class="reg-bad">' +
        escapeHtml(toHalfWidth($('regNumber').value).trim() || '（未入力）') + '</span>';
    } else if (regResult === null) {
      regLine.hidden = true;
      regOut.textContent = '';
    } else {
      regLine.hidden = false;
      regOut.textContent = regResult;
    }

    /* --- 備考 --- */
    var notes = $('notes').value.trim();
    $('pvNotesBlock').hidden = !notes;
    $('pvNotes').textContent = notes;

    /* --- 注記 --- */
    var paperNote = $('pvPaperNote');
    var noteText = '';
    if (amounts.mode === 'single' && showTax && amounts.total > 0) {
      noteText = '※ 消費税額は税込金額から逆算し、1円未満は切り捨てています。';
    }
    if (regResult === false) {
      noteText += (noteText ? ' ' : '') +
        '※ 登録番号の形式が正しくないため、この番号はそのまま使用しないでください。';
    }
    paperNote.hidden = !noteText;
    paperNote.textContent = noteText;
  }

  /* ---------------------------------------------------------
     入力モードの切り替え
     --------------------------------------------------------- */

  function updateModeVisibility() {
    var mode = $('amountMode').value;
    var isSplit = mode === 'split';

    $('singleAmountBlock').hidden = isSplit;
    $('splitAmountBlock').hidden = !isSplit;
    // 税率区分で入力する場合、内消費税額の税率は区分ごとに決まる
    $('taxRateBlock').hidden = isSplit || !$('showTax').checked;
  }

  /* ---------------------------------------------------------
     登録番号エラー表示
     --------------------------------------------------------- */

  function updateRegNumberState() {
    var input = $('regNumber');
    var errorEl = $('regNumberError');

    if (validateRegNumber(input.value) === false) {
      input.setAttribute('aria-invalid', 'true');
      errorEl.hidden = false;
    } else {
      input.removeAttribute('aria-invalid');
      errorEl.hidden = true;
    }
  }

  /* ---------------------------------------------------------
     イベント
     --------------------------------------------------------- */

  // 金額欄からフォーカスが外れたらカンマ区切りに整形
  function formatAmountField(input) {
    var value = toAmount(input.value);
    input.value = value ? comma(value) : '';
  }

  function applyFieldDefaults() {
    $('clientName').value = DEFAULTS.clientName;
    $('clientHonorific').value = DEFAULTS.clientHonorific;
    $('receiptNo').value = DEFAULTS.receiptNo;
    $('proviso').value = DEFAULTS.proviso;
    $('amountMode').value = DEFAULTS.amountMode;
    $('amountTotal').value = comma(DEFAULTS.amountTotal);
    $('amount10').value = comma(DEFAULTS.amount10);
    $('amount8').value = comma(DEFAULTS.amount8);
    $('showTax').checked = DEFAULTS.showTax;
    $('taxRateIncluded').value = DEFAULTS.taxRateIncluded;
    $('useDaiji').checked = DEFAULTS.useDaiji;
    $('issuerName').value = DEFAULTS.issuerName;
    $('issuerAddress').value = DEFAULTS.issuerAddress;
    $('issuerTel').value = DEFAULTS.issuerTel;
    $('regNumber').value = DEFAULTS.regNumber;
    $('notes').value = DEFAULTS.notes;
    $('issueDate').value = todayISO();
    setRadio('docFont', DEFAULTS.docFont);
    setRadio('docWeight', DEFAULTS.docWeight);
    setRadio('dateEra', DEFAULTS.dateEra);
    docFontTouched = false;
  }

  function refresh() {
    updateModeVisibility();
    updateRegNumberState();
    applyDocStyle();
    renderPreview();
  }

  function resetForm() {
    applyFieldDefaults();
    refresh();
  }

  /* ---------------------------------------------------------
     初期化
     --------------------------------------------------------- */

  function init() {
    applyFieldDefaults();

    // 登録番号は入力を半角に正規化しつつ検証
    var regInput = $('regNumber');
    regInput.addEventListener('input', function () {
      var half = toHalfWidth(regInput.value).toUpperCase();
      if (half !== regInput.value) {
        var pos = regInput.selectionStart;
        regInput.value = half;
        try { regInput.setSelectionRange(pos, pos); } catch (e) { /* noop */ }
      }
      refresh();
    });
    regInput.addEventListener('blur', function () {
      var normalized = normalizeRegNumber(regInput.value);
      if (/^T\d{13}$/.test(normalized)) {
        regInput.value = normalized;
        refresh();
      }
    });

    // 既定のゴシックは既存の紙面書体のまま。切り替えたときだけ class を当てる。
    var fontRadios = document.querySelectorAll('input[name="docFont"]');
    for (var i = 0; i < fontRadios.length; i++) {
      fontRadios[i].addEventListener('change', function () {
        docFontTouched = true;
      });
    }

    $('receiptForm').addEventListener('input', refresh);
    $('receiptForm').addEventListener('change', refresh);

    // 金額欄はフォーカスが外れたときに整形する
    ['amountTotal', 'amount10', 'amount8'].forEach(function (id) {
      $(id).addEventListener('focusout', function (event) {
        formatAmountField(event.target);
      });
    });

    $('printBtn').addEventListener('click', function () {
      window.print();
    });

    $('resetBtn').addEventListener('click', resetForm);

    refresh();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

/* =========================================================
   シェア（バイラル導線） — 既存機能には触れない独立モジュール
   ========================================================= */
(function () {
  'use strict';

  var SHARE_URL  = "https://www.reveriel.com/ryoshusho-pdf/";
  var CARD_TITLE = "領収書 作成ツール";
  var CARD_SUB   = "無料で使える領収書PDF作成ツール";
  var CARD_FOOT  = "www.reveriel.com/ryoshusho-pdf";
  var FILE_NAME  = "ryoshusho-pdf.png";

  var SHARE_TEXT = "無料で使える領収書PDF作成ツール";

  function byId(id) { return document.getElementById(id); }

  function shareText() { return SHARE_TEXT; }
  function cardSub()   { return CARD_SUB; }

  function openExternal(url) {
    if (!url) return;
    var a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function buildTweetUrl() {
    return 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(shareText()) +
      '&url=' + encodeURIComponent(SHARE_URL);
  }
  function buildLineUrl() {
    return 'https://social-plugins.line.me/lineit/share?url=' + encodeURIComponent(SHARE_URL);
  }

  function fallbackCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:absolute;left:-9999px;top:0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  function copyText(text) {
    return new Promise(function (resolve) {
      try {
        if (navigator.clipboard && window.isSecureContext) {
          navigator.clipboard.writeText(text).then(
            function () { resolve(true); },
            function () { resolve(fallbackCopy(text)); }
          );
          return;
        }
      } catch (e) { /* fallthrough */ }
      resolve(fallbackCopy(text));
    });
  }

  /* ---- 共有カード（1200 x 630） ---- */
  var CARD_W = 1200, CARD_H = 630;
  var FONT = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Yu Gothic",sans-serif';

  function roundRect(ctx, x, y, w, h, r) {
    if (typeof ctx.roundRect === 'function') { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawCard(ctx) {
    var g = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
    g.addColorStop(0, '#1e3a8a');
    g.addColorStop(1, '#2f5bd0');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CARD_W, CARD_H);

    ctx.fillStyle = 'rgba(255,255,255,.07)';
    ctx.beginPath(); ctx.arc(CARD_W - 130, 80, 230, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(CARD_W - 300, CARD_H + 10, 160, 0, Math.PI * 2); ctx.fill();

    var PAD = 80;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    ctx.fillStyle = 'rgba(255,255,255,.72)';
    ctx.font = '600 24px ' + FONT;
    ctx.fillText('FREE TOOL — BROWSER ONLY', PAD, 106);

    ctx.fillStyle = '#ffffff';
    ctx.font = '700 74px ' + FONT;
    ctx.fillText(CARD_TITLE, PAD, 260);

    ctx.fillStyle = 'rgba(255,255,255,.92)';
    ctx.font = '500 34px ' + FONT;
    ctx.fillText(cardSub(), PAD, 336);

    ctx.fillStyle = 'rgba(255,255,255,.85)';
    roundRect(ctx, PAD, CARD_H - 138, 64, 6, 3);
    ctx.fill();

    ctx.fillStyle = '#dbe6ff';
    ctx.font = '700 30px ' + FONT;
    ctx.fillText(CARD_FOOT, PAD, CARD_H - 80);

    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,.62)';
    ctx.font = '500 22px ' + FONT;
    ctx.fillText('無料・登録不要', CARD_W - PAD, CARD_H - 80);
    ctx.textAlign = 'left';
  }

  function renderCardBlob() {
    return new Promise(function (resolve) {
      try {
        var canvas = document.createElement('canvas');
        canvas.width = CARD_W;
        canvas.height = CARD_H;
        var ctx = canvas.getContext('2d');
        var finish = function () {
          if (canvas.toBlob) canvas.toBlob(function (b) { resolve(b); }, 'image/png');
          else resolve(null);
        };
        var draw = function () {
          try { drawCard(ctx); } catch (e) {}
          finish();
        };
        if (document.fonts && document.fonts.ready) {
          var drawn = false;
          var once = function () { if (drawn) { return; } drawn = true; draw(); };
          document.fonts.ready.then(once).catch(once);
          // fonts.ready が解決しない環境でも保存ボタンが固まらないようタイムアウト競走させる
          setTimeout(once, 1500);
        } else {
          draw();
        }
      } catch (e) { resolve(null); }
    });
  }

  function flash(el, text) {
    if (!el) return;
    var old = el.textContent;
    el.textContent = text;
    setTimeout(function () { el.textContent = old; }, 1800);
  }

  function init() {
    var xBtn = byId('shareXBtn');
    var lBtn = byId('shareLineBtn');
    var cBtn = byId('shareCopyBtn');
    var sBtn = byId('shareSaveBtn');
    var urlText = byId('shareUrlText');
    if (!xBtn || !lBtn || !cBtn) return;

    if (urlText) urlText.textContent = SHARE_URL;

    xBtn.addEventListener('click', function () { openExternal(buildTweetUrl()); });
    lBtn.addEventListener('click', function () { openExternal(buildLineUrl()); });

    var copyLabel = byId('shareCopyLabel');
    var resetTimer = null;
    cBtn.addEventListener('click', function () {
      var original = copyLabel ? copyLabel.textContent : '';
      copyText(SHARE_URL).then(function (ok) {
        if (!copyLabel) return;
        copyLabel.textContent = ok ? 'コピーしました' : 'コピーできませんでした';
        if (resetTimer) clearTimeout(resetTimer);
        resetTimer = setTimeout(function () { copyLabel.textContent = original; }, 1800);
      });
    });

    if (sBtn) {
      var saveLabel = byId('shareSaveLabel');
      sBtn.addEventListener('click', function () {
        if (sBtn.disabled) return;
        sBtn.disabled = true;
        renderCardBlob().then(function (blob) {
          sBtn.disabled = false;
          if (!blob) { flash(saveLabel, '画像を生成できませんでした'); return; }
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = FILE_NAME;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        });
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
